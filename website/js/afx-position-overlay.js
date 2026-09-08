/**
 * AlphaFX Charts — PositionOverlay (ported from alphafx-charts/src/trading/PositionOverlay.ts)
 * Flag-based SL/TP, draft limit/stop orders, entry labels — clean desktop trade UI.
 */
(function () {
  const LC = () => window.LightweightCharts;
  const SIDE_COLOR = { buy: "#0ecb81", sell: "#f6465d" };
  const LINE_WIDTH = { normal: 1, selected: 2, focused: 3 };

  let chart = null;
  let series = null;
  let chartEl = null;
  let mountEl = null;
  let layer = null;
  let getContext = null;
  let views = new Map();
  let activeId = null;
  let activeFocus = null;
  let draftCounter = 1;
  let repositionScheduled = false;
  let rangeSubscribed = false;

  function ctx() {
    return getContext?.() || {};
  }

  function fmtPrice(value, symbol) {
    const fn = ctx().fmtPrice;
    return fn ? fn(symbol || ctx().activeSymbol, value) : Number(value).toFixed(2);
  }

  function validateSlTp(side, entry, kind, price) {
    const s = String(side).toLowerCase();
    if (kind === "sl") {
      if (s === "sell" && price <= entry) return "SL must be above sell price";
      if (s === "buy" && price >= entry) return "SL must be below buy price";
      return null;
    }
    if (s === "sell" && price >= entry) return "TP must be below sell price";
    if (s === "buy" && price <= entry) return "TP must be above buy price";
    return null;
  }

  function validateOrderPrice(side, orderKind, orderPrice, marketPrice) {
    const s = String(side).toLowerCase();
    const k = String(orderKind).toLowerCase();
    if (k === "market") return null;
    if (!Number.isFinite(orderPrice) || orderPrice <= 0) return "Enter a valid price";
    if (k === "limit") {
      if (s === "buy" && orderPrice >= marketPrice) return "Buy limit must be below market price";
      if (s === "sell" && orderPrice <= marketPrice) return "Sell limit must be above market price";
      return null;
    }
    if (s === "buy" && orderPrice <= marketPrice) return "Buy stop must be above market price";
    if (s === "sell" && orderPrice >= marketPrice) return "Sell stop must be below market price";
    return null;
  }

  function formatPositionLabel(position) {
    const side = String(position.side).toLowerCase();
    const sideU = side.toUpperCase();
    const volume = Number(position.volume).toFixed(2);
    if (position.status === "draft" || position.status === "pending") {
      const kind = String(position.orderKind || "limit").toUpperCase();
      return `${sideU} ${kind} ${volume}`;
    }
    return `${sideU} ${volume}`;
  }

  function isOrderEntryDraggable(position) {
    return (
      String(position.orderKind).toLowerCase() !== "market" &&
      position.status === "draft"
    );
  }

  function canSetSlTp(position) {
    return position.status === "draft" || position.status === "pending" || position.status === "open";
  }

  function isDraftId(id) {
    return String(id).startsWith("draft-");
  }

  function toast(msg, tone = "neutral") {
    window.AlphaFXToast?.show(msg, tone === "error" ? "error" : "success");
  }

  function getMarketPrice() {
    const fn = ctx().getMarketPrice;
    if (fn) return fn();
    const sym = ctx().activeSymbol;
    const tick = window.AlphaFXQuotes?.getLast?.(sym);
    if (!tick) return null;
    return (Number(tick.bid) + Number(tick.ask)) / 2;
  }

  function getPlotFrame() {
    if (!chart || !chartEl || !mountEl) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const containerRect = mountEl.getBoundingClientRect();
    const chartRect = chartEl.getBoundingClientRect();
    const pane = chart.paneSize?.(0) || { width: chartRect.width, height: chartRect.height };
    return {
      left: chartRect.left - containerRect.left,
      top: chartRect.top - containerRect.top,
      width: pane.width,
      height: pane.height,
    };
  }

  function priceToLocalY(price) {
    if (!series || price == null) return null;
    const y = series.priceToCoordinate(price);
    if (y == null) return null;
    return getPlotFrame().top + y;
  }

  function resolvePositionTime(position) {
    if (position.time != null) return position.time;
    if (position.opened_time != null && ctx().snapBarTime) {
      return ctx().snapBarTime(position.opened_time);
    }
    return ctx().fallbackTime?.() ?? null;
  }

  function timeToLocalX(time) {
    if (!chart || time == null) return null;
    const x = chart.timeScale().timeToCoordinate(time);
    if (x == null) return null;
    return getPlotFrame().left + x;
  }

  function clientYToPrice(clientY) {
    const frame = getPlotFrame();
    const containerRect = mountEl.getBoundingClientRect();
    const paneY = clientY - containerRect.top - frame.top;
    return series?.coordinateToPrice(paneY);
  }

  function removeLine(line) {
    if (line && series) series.removePriceLine(line);
  }

  function createLevelLine(price, color) {
    return series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: LC().LineStyle.Dotted,
      lineVisible: true,
      axisLabelVisible: false,
      title: "",
    });
  }

  function scheduleReposition() {
    if (repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(() => {
      repositionScheduled = false;
      repositionAll();
    });
  }

  function subscribeRange() {
    if (rangeSubscribed || !chart) return;
    rangeSubscribed = true;
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(scheduleReposition);
    ts.subscribeSizeChange(scheduleReposition);
    chart.subscribeCrosshairMove(scheduleReposition);
    new ResizeObserver(scheduleReposition).observe(mountEl);
  }

  function unsubscribeRange() {
    if (!rangeSubscribed || !chart) return;
    rangeSubscribed = false;
    try {
      const ts = chart.timeScale();
      ts.unsubscribeVisibleLogicalRangeChange(scheduleReposition);
      ts.unsubscribeSizeChange(scheduleReposition);
      chart.unsubscribeCrosshairMove(scheduleReposition);
    } catch {
      /* ignore */
    }
  }

  function createFlag(kind, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `afx-position-flag afx-position-flag--${kind}`;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    const icon = document.createElement("span");
    icon.className = "afx-flag-icon";
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(icon);
    layer.appendChild(btn);
    return btn;
  }

  function createCloseButton(title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "afx-position-close";
    btn.textContent = "×";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    layer.appendChild(btn);
    return btn;
  }

  function createConfirmButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "afx-position-confirm";
    btn.textContent = "✓";
    btn.title = "Place order";
    btn.setAttribute("aria-label", "Place order");
    return btn;
  }

  function createPriceTag(kind) {
    const tag = document.createElement("div");
    tag.className = `afx-price-tag afx-price-tag--${kind}`;
    tag.hidden = true;
    layer.appendChild(tag);
    return tag;
  }

  function lineWidthFor(viewId, kind) {
    if (activeId !== viewId) return LINE_WIDTH.normal;
    if (activeFocus === kind) return LINE_WIDTH.focused;
    return LINE_WIDTH.selected;
  }

  function setActive(id, focus = null) {
    activeId = id;
    activeFocus = id == null ? null : focus;
    applyLineStyles();
    scheduleReposition();
  }

  function applyLineStyles() {
    for (const [id, view] of views) {
      view.entryLine?.applyOptions({ lineWidth: lineWidthFor(id, "entry") });
      if (view.slLine) view.slLine.applyOptions({ lineWidth: lineWidthFor(id, "sl") });
      if (view.tpLine) view.tpLine.applyOptions({ lineWidth: lineWidthFor(id, "tp") });
      if (view.drag?.previewLine) {
        view.drag.previewLine.applyOptions({ lineWidth: lineWidthFor(id, view.drag.kind) });
      }
      view.row.classList.toggle("afx-position-row--active", id === activeId);
      view.label.classList.toggle("afx-position-label--focused", id === activeId && activeFocus === "entry");
      view.entryMarker?.classList.toggle("afx-entry-marker--focused", id === activeId && activeFocus === "entry");
      view.slFlag.classList.toggle("afx-position-flag--focused", id === activeId && activeFocus === "sl");
      view.tpFlag.classList.toggle("afx-position-flag--focused", id === activeId && activeFocus === "tp");
    }
    for (const [id, view] of views) updatePriceTags(view, id);
  }

  function chartCenterX(frame) {
    return frame.left + frame.width / 2;
  }

  function showPriceTag(tag, price, frame, kind, symbol, anchorX) {
    const y = priceToLocalY(price);
    if (y == null || y < frame.top || y > frame.top + frame.height) {
      tag.hidden = true;
      return;
    }
    const prefix = kind === "sl" ? "SL" : kind === "tp" ? "TP" : "";
    tag.textContent = prefix ? `${prefix} ${fmtPrice(price, symbol)}` : fmtPrice(price, symbol);
    tag.style.top = `${y}px`;
    tag.style.left = `${anchorX ?? chartCenterX(frame)}px`;
    tag.style.transform = "translate(-50%, -50%)";
    tag.hidden = false;
  }

  function createEntryMarker(side) {
    const el = document.createElement("div");
    el.className = `afx-entry-marker afx-entry-marker--${String(side).toLowerCase()}`;
    el.setAttribute("aria-hidden", "true");
    layer.appendChild(el);
    return el;
  }

  function updatePriceTags(view, viewId) {
    const selected = viewId === activeId;
    view.entryPriceTag.hidden = true;
    view.slPriceTag.hidden = true;
    view.tpPriceTag.hidden = true;
    if (!selected || activeFocus == null) return;
    const frame = getPlotFrame();
    const sym = view.position.symbol;
    const anchorX = timeToLocalX(resolvePositionTime(view.position));
    if (activeFocus === "entry") {
      showPriceTag(view.entryPriceTag, view.position.price, frame, "entry", sym, anchorX);
      return;
    }
    if (activeFocus === "sl") {
      const price =
        view.drag?.kind === "sl"
          ? (view.drag.previewLine && typeof view.drag.previewLine.options === "function"
              ? view.drag.previewLine.options().price
              : null) ?? view.position.sl
          : view.position.sl;
      if (price != null) showPriceTag(view.slPriceTag, price, frame, "sl", sym, anchorX);
      return;
    }
    const price =
      view.drag?.kind === "tp"
        ? (view.drag.previewLine && typeof view.drag.previewLine.options === "function"
            ? view.drag.previewLine.options().price
            : null) ?? view.position.tp
        : view.position.tp;
    if (price != null) showPriceTag(view.tpPriceTag, price, frame, "tp", sym, anchorX);
  }

  function hideLevel(flag, close) {
    flag.style.visibility = "hidden";
    close.style.visibility = "hidden";
  }

  function positionLevel(view, kind, price, slot, dragging) {
    if (!canSetSlTp(view.position)) {
      hideLevel(view.slFlag, view.slClose);
      hideLevel(view.tpFlag, view.tpClose);
      return;
    }
    const flag = kind === "sl" ? view.slFlag : view.tpFlag;
    const close = kind === "sl" ? view.slClose : view.tpClose;
    const isSet = kind === "sl" ? view.position.sl != null : view.position.tp != null;
    const y = priceToLocalY(price);
    const frame = getPlotFrame();
    if (y == null || y < frame.top || y > frame.top + frame.height) {
      hideLevel(flag, close);
      return;
    }
    const timeX = timeToLocalX(resolvePositionTime(view.position));
    const atEntry = Math.abs(price - view.position.price) < 1e-8;
    let baseLeft = timeX;
    if (baseLeft == null) baseLeft = chartCenterX(frame);
    if (!isSet && atEntry) {
      baseLeft += kind === "sl" ? -22 : 22;
    }
    const viewId = view.row.dataset.positionId ?? "";
    const focused = viewId === activeId && activeFocus === kind;
    flag.style.visibility = "visible";
    flag.style.top = `${y}px`;
    flag.style.left = `${baseLeft}px`;
    flag.style.transform = focused
      ? "translate(-50%, -50%) scale(1.12)"
      : "translate(-50%, -50%)";
    if (isSet || dragging) {
      close.style.visibility = "visible";
      close.style.top = `${y}px`;
      close.style.left = `${baseLeft + (kind === "sl" ? 18 : -18)}px`;
      close.style.transform = "translate(-50%, -50%)";
    } else {
      close.style.visibility = "hidden";
    }
  }

  function clearLevelLine(view, kind) {
    if (kind === "sl" && view.slLine) {
      removeLine(view.slLine);
      view.slLine = null;
      return;
    }
    if (kind === "tp" && view.tpLine) {
      removeLine(view.tpLine);
      view.tpLine = null;
    }
  }

  function commitLevel(view, kind, price, line) {
    if (kind === "sl") {
      view.slLine = line;
      view.position.sl = price;
      return;
    }
    view.tpLine = line;
    view.position.tp = price;
  }

  function restoreLevelAfterCancel(view, kind, previousSl, previousTp) {
    if (kind === "sl" && previousSl != null) {
      view.slLine = createLevelLine(previousSl, "#f6465d");
      view.position.sl = previousSl;
      return;
    }
    if (kind === "tp" && previousTp != null) {
      view.tpLine = createLevelLine(previousTp, "#0ecb81");
      view.position.tp = previousTp;
    }
  }

  function updateDragPrice(view, clientY) {
    const price = clientYToPrice(clientY);
    if (price == null || !view.drag) return;
    const kind = view.drag.kind;
    const viewId = view.row.dataset.positionId ?? "";
    if (kind === "entry") {
      view.position.price = price;
      view.entryLine.applyOptions({ price });
      view.label.textContent = formatPositionLabel(view.position);
      scheduleReposition();
      updatePriceTags(view, viewId);
      return;
    }
    view.drag.previewLine?.applyOptions({ price });
    positionLevel(view, kind, price, kind === "sl" ? 0 : 1, true);
    updatePriceTags(view, viewId);
  }

  function startDrag(id, kind, event) {
    const view = views.get(id);
    if (!view || view.drag) return;
    if (kind === "entry") {
      if (!isOrderEntryDraggable(view.position)) return;
    } else if (!canSetSlTp(view.position)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    chart?.applyOptions({ handleScroll: false, handleScale: false });
    event.currentTarget.setPointerCapture(event.pointerId);

    if (kind === "entry") {
      view.drag = { kind, pointerId: event.pointerId, previewLine: null, originalPrice: view.position.price };
      updateDragPrice(view, event.clientY);
      updatePriceTags(view, id);
      return;
    }

    clearLevelLine(view, kind);
    const startPrice =
      kind === "sl" ? (view.position.sl ?? view.position.price) : (view.position.tp ?? view.position.price);
    const color = kind === "sl" ? "#f6465d" : "#0ecb81";
    const previewLine = series.createPriceLine({
      price: startPrice,
      color,
      lineWidth: lineWidthFor(id, kind),
      lineStyle: LC().LineStyle.Dotted,
      lineVisible: true,
      axisLabelVisible: false,
      title: "",
    });
    view.drag = { kind, pointerId: event.pointerId, previewLine, originalPrice: startPrice };
    updateDragPrice(view, event.clientY);
    updatePriceTags(view, id);
  }

  async function persistSlTp(view, kind, price) {
    const id = view.position.id;
    if (isDraftId(id)) return;
    const accountId = ctx().accountId;
    if (!accountId || !window.AlphaFXApi) return;
    const sym = view.position.symbol;
    const body = { account_id: accountId };
    if (kind === "sl") body.stop_loss = price;
    else body.take_profit = price;
    try {
      await window.AlphaFXApi.request(`/api/v1/trade/positions/${id}/stops`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const open = ctx().open || [];
      const row = open.find((p) => String(p.id) === String(id));
      if (row) {
        if (kind === "sl") row.sl = price;
        else row.tp = price;
      }
      toast(kind === "sl" ? `Stop loss set · ${fmtPrice(price, sym)}` : `Take profit set · ${fmtPrice(price, sym)}`);
    } catch (e) {
      toast(e?.message || "Could not save stops", "error");
      sync();
    }
  }

  async function clearSlTpOnServer(view, kind) {
    const id = view.position.id;
    if (isDraftId(id)) return;
    const accountId = ctx().accountId;
    if (!accountId || !window.AlphaFXApi) return;
    const body = { account_id: accountId };
    if (kind === "sl") body.stop_loss = null;
    else body.take_profit = null;
    await window.AlphaFXApi.request(`/api/v1/trade/positions/${id}/stops`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    const open = ctx().open || [];
    const row = open.find((p) => String(p.id) === String(id));
    if (row) {
      if (kind === "sl") row.sl = null;
      else row.tp = null;
    }
  }

  function onPointerMove(event) {
    for (const view of views.values()) {
      if (!view.drag || view.drag.pointerId !== event.pointerId) continue;
      event.preventDefault();
      event.stopPropagation();
      updateDragPrice(view, event.clientY);
    }
  }

  function onPointerUp(event) {
    let anyDrag = false;
    for (const view of views.values()) {
      if (!view.drag || view.drag.pointerId !== event.pointerId) continue;
      anyDrag = true;
      const { kind, previewLine, originalPrice } = view.drag;
      const viewId = view.row.dataset.positionId ?? "";
      const side = String(view.position.side).toLowerCase();

      if (kind === "entry") {
        const marketPrice = getMarketPrice();
        const error = validateOrderPrice(side, view.position.orderKind, view.position.price, marketPrice);
        if (error) {
          view.position.price = originalPrice;
          view.entryLine.applyOptions({ price: originalPrice });
          view.label.textContent = formatPositionLabel(view.position);
          toast(error, "error");
        }
        view.drag = null;
        applyLineStyles();
        scheduleReposition();
        continue;
      }

      const price =
        (previewLine && typeof previewLine.options === "function" ? previewLine.options().price : null) ??
        originalPrice;
      const previousSl = view.position.sl;
      const previousTp = view.position.tp;
      const error = validateSlTp(side, view.position.price, kind, price);

      if (error) {
        view.drag = null;
        if (previewLine) removeLine(previewLine);
        restoreLevelAfterCancel(view, kind, previousSl, previousTp);
        toast(error, "error");
        applyLineStyles();
        scheduleReposition();
        continue;
      }

      view.drag = null;
      if (previewLine) commitLevel(view, kind, price, previewLine);
      applyLineStyles();

      if (!isDraftId(viewId)) {
        persistSlTp(view, kind, price);
      } else {
        toast(
          kind === "sl" ? `SL · ${fmtPrice(price, view.position.symbol)}` : `TP · ${fmtPrice(price, view.position.symbol)}`,
        );
      }

      updatePriceTags(view, viewId);
      scheduleReposition();
    }
    if (anyDrag) chart?.applyOptions({ handleScroll: true, handleScale: true });
  }

  function onBackgroundPointerDown(event) {
    const target = event.target;
    if (
      target.closest(
        ".afx-position-label, .afx-entry-marker, .afx-position-flag, .afx-position-close, .afx-position-confirm, .afx-position-row, .afx-price-tag, .afx-trade-widget, .trade-ticket",
      )
    ) {
      return;
    }
    setActive(null);
  }

  function removeView(id) {
    const view = views.get(id);
    if (!view) return;
    if (view.drag?.previewLine) removeLine(view.drag.previewLine);
    removeLine(view.entryLine);
    if (view.slLine) removeLine(view.slLine);
    if (view.tpLine) removeLine(view.tpLine);
    view.row.remove();
    view.confirmBtn?.remove();
    view.entryMarker?.remove();
    view.slFlag.remove();
    view.slClose.remove();
    view.tpFlag.remove();
    view.tpClose.remove();
    view.entryPriceTag.remove();
    view.slPriceTag.remove();
    view.tpPriceTag.remove();
    views.delete(id);
    if (activeId === id) setActive(null);
  }

  function clearSl(id) {
    const view = views.get(id);
    if (!view || view.position.sl == null) return;
    clearLevelLine(view, "sl");
    view.position.sl = null;
    if (!isDraftId(id)) {
      clearSlTpOnServer(view, "sl").then(() => toast("Stop loss removed")).catch((e) => toast(e?.message || "Error", "error"));
    }
    scheduleReposition();
  }

  function clearTp(id) {
    const view = views.get(id);
    if (!view || view.position.tp == null) return;
    clearLevelLine(view, "tp");
    view.position.tp = null;
    if (!isDraftId(id)) {
      clearSlTpOnServer(view, "tp").then(() => toast("Take profit removed")).catch((e) => toast(e?.message || "Error", "error"));
    }
    scheduleReposition();
  }

  async function confirmDraft(id) {
    const view = views.get(id);
    if (!view || view.position.status !== "draft") return;
    const marketPrice = getMarketPrice();
    const side = String(view.position.side).toLowerCase();
    const entryError = validateOrderPrice(side, view.position.orderKind, view.position.price, marketPrice);
    if (entryError) {
      toast(entryError, "error");
      return;
    }
    if (view.position.sl != null) {
      const slError = validateSlTp(side, view.position.price, "sl", view.position.sl);
      if (slError) {
        toast(slError, "error");
        return;
      }
    }
    if (view.position.tp != null) {
      const tpError = validateSlTp(side, view.position.price, "tp", view.position.tp);
      if (tpError) {
        toast(tpError, "error");
        return;
      }
    }
    const fn = ctx().submitDraftOrder;
    if (!fn) {
      toast("Order submission unavailable", "error");
      return;
    }
    try {
      await fn({
        side: view.position.side,
        volume: view.position.volume,
        orderKind: view.position.orderKind,
        price: view.position.price,
        sl: view.position.sl,
        tp: view.position.tp,
      });
      removeView(id);
    } catch (e) {
      toast(e?.message || "Order failed", "error");
    }
  }

  function closePosition(id) {
    const view = views.get(id);
    if (!view) return;
    const { status } = view.position;
    if (isDraftId(id)) {
      removeView(id);
      toast("Order discarded", "info");
      return;
    }
    if (status === "pending") {
      ctx().cancelPendingOrder?.(Number(id));
      return;
    }
    ctx().closePosition?.(Number(id));
  }

  function openPosition(position) {
    if (views.has(position.id)) return;
    const side = String(position.side).toLowerCase();
    const sideColor = SIDE_COLOR[side] || SIDE_COLOR.buy;
    const isDraft = position.status === "draft";
    const isPending = position.status === "pending";

    const entryLine = series.createPriceLine({
      price: position.price,
      color: sideColor,
      lineWidth: 1,
      lineStyle: isDraft || isPending ? LC().LineStyle.Dashed : LC().LineStyle.Dotted,
      lineVisible: true,
      axisLabelVisible: false,
      title: "",
    });

    const row = document.createElement("div");
    row.className = `afx-position-row afx-position-row--${side}`;
    if (isDraft) row.classList.add("afx-position-row--draft");
    if (isPending) row.classList.add("afx-position-row--pending");
    row.dataset.positionId = position.id;

    const label = document.createElement("div");
    label.className = "afx-position-label";
    if (isOrderEntryDraggable(position)) label.classList.add("afx-position-label--draggable");
    label.textContent = formatPositionLabel(position);

    let confirmBtn = null;
    if (isDraft) {
      confirmBtn = createConfirmButton();
      confirmBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmDraft(position.id);
      });
    }

    const positionClose = createCloseButton(
      isDraft ? "Discard order" : isPending ? "Cancel order" : "Close position",
    );
    positionClose.addEventListener("click", (e) => {
      e.stopPropagation();
      closePosition(position.id);
    });

    const slFlag = createFlag("sl", "Drag to set stop loss");
    const slClose = createCloseButton("Remove stop loss");
    const tpFlag = createFlag("tp", "Drag to set take profit");
    const tpClose = createCloseButton("Remove take profit");
    const entryMarker = createEntryMarker(side);

    entryMarker.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      setActive(position.id, "entry");
      if (isOrderEntryDraggable(position)) startDrag(position.id, "entry", e);
    });

    label.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      setActive(position.id, "entry");
      if (isOrderEntryDraggable(position)) startDrag(position.id, "entry", e);
    });

    slFlag.addEventListener("pointerdown", (e) => {
      if (!canSetSlTp(position)) return;
      e.stopPropagation();
      setActive(position.id, "sl");
      startDrag(position.id, "sl", e);
    });
    tpFlag.addEventListener("pointerdown", (e) => {
      if (!canSetSlTp(position)) return;
      e.stopPropagation();
      setActive(position.id, "tp");
      startDrag(position.id, "tp", e);
    });

    slClose.addEventListener("click", (e) => {
      e.stopPropagation();
      clearSl(position.id);
    });
    tpClose.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTp(position.id);
    });

    row.append(label);
    if (confirmBtn) row.append(confirmBtn);
    row.append(positionClose);
    layer.appendChild(row);

    const entryPriceTag = createPriceTag("entry");
    const slPriceTag = createPriceTag("sl");
    const tpPriceTag = createPriceTag("tp");

    const view = {
      position,
      entryLine,
      slLine: null,
      tpLine: null,
      row,
      label,
      entryMarker,
      confirmBtn,
      positionClose,
      slFlag,
      slClose,
      tpFlag,
      tpClose,
      entryPriceTag,
      slPriceTag,
      tpPriceTag,
      drag: null,
    };

    if (position.sl != null) {
      view.slLine = createLevelLine(position.sl, "#f6465d");
    }
    if (position.tp != null) {
      view.tpLine = createLevelLine(position.tp, "#0ecb81");
    }

    views.set(position.id, view);
    scheduleReposition();
    setActive(position.id, "entry");
  }

  function repositionAll() {
    const frame = getPlotFrame();
    for (const view of views.values()) {
      const entryY = priceToLocalY(view.position.price);
      const entryX = timeToLocalX(resolvePositionTime(view.position));
      if (
        entryY == null ||
        entryX == null ||
        entryY < frame.top ||
        entryY > frame.top + frame.height ||
        entryX < frame.left ||
        entryX > frame.left + frame.width
      ) {
        view.row.style.visibility = "hidden";
        if (view.entryMarker) view.entryMarker.style.visibility = "hidden";
        hideLevel(view.slFlag, view.slClose);
        hideLevel(view.tpFlag, view.tpClose);
        continue;
      }

      const side = String(view.position.side).toLowerCase();
      view.entryMarker.style.visibility = "visible";
      view.entryMarker.style.left = `${entryX}px`;
      view.entryMarker.style.top = `${entryY}px`;
      view.entryMarker.style.transform =
        side === "sell" ? "translate(-50%, -100%)" : "translate(-50%, 0)";

      view.row.style.visibility = "visible";
      view.row.style.display = "flex";
      view.row.style.top = `${entryY}px`;
      view.row.style.left = `${entryX + 10}px`;
      view.row.style.transform = "translateY(-50%)";
      view.positionClose.style.visibility = "visible";
      if (view.confirmBtn) view.confirmBtn.style.visibility = "visible";

      const slPrice = view.position.sl ?? view.position.price;
      const tpPrice = view.position.tp ?? view.position.price;

      if (!view.drag || view.drag.kind !== "sl") {
        positionLevel(view, "sl", slPrice, 0, false);
      }
      if (!view.drag || view.drag.kind !== "tp") {
        positionLevel(view, "tp", tpPrice, 1, false);
      }

      updatePriceTags(view, view.row.dataset.positionId ?? "");
    }
  }

  function positionTime(pos) {
    if (pos.opened_time != null && ctx().snapBarTime) return ctx().snapBarTime(pos.opened_time);
    return ctx().fallbackTime?.() ?? null;
  }

  function mapOpen(pos) {
    return {
      id: String(pos.id),
      side: String(pos.side).toLowerCase(),
      price: Number(pos.entry),
      volume: Number(pos.volume),
      sl: pos.sl != null && pos.sl !== "" ? Number(pos.sl) : null,
      tp: pos.tp != null && pos.tp !== "" ? Number(pos.tp) : null,
      orderKind: "market",
      status: "open",
      symbol: pos.symbol,
      opened_time: pos.opened_time ?? null,
      time: positionTime(pos),
    };
  }

  function mapPending(p) {
    return {
      id: String(p.id),
      side: String(p.side).toLowerCase(),
      price: Number(p.price),
      volume: Number(p.volume),
      sl: p.sl != null && p.sl !== "" ? Number(p.sl) : null,
      tp: p.tp != null && p.tp !== "" ? Number(p.tp) : null,
      orderKind: String(p.order_type || "limit").toLowerCase(),
      status: "pending",
      symbol: p.symbol,
      opened_time: p.opened_time ?? null,
      time: positionTime(p),
    };
  }

  function sync() {
    if (!series || !layer) return;
    const sym = ctx().activeSymbol;
    const serverIds = new Set();
    for (const pos of ctx().open || []) {
      if (pos.symbol !== sym) continue;
      serverIds.add(String(pos.id));
      const mapped = mapOpen(pos);
      const existing = views.get(mapped.id);
      if (existing) {
        existing.position = { ...existing.position, ...mapped };
        existing.entryLine.applyOptions({ price: mapped.price });
        existing.label.textContent = formatPositionLabel(existing.position);
        if (mapped.sl != null) {
          if (existing.position.sl !== mapped.sl) {
            clearLevelLine(existing, "sl");
            existing.position.sl = mapped.sl;
            existing.slLine = createLevelLine(mapped.sl, "#f6465d");
          }
        } else if (existing.position.sl != null) {
          clearLevelLine(existing, "sl");
          existing.position.sl = null;
        }
        if (mapped.tp != null) {
          if (existing.position.tp !== mapped.tp) {
            clearLevelLine(existing, "tp");
            existing.position.tp = mapped.tp;
            existing.tpLine = createLevelLine(mapped.tp, "#0ecb81");
          }
        } else if (existing.position.tp != null) {
          clearLevelLine(existing, "tp");
          existing.position.tp = null;
        }
      } else {
        openPosition(mapped);
      }
    }
    for (const p of ctx().pending || []) {
      if (p.symbol !== sym) continue;
      serverIds.add(String(p.id));
      const mapped = mapPending(p);
      const existing = views.get(mapped.id);
      if (existing) {
        existing.position = { ...existing.position, ...mapped };
        existing.entryLine.applyOptions({ price: mapped.price });
        existing.label.textContent = formatPositionLabel(existing.position);
      } else {
        openPosition(mapped);
      }
    }
    for (const [id] of views) {
      if (isDraftId(id)) continue;
      if (!serverIds.has(id)) removeView(id);
    }
    scheduleReposition();
  }

  function openDraft({ side, volume, orderKind, price }) {
    if (!series || !layer) return null;
    const sym = ctx().activeSymbol;
    const id = `draft-${draftCounter++}`;
    const marketPrice = getMarketPrice();
    let entryPrice = price;
    if (String(orderKind).toLowerCase() === "market") entryPrice = marketPrice;
    else if (entryPrice == null) entryPrice = marketPrice;

    openPosition({
      id,
      side: String(side).toLowerCase(),
      price: entryPrice,
      volume,
      sl: null,
      tp: null,
      orderKind: String(orderKind).toLowerCase(),
      status: "draft",
      symbol: sym,
      time: ctx().snapBarTime?.(Math.floor(Date.now() / 1000)) ?? ctx().fallbackTime?.(),
    });
    return id;
  }

  function clear() {
    for (const id of [...views.keys()]) removeView(id);
  }

  function attach({ chart: c, series: s, container: el, getContext: gc }) {
    chart = c;
    series = s;
    chartEl = el;
    getContext = gc;
    mountEl = el.parentElement || el;

    if (!layer) {
      layer = document.createElement("div");
      layer.className = "afx-position-layer";
      layer.addEventListener("pointermove", onPointerMove);
      layer.addEventListener("pointerup", onPointerUp);
      layer.addEventListener("pointercancel", onPointerUp);
    }

    const host =
      mountEl.querySelector("#trade-pos-overlays")?.parentElement || mountEl;
    if (layer.parentElement !== host) {
      host.appendChild(layer);
    }

    mountEl.removeEventListener("pointerdown", onBackgroundPointerDown);
    mountEl.addEventListener("pointerdown", onBackgroundPointerDown);
    subscribeRange();
    sync();
  }

  function detach() {
    unsubscribeRange();
    mountEl?.removeEventListener("pointerdown", onBackgroundPointerDown);
    clear();
    chart = null;
    series = null;
    chartEl = null;
    mountEl = null;
    getContext = null;
  }

  window.AlphaFXPositionOverlay = {
    attach,
    detach,
    sync,
    clear,
    openDraft,
    setActive,
  };
})();

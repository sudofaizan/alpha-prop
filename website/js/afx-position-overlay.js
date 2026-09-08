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
  let dragListenersBound = false;
  /** @type {Map<string, { unixSec: number, barTime: number }>} */
  const fillAnchors = new Map();
  /** @type {Map<string, { side: string, exit: number, unixSec: number, barTime: number, symbol: string }>} */
  const closeAnchors = new Map();
  /** @type {Map<string, { id: string, side: string, price: number, barTime: number, symbol: string, el: HTMLElement }>} */
  const closeMarkers = new Map();
  /** @type {Map<string, { id: string, side: string, price: number, barTime: number, symbol: string, el: HTMLElement }>} */
  const closedEntryMarkers = new Map();
  /** @type {Map<string, { line: SVGLineElement, side: string }>} */
  const tradeConnectors = new Map();
  let connectorSvg = null;
  const trackedCloseIds = new Set();

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
    const kind = String(position.orderKind || "limit").toLowerCase();
    if (kind === "market") return false;
    return position.status === "draft" || position.status === "pending";
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

  function normalizeUnixSec(t) {
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }

  /** Reject values that look like prices/volumes mistaken for unix time. */
  function isPlausibleUnixSec(sec) {
    return sec != null && sec >= 1_000_000_000;
  }

  function resolveBarTime(unixSec) {
    const sec = normalizeUnixSec(unixSec);
    if (sec == null || !isPlausibleUnixSec(sec)) return null;

    const bars = ctx().barBuffer || [];
    const step = ctx().tfStep?.(ctx().activeTimeframe) || 60;
    const bucket = ctx().snapBarTime?.(sec) ?? null;
    if (bucket == null) return null;

    if (!bars.length) return bucket;

    const first = bars[0].time;
    const last = bars[bars.length - 1].time;
    if (bucket < first || bucket >= last + step) return null;
    if (!bars.some((b) => b.time === bucket)) return null;
    return bucket;
  }

  function resolvePositionUnixSec(position) {
    const id = String(position.id ?? "");
    const anchor = fillAnchors.get(id);
    if (anchor?.unixSec != null) {
      const sec = normalizeUnixSec(anchor.unixSec);
      if (sec != null && isPlausibleUnixSec(sec)) return sec;
    }
    if (position.opened_time != null) {
      const sec = normalizeUnixSec(position.opened_time);
      if (sec != null && isPlausibleUnixSec(sec)) return sec;
    }
    if (position.time != null) {
      const sec = normalizeUnixSec(position.time);
      if (sec != null && isPlausibleUnixSec(sec)) return sec;
    }
    return null;
  }

  function resolveCloseUnixSec(marker) {
    const anchor = closeAnchors.get(String(marker.id));
    if (anchor?.unixSec != null) {
      const sec = normalizeUnixSec(anchor.unixSec);
      if (sec != null && isPlausibleUnixSec(sec)) return sec;
    }
    if (marker.unixTime != null) {
      const sec = normalizeUnixSec(marker.unixTime);
      if (sec != null && isPlausibleUnixSec(sec)) return sec;
    }
    return null;
  }

  function resolvePositionTime(position) {
    const sec = resolvePositionUnixSec(position);
    if (sec != null) {
      const t = resolveBarTime(sec);
      if (t != null) return t;
    }
    const id = String(position.id ?? "");
    const anchor = fillAnchors.get(id);
    if (anchor?.barTime != null) {
      const bars = ctx().barBuffer || [];
      if (bars.some((b) => b.time === anchor.barTime)) return anchor.barTime;
    }
    return ctx().fallbackTime?.() ?? null;
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function setFillAnchor(tradeId, anchor) {
    if (tradeId == null || !anchor?.barTime) return;
    fillAnchors.set(String(tradeId), {
      unixSec: normalizeUnixSec(anchor.unixSec) ?? nowSec(),
      barTime: anchor.barTime,
    });
    scheduleReposition();
  }

  function clearFillAnchor(tradeId) {
    fillAnchors.delete(String(tradeId));
  }

  function timeToLocalXForUnix(unixSec) {
    if (!chart || unixSec == null) return null;
    const sec = normalizeUnixSec(unixSec);
    if (sec == null || !isPlausibleUnixSec(sec)) return null;
    if (resolveBarTime(sec) == null) return null;

    const frame = getPlotFrame();
    const ts = chart.timeScale();

    try {
      const x = ts.timeToCoordinate(sec);
      if (x != null && Number.isFinite(x)) return frame.left + x;
    } catch {
      /* fallback below */
    }

    const barTime = resolveBarTime(sec);
    if (barTime != null) {
      try {
        const x = ts.timeToCoordinate(barTime);
        if (x != null && Number.isFinite(x)) return frame.left + x;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function clientYToPrice(clientY) {
    if (!series || !chartEl) return null;
    const chartRect = chartEl.getBoundingClientRect();
    const paneY = clientY - chartRect.top;
    const price = series.coordinateToPrice(paneY);
    return price ?? null;
  }

  function ensureDragListeners() {
    if (dragListenersBound) return;
    dragListenersBound = true;
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
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
    return btn;
  }

  function createCloseButton(title, extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `afx-position-close${extraClass ? ` ${extraClass}` : ""}`;
    btn.textContent = "×";
    btn.title = title;
    btn.setAttribute("aria-label", title);
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

  function createDragGrip() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "afx-order-grip";
    btn.title = "Drag to move order price";
    btn.setAttribute("aria-label", "Drag order price");
    btn.innerHTML = '<span class="afx-order-grip-dots" aria-hidden="true"></span>';
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
      view.entryMarker?.classList.toggle("afx-entry-marker--focused", id === activeId && activeFocus === "entry");
    }
    for (const [id, view] of views) {
      updateRowChrome(view);
      updatePriceTags(view, id);
    }
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

  function createCloseMarker(positionSide) {
    const side = String(positionSide).toLowerCase();
    const el = document.createElement("div");
    el.className = `afx-close-marker afx-close-marker--from-${side}`;
    el.setAttribute("aria-hidden", "true");
    el.title = side === "buy" ? "Buy closed" : "Sell closed";
    layer.appendChild(el);
    return el;
  }

  function closeMarkerTransform(positionSide) {
    const side = String(positionSide).toLowerCase();
    // Buy close → red down arrow; sell close → green up arrow
    return side === "buy" ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  }

  function ensureConnectorSvg() {
    if (connectorSvg) return connectorSvg;
    connectorSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectorSvg.classList.add("afx-trade-connectors");
    connectorSvg.setAttribute("aria-hidden", "true");
    layer.insertBefore(connectorSvg, layer.firstChild);
    return connectorSvg;
  }

  function connectorStroke(side) {
    return String(side).toLowerCase() === "buy" ? "#0ecb81" : "#f6465d";
  }

  function ensureTradeConnector(tradeId) {
    const id = String(tradeId);
    const entry = closedEntryMarkers.get(id);
    const close = closeMarkers.get(id);
    if (!entry || !close) return;

    let conn = tradeConnectors.get(id);
    if (!conn) {
      const svg = ensureConnectorSvg();
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("afx-trade-connector");
      line.dataset.tradeId = id;
      svg.appendChild(line);
      conn = { line, side: entry.side };
      tradeConnectors.set(id, conn);
    } else {
      conn.side = entry.side;
    }
    conn.line.setAttribute("stroke", connectorStroke(entry.side));
    scheduleReposition();
  }

  function removeTradeConnector(tradeId) {
    const id = String(tradeId);
    const conn = tradeConnectors.get(id);
    if (!conn) return;
    conn.line.remove();
    tradeConnectors.delete(id);
    if (connectorSvg && !connectorSvg.childElementCount) {
      connectorSvg.remove();
      connectorSvg = null;
    }
  }

  function markerPointVisible(x, y, frame) {
    return (
      x != null &&
      y != null &&
      y >= frame.top &&
      y <= frame.top + frame.height &&
      x >= frame.left &&
      x <= frame.left + frame.width
    );
  }

  function repositionTradeConnectors() {
    if (!connectorSvg) return;
    const frame = getPlotFrame();
    const sym = ctx().activeSymbol;
    for (const [tradeId, conn] of tradeConnectors) {
      const entry = closedEntryMarkers.get(tradeId);
      const close = closeMarkers.get(tradeId);
      if (!entry || !close || entry.symbol !== sym || close.symbol !== sym) {
        conn.line.style.visibility = "hidden";
        continue;
      }

      const x1 = timeToLocalXForUnix(entry.unixTime);
      const y1 = priceToLocalY(entry.price);
      const x2 = timeToLocalXForUnix(resolveCloseUnixSec(close));
      const y2 = priceToLocalY(close.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) {
        conn.line.style.visibility = "hidden";
        continue;
      }
      const entryVisible = markerPointVisible(x1, y1, frame);
      const closeVisible = markerPointVisible(x2, y2, frame);
      if (!entryVisible && !closeVisible) {
        conn.line.style.visibility = "hidden";
        continue;
      }

      conn.line.setAttribute("x1", String(x1));
      conn.line.setAttribute("y1", String(y1));
      conn.line.setAttribute("x2", String(x2));
      conn.line.setAttribute("y2", String(y2));
      conn.line.setAttribute("stroke", connectorStroke(entry.side));
      conn.line.style.visibility = "visible";
    }
  }

  function resolveCloseBarTime(closedTime, anchor) {
    if (anchor?.barTime != null) {
      const bars = ctx().barBuffer || [];
      if (bars.some((b) => b.time === anchor.barTime)) return anchor.barTime;
    }
    if (closedTime != null) return resolveBarTime(closedTime);
    return null;
  }

  function upsertClosedEntryMarker({ id, side, price, unixTime, barTime, symbol }) {
    const tradeId = String(id);
    const sec = normalizeUnixSec(unixTime);
    if (price == null || sec == null || !isPlausibleUnixSec(sec)) return;
    const sym = symbol || ctx().activeSymbol;
    const resolvedBar = barTime ?? resolveBarTime(sec);
    let marker = closedEntryMarkers.get(tradeId);
    if (!marker) {
      marker = {
        id: tradeId,
        side: String(side).toLowerCase(),
        price: Number(price),
        unixTime: sec,
        barTime: resolvedBar,
        symbol: sym,
        el: createEntryMarker(side),
      };
      closedEntryMarkers.set(tradeId, marker);
    } else {
      marker.side = String(side).toLowerCase();
      marker.price = Number(price);
      marker.unixTime = sec;
      marker.barTime = resolvedBar;
      marker.symbol = sym;
      marker.el.className = `afx-entry-marker afx-entry-marker--${marker.side}`;
    }
    trackedCloseIds.add(tradeId);
    ensureTradeConnector(tradeId);
  }

  function upsertCloseMarker({ id, side, price, barTime, unixTime, symbol }) {
    const tradeId = String(id);
    const sec = normalizeUnixSec(unixTime);
    if (price == null || sec == null || !isPlausibleUnixSec(sec)) return;
    const sym = symbol || ctx().activeSymbol;
    const resolvedBar = barTime ?? resolveBarTime(sec);
    let marker = closeMarkers.get(tradeId);
    if (!marker) {
      marker = {
        id: tradeId,
        side: String(side).toLowerCase(),
        price: Number(price),
        unixTime: sec,
        barTime: resolvedBar,
        symbol: sym,
        el: createCloseMarker(side),
      };
      closeMarkers.set(tradeId, marker);
    } else {
      marker.side = String(side).toLowerCase();
      marker.price = Number(price);
      marker.unixTime = sec;
      marker.barTime = resolvedBar;
      marker.symbol = sym;
      marker.el.className = `afx-close-marker afx-close-marker--from-${marker.side}`;
      marker.el.title = marker.side === "buy" ? "Buy closed" : "Sell closed";
    }
    trackedCloseIds.add(tradeId);
    ensureTradeConnector(tradeId);
    scheduleReposition();
  }

  function removeCloseMarker(id) {
    const marker = closeMarkers.get(String(id));
    if (!marker) return;
    marker.el.remove();
    closeMarkers.delete(String(id));
    removeTradeConnector(id);
  }

  function removeClosedEntryMarker(id) {
    const marker = closedEntryMarkers.get(String(id));
    if (!marker) return;
    marker.el.remove();
    closedEntryMarkers.delete(String(id));
    removeTradeConnector(id);
  }

  function persistClosedEntryMarker(id, view) {
    if (!view?.entryMarker || view.position.status !== "open") return;
    const tradeId = String(id);
    if (closedEntryMarkers.has(tradeId)) return;
    const side = String(view.position.side).toLowerCase();
    const unixSec = resolvePositionUnixSec(view.position) ?? nowSec();
    if (!isPlausibleUnixSec(unixSec) || resolveBarTime(unixSec) == null) return;
    closedEntryMarkers.set(tradeId, {
      id: tradeId,
      side,
      price: Number(view.position.price),
      unixTime: unixSec,
      barTime: resolveBarTime(unixSec),
      symbol: view.position.symbol || ctx().activeSymbol,
      el: view.entryMarker,
    });
    view.entryMarker = null;
    ensureTradeConnector(tradeId);
  }

  function repositionClosedEntryMarkers() {
    const frame = getPlotFrame();
    const sym = ctx().activeSymbol;
    for (const marker of closedEntryMarkers.values()) {
      if (marker.symbol !== sym) {
        marker.el.style.visibility = "hidden";
        continue;
      }
      const x = timeToLocalXForUnix(marker.unixTime);
      const y = priceToLocalY(marker.price);
      if (x == null || y == null) {
        marker.el.style.visibility = "hidden";
        continue;
      }
      if (
        y < frame.top ||
        y > frame.top + frame.height ||
        x < frame.left ||
        x > frame.left + frame.width
      ) {
        marker.el.style.visibility = "hidden";
        continue;
      }
      marker.el.style.visibility = "visible";
      marker.el.style.left = `${x}px`;
      marker.el.style.top = `${y}px`;
      marker.el.style.transform =
        marker.side === "sell" ? "translate(-50%, -100%)" : "translate(-50%, 0)";
    }
  }

  function ensureCloseMarkerFromClose(id, openPosition) {
    const tradeId = String(id);
    const sym = ctx().activeSymbol;
    const anchor = closeAnchors.get(tradeId);
    const closed = (ctx().closed || []).find((c) => String(c.id) === tradeId);
    const markerSymbol = closed?.symbol || openPosition?.symbol || anchor?.symbol;
    if (markerSymbol && markerSymbol !== sym) return;

    const side = String(closed?.side || openPosition?.side || anchor?.side || "buy").toLowerCase();
    let exit =
      closed?.exit != null && closed.exit !== ""
        ? Number(closed.exit)
        : anchor?.exit != null
          ? Number(anchor.exit)
          : null;
    const closedTime = closed?.closed_time ?? anchor?.unixSec ?? null;
    if (exit == null || closedTime == null) {
      if (openPosition || anchor) trackedCloseIds.add(tradeId);
      return;
    }

    upsertCloseMarker({
      id: tradeId,
      side,
      price: exit,
      unixTime: closedTime,
      barTime: resolveCloseBarTime(closedTime, anchor),
      symbol: markerSymbol || sym,
    });
  }

  function syncClosedHistory() {
    if (!layer) return;
    const sym = ctx().activeSymbol;
    const historyIds = new Set();

    for (const trade of ctx().closed || []) {
      if (trade.symbol !== sym) continue;
      const id = String(trade.id);
      const side = String(trade.side).toLowerCase();
      const entry = trade.entry != null && trade.entry !== "" ? Number(trade.entry) : null;
      const exit = trade.exit != null && trade.exit !== "" ? Number(trade.exit) : null;
      const openedTime = trade.opened_time ?? null;
      const closedTime = trade.closed_time ?? null;
      if (entry == null || exit == null || openedTime == null || closedTime == null) continue;
      const entryBar = resolveBarTime(openedTime);
      const closeBar = resolveBarTime(closedTime);
      if (entryBar == null || closeBar == null) continue;

      historyIds.add(id);
      upsertClosedEntryMarker({
        id,
        side,
        price: entry,
        unixTime: openedTime,
        barTime: entryBar,
        symbol: sym,
      });
      upsertCloseMarker({
        id,
        side,
        price: exit,
        unixTime: closedTime,
        barTime: closeBar,
        symbol: sym,
      });
    }

    for (const id of [...closedEntryMarkers.keys()]) {
      const marker = closedEntryMarkers.get(id);
      if (marker?.symbol === sym && !historyIds.has(id)) removeClosedEntryMarker(id);
    }
    for (const id of [...closeMarkers.keys()]) {
      const marker = closeMarkers.get(id);
      if (marker?.symbol === sym && !historyIds.has(id)) removeCloseMarker(id);
    }
  }

  function syncCloseMarkers() {
    for (const tradeId of trackedCloseIds) {
      if (!closeMarkers.has(tradeId)) {
        ensureCloseMarkerFromClose(tradeId, null);
      }
    }
  }

  function repositionCloseMarkers() {
    const frame = getPlotFrame();
    const sym = ctx().activeSymbol;
    for (const marker of closeMarkers.values()) {
      if (marker.symbol !== sym) {
        marker.el.style.visibility = "hidden";
        continue;
      }
      const x = timeToLocalXForUnix(resolveCloseUnixSec(marker));
      const y = priceToLocalY(marker.price);
      if (x == null || y == null) {
        marker.el.style.visibility = "hidden";
        continue;
      }
      if (
        y < frame.top ||
        y > frame.top + frame.height ||
        x < frame.left ||
        x > frame.left + frame.width
      ) {
        marker.el.style.visibility = "hidden";
        continue;
      }
      marker.el.style.visibility = "visible";
      marker.el.style.left = `${x}px`;
      marker.el.style.top = `${y}px`;
      marker.el.style.transform = closeMarkerTransform(marker.side);
    }
  }

  function setCloseAnchor(tradeId, anchor) {
    if (tradeId == null || !anchor) return;
    const exit = anchor.exit != null ? Number(anchor.exit) : null;
    if (exit == null || !Number.isFinite(exit)) return;
    const unixSec = normalizeUnixSec(anchor.unixSec) ?? nowSec();
    const barTime =
      anchor.barTime ??
      resolveBarTime(unixSec);
    closeAnchors.set(String(tradeId), {
      side: String(anchor.side || "buy").toLowerCase(),
      exit,
      unixSec,
      barTime,
      symbol: anchor.symbol || ctx().activeSymbol,
    });
    trackedCloseIds.add(String(tradeId));
    ensureCloseMarkerFromClose(tradeId, {
      side: anchor.side,
      symbol: anchor.symbol,
    });
  }

  function updatePriceTags(view, viewId) {
    const selected = viewId === activeId;
    view.entryPriceTag.hidden = true;
    view.slPriceTag.hidden = true;
    view.tpPriceTag.hidden = true;
    if (!selected || activeFocus == null) return;
    const frame = getPlotFrame();
    const sym = view.position.symbol;
    const anchorX = timeToLocalXForUnix(resolvePositionUnixSec(view.position));
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

  function fmtPnlDisplay(pnl) {
    const n = Number(pnl || 0);
    if (n === 0) return "$0.00";
    const sign = n > 0 ? "+" : "-";
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  function pnlClass(pnl) {
    const n = Number(pnl || 0);
    if (n > 0) return "positive";
    if (n < 0) return "negative";
    return "";
  }

  function livePnlFor(position) {
    const live = (ctx().open || []).find((p) => String(p.id) === String(position.id));
    return live?.pnl ?? position.pnl ?? 0;
  }

  function updatePnlDisplay(view) {
    if (!view.pnlEl) return;
    const pnl = livePnlFor(view.position);
    view.pnlEl.textContent = fmtPnlDisplay(pnl);
    view.pnlEl.classList.remove("positive", "negative");
    const cls = pnlClass(pnl);
    if (cls) view.pnlEl.classList.add(cls);
    if (view.volEl) {
      view.volEl.textContent = Number(view.position.volume).toFixed(2);
    }
  }

  function updateRowChrome(view) {
    const id = view.row?.dataset?.positionId ?? "";
    if (view.tpFlag) {
      view.tpFlag.classList.toggle("afx-position-flag--focused", id === activeId && activeFocus === "tp");
    }
    if (view.slFlag) {
      view.slFlag.classList.toggle("afx-position-flag--focused", id === activeId && activeFocus === "sl");
    }
    updatePnlDisplay(view);
  }

  function hideLevel(flag, close) {
    if (flag) flag.style.visibility = "hidden";
    if (close) close.style.visibility = "hidden";
  }

  function levelPrice(view, kind) {
    if (view.drag?.kind === kind && view.drag.previewLine) {
      try {
        const p = view.drag.previewLine.options?.().price;
        if (p != null) return Number(p);
      } catch {
        /* ignore */
      }
    }
    if (kind === "sl") {
      return view.position.sl != null ? Number(view.position.sl) : Number(view.position.price);
    }
    return view.position.tp != null ? Number(view.position.tp) : Number(view.position.price);
  }

  function flagAnchorRightOfRow(view, entryX, slot) {
    const rowLeft = entryX + 8;
    const rowWidth = view.row.offsetWidth || 0;
    if (view.row.style.visibility !== "hidden" && rowWidth > 0) {
      return rowLeft + rowWidth + 8 + slot * 28;
    }
    return entryX + 8 + slot * 28;
  }

  /** Anchor on the SL/TP horizontal line at the entry candle column */
  function flagAnchorOnLine(entryX, slot) {
    return entryX + 10 + slot * 24;
  }

  function positionLevel(view, kind, price, slot) {
    if (!canSetSlTp(view.position)) {
      hideLevel(view.slFlag, view.slClose);
      hideLevel(view.tpFlag, view.tpClose);
      return;
    }

    const flag = kind === "sl" ? view.slFlag : view.tpFlag;
    const close = kind === "sl" ? view.slClose : view.tpClose;
    const isSet = kind === "sl" ? view.position.sl != null : view.position.tp != null;
    const dragging = view.drag?.kind === kind;
    const y = priceToLocalY(price);
    const frame = getPlotFrame();
    if (y == null || y < frame.top || y > frame.top + frame.height) {
      hideLevel(flag, close);
      return;
    }

    const entryX = timeToLocalXForUnix(resolvePositionUnixSec(view.position));
    if (entryX == null) {
      hideLevel(flag, close);
      return;
    }

    const baseLeft =
      isSet || dragging
        ? flagAnchorOnLine(entryX, slot)
        : flagAnchorRightOfRow(view, entryX, slot);
    const viewId = view.row.dataset.positionId ?? "";
    const focused = viewId === activeId && activeFocus === kind;

    flag.style.visibility = "visible";
    flag.style.position = "absolute";
    flag.style.top = `${y}px`;
    flag.style.left = `${baseLeft}px`;
    flag.style.zIndex = "16";
    flag.style.transform = focused ? "translateY(-50%) scale(1.12)" : "translateY(-50%)";

    if (isSet || dragging) {
      close.style.visibility = "visible";
      close.style.position = "absolute";
      close.style.top = `${y}px`;
      close.style.left = `${baseLeft + 22}px`;
      close.style.zIndex = "16";
      close.style.transform = "translateY(-50%)";
    } else {
      close.style.visibility = "hidden";
    }
  }

  function updateLivePnlAll() {
    for (const view of views.values()) updatePnlDisplay(view);
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
      scheduleReposition();
      updatePriceTags(view, viewId);
      return;
    }
    view.drag.previewLine?.applyOptions({ price });
    updatePriceTags(view, viewId);
    scheduleReposition();
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
    ensureDragListeners();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore — document listeners handle move/up */
    }

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

  async function persistPendingOrder(view, patch = {}) {
    const id = view.position.id;
    if (isDraftId(id) || view.position.status !== "pending") return;
    const accountId = ctx().accountId;
    if (!accountId || !window.AlphaFXApi) return;

    const body = { account_id: accountId };
    if (patch.price != null) body.price = Number(patch.price);
    else body.price = Number(view.position.price);
    if ("sl" in patch) body.stop_loss = patch.sl;
    if ("tp" in patch) body.take_profit = patch.tp;

    const paths = [
      { method: "PATCH", url: `/api/v1/trade/orders/pending/${id}` },
      { method: "POST", url: `/api/v1/trade/orders/pending/${id}/update` },
    ];

    let lastErr = null;
    for (const { method, url } of paths) {
      try {
        await window.AlphaFXApi.request(url, {
          method,
          body: JSON.stringify(body),
        });
        const pending = ctx().pending || [];
        const row = pending.find((p) => String(p.id) === String(id));
        if (row) {
          if (patch.price != null) row.price = patch.price;
          if ("sl" in patch) row.sl = patch.sl;
          if ("tp" in patch) row.tp = patch.tp;
        }
        if (patch.price != null) {
          toast(`Order · ${fmtPrice(patch.price, view.position.symbol)}`);
        } else if ("sl" in patch) {
          toast(
            patch.sl == null
              ? "Stop loss removed"
              : `Stop loss · ${fmtPrice(patch.sl, view.position.symbol)}`,
          );
        } else if ("tp" in patch) {
          toast(
            patch.tp == null
              ? "Take profit removed"
              : `Take profit · ${fmtPrice(patch.tp, view.position.symbol)}`,
          );
        }
        ctx().reloadSnapshot?.();
        return;
      } catch (e) {
        lastErr = e;
        if (e?.status !== 404 && e?.status !== 405) break;
      }
    }
    toast(lastErr?.message || "Could not update order", "error");
    sync();
  }

  async function persistSlTp(view, kind, price) {
    const id = view.position.id;
    if (isDraftId(id)) return;
    if (view.position.status === "pending") {
      return persistPendingOrder(view, kind === "sl" ? { sl: price } : { tp: price });
    }
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
    if (view.position.status === "pending") {
      return persistPendingOrder(view, kind === "sl" ? { sl: null } : { tp: null });
    }
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

  async function persistPendingPrice(view) {
    return persistPendingOrder(view, { price: view.position.price });
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
          toast(error, "error");
        } else if (view.position.status === "pending" && !isDraftId(viewId)) {
          persistPendingPrice(view);
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
        ".afx-position-label, .afx-entry-marker, .afx-position-flag, .afx-position-close, .afx-position-confirm, .afx-position-row, .afx-order-grip, .afx-price-tag, .afx-trade-widget, .trade-ticket",
      )
    ) {
      return;
    }
    setActive(null);
  }

  function removeView(id, { skipCloseMarker = false } = {}) {
    const view = views.get(id);
    if (!view) return;
    if (!isDraftId(id)) {
      if (!skipCloseMarker) {
        persistClosedEntryMarker(id, view);
        ensureCloseMarkerFromClose(id, view.position);
      }
      clearFillAnchor(id);
    }
    if (view.drag?.previewLine) removeLine(view.drag.previewLine);
    removeLine(view.entryLine);
    if (view.slLine) removeLine(view.slLine);
    if (view.tpLine) removeLine(view.tpLine);
    view.row.remove();
    view.confirmBtn?.remove();
    view.entryMarker?.remove();
    view.slFlag?.remove();
    view.slClose?.remove();
    view.tpFlag?.remove();
    view.tpClose?.remove();
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
    updateRowChrome(view);
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
    updateRowChrome(view);
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
    position = { ...position, time: resolvePositionTime(position) };
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

    const pnlEl = document.createElement("span");
    pnlEl.className = "afx-pos-pnl";

    const volEl = document.createElement("span");
    volEl.className = "afx-pos-vol";
    volEl.textContent = Number(position.volume).toFixed(2);

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

    const tpFlag = createFlag("tp", "Drag to set take profit");
    const tpClose = createCloseButton("Remove take profit", "afx-stop-close");
    const slFlag = createFlag("sl", "Drag to set stop loss");
    const slClose = createCloseButton("Remove stop loss", "afx-stop-close");
    const entryMarker = createEntryMarker(side);

    tpClose.hidden = true;
    slClose.hidden = true;

    let dragGrip = null;
    if (isDraft || isPending) {
      dragGrip = createDragGrip();
      dragGrip.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        setActive(position.id, "entry");
        if (isOrderEntryDraggable(position)) startDrag(position.id, "entry", e);
      });
    }

    if (dragGrip) row.append(dragGrip);
    row.append(pnlEl, volEl, positionClose);
    if (confirmBtn) row.append(confirmBtn);
    layer.appendChild(row);
    layer.appendChild(slFlag);
    layer.appendChild(slClose);
    layer.appendChild(tpFlag);
    layer.appendChild(tpClose);

    entryMarker.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      setActive(position.id, "entry");
      if (isOrderEntryDraggable(position)) startDrag(position.id, "entry", e);
    });

    row.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".afx-position-flag, .afx-position-close, .afx-position-confirm, .afx-order-grip")) return;
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

    const entryPriceTag = createPriceTag("entry");
    const slPriceTag = createPriceTag("sl");
    const tpPriceTag = createPriceTag("tp");

    const view = {
      position,
      entryLine,
      slLine: null,
      tpLine: null,
      row,
      pnlEl,
      volEl,
      dragGrip,
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
    updateRowChrome(view);
    scheduleReposition();
    setActive(position.id, "entry");
  }

  function repositionAll() {
    const frame = getPlotFrame();
    for (const view of views.values()) {
      const entryY = priceToLocalY(view.position.price);
      const entryX = timeToLocalXForUnix(resolvePositionUnixSec(view.position));
      const entryInFrame =
        entryY != null &&
        entryX != null &&
        entryY >= frame.top &&
        entryY <= frame.top + frame.height &&
        entryX >= frame.left &&
        entryX <= frame.left + frame.width;

      if (entryInFrame) {
        const side = String(view.position.side).toLowerCase();
        view.entryMarker.style.visibility = "visible";
        view.entryMarker.style.left = `${entryX}px`;
        view.entryMarker.style.top = `${entryY}px`;
        view.entryMarker.style.transform =
          side === "sell" ? "translate(-50%, -100%)" : "translate(-50%, 0)";

        view.row.style.visibility = "visible";
        view.row.style.display = "flex";
        view.row.style.top = `${entryY}px`;
        view.row.style.left = `${entryX + 8}px`;
        view.row.style.transform = "translateY(-50%)";
      } else {
        view.row.style.visibility = "hidden";
        if (view.entryMarker) view.entryMarker.style.visibility = "hidden";
      }

      positionLevel(view, "tp", levelPrice(view, "tp"), 0);
      positionLevel(view, "sl", levelPrice(view, "sl"), 1);

      updateRowChrome(view);
      updatePriceTags(view, view.row.dataset.positionId ?? "");
    }
    repositionCloseMarkers();
    repositionClosedEntryMarkers();
    repositionTradeConnectors();
  }

  function positionTime(pos) {
    if (pos.opened_time != null) return resolveBarTime(pos.opened_time);
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
      pnl: Number(pos.pnl || 0),
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
        existing.position = { ...existing.position, ...mapped, time: resolvePositionTime({ ...existing.position, ...mapped }) };
        existing.entryLine.applyOptions({ price: mapped.price });
        updateRowChrome(existing);
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
        existing.position = { ...existing.position, ...mapped, time: resolvePositionTime({ ...existing.position, ...mapped }) };
        existing.entryLine.applyOptions({ price: mapped.price });
        updateRowChrome(existing);
      } else {
        openPosition(mapped);
      }
    }
    for (const [id] of views) {
      if (isDraftId(id)) continue;
      if (!serverIds.has(id)) removeView(id);
    }
    syncCloseMarkers();
    syncClosedHistory();
    scheduleReposition();
  }

  function openDraft({ side, volume, orderKind, price }) {
    if (!series || !layer) return null;
    const sym = ctx().activeSymbol;
    const id = `draft-${draftCounter++}`;
    const marketPrice = getMarketPrice();
    let entryPrice = price;
    if (String(orderKind).toLowerCase() === "market") entryPrice = marketPrice;
    else if (entryPrice == null && marketPrice != null) entryPrice = marketPrice;

    openPosition({
      id,
      side: String(side).toLowerCase(),
      price: Number(entryPrice),
      volume,
      sl: null,
      tp: null,
      orderKind: String(orderKind).toLowerCase(),
      status: "draft",
      symbol: sym,
      opened_time: Math.floor(Date.now() / 1000),
    });
    setActive(id, "entry");
    return id;
  }

  function clearDrafts() {
    for (const id of [...views.keys()]) {
      if (isDraftId(id)) removeView(id, { skipCloseMarker: true });
    }
  }

  function clear() {
    for (const id of [...views.keys()]) removeView(id, { skipCloseMarker: true });
    fillAnchors.clear();
    closeAnchors.clear();
    for (const id of [...closeMarkers.keys()]) removeCloseMarker(id);
    for (const id of [...closedEntryMarkers.keys()]) removeClosedEntryMarker(id);
    for (const id of [...tradeConnectors.keys()]) removeTradeConnector(id);
    if (connectorSvg) {
      connectorSvg.remove();
      connectorSvg = null;
    }
    trackedCloseIds.clear();
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
    }
    ensureDragListeners();

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
    clearDrafts,
    setActive,
    reposition: scheduleReposition,
    updateLivePnl: updateLivePnlAll,
    setFillAnchor,
    setCloseAnchor,
    currentBarTime: () => ctx().fallbackTime?.() ?? null,
  };
})();

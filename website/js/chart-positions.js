/**
 * Open position overlays — Capify-exact entry / SL / TP lines + floating pill.
 * SL/TP always visible; drag to set (even when not saved on trade yet).
 */
(function () {
  const HIT_PX = 18;
  const LC = () => window.LightweightCharts;

  const COLORS = {
    entry: "#22d3ee",
    entryAxis: "#22d3ee",
    entryText: "#0f172a",
    sl: "#ef4444",
    slAxis: "#ef4444",
    slText: "#ffffff",
    tp: "#22c55e",
    tpAxis: "#22c55e",
    tpText: "#ffffff",
  };

  let chart = null;
  let series = null;
  let container = null;
  let overlayRoot = null;
  let getContext = null;
  let overlays = new Map();
  let pendingOverlays = new Map();
  let drag = null;
  let rangeSubscribed = false;
  let dragHost = null;

  function ctx() {
    return getContext?.() || {};
  }

  function fmtPrice(symbol, value) {
    const fn = ctx().fmtPrice;
    return fn ? fn(symbol, value) : Number(value).toFixed(2);
  }

  function hasSl(pos) {
    return pos.sl != null && pos.sl !== "";
  }

  function hasTp(pos) {
    return pos.tp != null && pos.tp !== "";
  }

  /** Capify-style default distance from entry when SL/TP not set yet. */
  function defaultDelta(symbol, side, kind) {
    const meta = ctx().symbolMeta?.[symbol];
    const tick = meta?.tick_size || 0.01;
    const isBuy = String(side).toUpperCase() === "BUY";
    let dist;
    if (symbol === "XAUUSD") dist = kind === "sl" ? 7 : 2.5;
    else if (symbol === "BTCUSD") dist = kind === "sl" ? 900 : 350;
    else if (symbol === "USDJPY") dist = kind === "sl" ? 0.35 : 0.15;
    else dist = kind === "sl" ? tick * 120 : tick * 60;
    if (isBuy) return kind === "sl" ? -dist : dist;
    return kind === "sl" ? dist : -dist;
  }

  function defaultSl(pos) {
    return Number(pos.entry) + defaultDelta(pos.symbol, pos.side, "sl");
  }

  function defaultTp(pos) {
    return Number(pos.entry) + defaultDelta(pos.symbol, pos.side, "tp");
  }

  function slPrice(pos, savedOnly = false) {
    if (hasSl(pos)) return Number(pos.sl);
    return savedOnly ? null : defaultSl(pos);
  }

  function tpPrice(pos, savedOnly = false) {
    if (hasTp(pos)) return Number(pos.tp);
    return savedOnly ? null : defaultTp(pos);
  }

  function fmtPnl(pnl) {
    const n = Number(pnl || 0);
    if (n === 0) return "$0.00";
    const sign = n > 0 ? "+" : "-";
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  function chartY(clientY) {
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return clientY - rect.top;
  }

  function priceY(price) {
    if (!series || price == null) return null;
    const y = series.priceToCoordinate(price);
    return y == null ? null : y;
  }

  function hitLine(y, price) {
    if (price == null) return false;
    const py = priceY(price);
    if (py == null) return false;
    return Math.abs(y - py) <= HIT_PX;
  }

  function findHit(y) {
    for (const [id, o] of overlays) {
      if (hitLine(y, o.slVal)) return { id, kind: "sl" };
      if (hitLine(y, o.tpVal)) return { id, kind: "tp" };
    }
    return null;
  }

  function notifyTicket(o) {
    ctx().syncTicketStops?.({
      sl: o.slVal,
      tp: o.tpVal,
      slSaved: o.slSaved,
      tpSaved: o.tpSaved,
      dragging: !!drag,
    });
  }

  function removePendingOverlay(id) {
    const o = pendingOverlays.get(id);
    if (!o || !series) return;
    try {
      if (o.line) series.removePriceLine(o.line);
    } catch {
      /* ignore */
    }
    pendingOverlays.delete(id);
  }

  function removeOverlayDom(o) {
    o.entryRow?.remove();
    o.slRow?.remove();
    o.tpRow?.remove();
  }

  function removeOverlay(id) {
    const o = overlays.get(id);
    if (!o || !series) return;
    try {
      if (o.entryLine) series.removePriceLine(o.entryLine);
      if (o.slLine) series.removePriceLine(o.slLine);
      if (o.tpLine) series.removePriceLine(o.tpLine);
    } catch {
      /* ignore */
    }
    removeOverlayDom(o);
    overlays.delete(id);
  }

  function clear() {
    for (const id of [...overlays.keys()]) removeOverlay(id);
    for (const id of [...pendingOverlays.keys()]) removePendingOverlay(id);
    drag = null;
    if (overlayRoot) overlayRoot.innerHTML = "";
  }

  function lineStyle(saved) {
    return saved ? LC().LineStyle.Solid : LC().LineStyle.Dotted;
  }

  function createLine(price, color, saved, axisColor, textColor) {
    return series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: lineStyle(saved),
      axisLabelVisible: true,
      title: "",
      axisLabelColor: axisColor,
      axisLabelTextColor: textColor,
    });
  }

  function buildEntryPill(pos) {
    const pnl = Number(pos.pnl || 0);
    const pnlCls = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
    const row = document.createElement("div");
    row.className = "cpf-pos-row cpf-pos-row--entry";
    row.dataset.posId = String(pos.id);
    row.innerHTML = `
      <div class="cpf-entry-pill">
        <span class="cpf-entry-vol">${pos.volume}</span>
        <span class="cpf-entry-sep" aria-hidden="true"></span>
        <span class="cpf-entry-pnl ${pnlCls}">${fmtPnl(pnl)}</span>
        <button type="button" class="cpf-entry-close" data-close-pos="${pos.id}" aria-label="Close position">×</button>
      </div>
    `;
    row.querySelector("[data-close-pos]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      ctx().closePosition?.(pos.id);
    });
    return row;
  }

  function buildTag(kind, posId, saved) {
    const row = document.createElement("div");
    row.className = `cpf-pos-row cpf-pos-row--${kind}${saved ? "" : " is-draft"}`;
    row.dataset.posId = String(posId);
    row.dataset.kind = kind;
    row.innerHTML = `<span class="cpf-pos-tag cpf-pos-tag--${kind}">${kind.toUpperCase()}</span>`;
    return row;
  }

  function layoutOverlay(o) {
    const entryY = priceY(Number(o.pos.entry));
    if (entryY != null && o.entryRow) {
      o.entryRow.style.top = `${entryY}px`;
      o.entryRow.style.display = "";
    } else if (o.entryRow) {
      o.entryRow.style.display = "none";
    }

    const slY = priceY(o.slVal);
    if (slY != null && o.slRow) {
      o.slRow.style.top = `${slY}px`;
      o.slRow.style.display = "";
    } else if (o.slRow) {
      o.slRow.style.display = "none";
    }

    const tpY = priceY(o.tpVal);
    if (tpY != null && o.tpRow) {
      o.tpRow.style.top = `${tpY}px`;
      o.tpRow.style.display = "";
    } else if (o.tpRow) {
      o.tpRow.style.display = "none";
    }
  }

  function layoutAll() {
    for (const o of overlays.values()) layoutOverlay(o);
  }

  function ensureRangeSub() {
    if (!chart || rangeSubscribed) return;
    rangeSubscribed = true;
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => layoutAll());
  }

  function upsertOverlay(pos) {
    if (!series || !overlayRoot) return;
    removeOverlay(pos.id);

    const entry = Number(pos.entry);
    const sl = slPrice(pos);
    const tp = tpPrice(pos);
    const slSaved = hasSl(pos);
    const tpSaved = hasTp(pos);

    const entryLine = createLine(entry, COLORS.entry, true, COLORS.entryAxis, COLORS.entryText);
    const slLine = createLine(sl, COLORS.sl, slSaved, COLORS.slAxis, COLORS.slText);
    const tpLine = createLine(tp, COLORS.tp, tpSaved, COLORS.tpAxis, COLORS.tpText);

    const entryRow = buildEntryPill(pos);
    const slRow = buildTag("sl", pos.id, slSaved);
    const tpRow = buildTag("tp", pos.id, tpSaved);
    overlayRoot.append(entryRow, slRow, tpRow);

    const record = {
      pos,
      entryLine,
      slLine,
      tpLine,
      slVal: sl,
      tpVal: tp,
      slSaved,
      tpSaved,
      entryRow,
      slRow,
      tpRow,
    };
    overlays.set(pos.id, record);
    layoutOverlay(record);
    notifyTicket(record);
  }

  function upsertPendingOverlay(p) {
    if (!series) return;
    removePendingOverlay(p.id);

    const price = Number(p.price);
    const ot = String(p.order_type || "LIMIT").toUpperCase();
    const color = ot === "LIMIT" ? "#eab308" : "#f97316";
    const line = series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: LC().LineStyle.Dotted,
      axisLabelVisible: true,
      title: `${ot} ${p.side} ${p.volume}`,
    });

    pendingOverlays.set(p.id, { pos: p, line, priceVal: price });
  }

  function sync() {
    clear();
    if (!series || !chart) return;

    const { activeSymbol, open = [], pending = [] } = ctx();
    const positions = open.filter((p) => p.symbol === activeSymbol);
    const pendingOrders = pending.filter((p) => p.symbol === activeSymbol);
    positions.forEach(upsertOverlay);
    pendingOrders.forEach(upsertPendingOverlay);
    if (!positions.length) {
      ctx().syncTicketStops?.({ sl: null, tp: null, slSaved: false, tpSaved: false, dragging: false });
    }
    ensureRangeSub();
    layoutAll();
  }

  function updateLivePnl() {
    const { open = [] } = ctx();
    for (const [id, o] of overlays) {
      const live = open.find((p) => p.id === id);
      if (!live || !o.entryRow) continue;
      const pnlEl = o.entryRow.querySelector(".cpf-entry-pnl");
      if (!pnlEl) continue;
      const pnl = Number(live.pnl || 0);
      pnlEl.textContent = fmtPnl(pnl);
      pnlEl.classList.toggle("positive", pnl > 0);
      pnlEl.classList.toggle("negative", pnl < 0);
      o.pos = live;
    }
  }

  function applyDragPrice(kind, price) {
    const o = overlays.get(drag.id);
    if (!o) return;
    const exact = Number(price);
    if (kind === "sl") {
      o.slVal = exact;
      o.slLine?.applyOptions({ price: exact, lineStyle: LC().LineStyle.Solid });
      o.slRow?.classList.remove("is-draft");
    } else {
      o.tpVal = exact;
      o.tpLine?.applyOptions({ price: exact, lineStyle: LC().LineStyle.Solid });
      o.tpRow?.classList.remove("is-draft");
    }
    layoutOverlay(o);
    notifyTicket(o);
  }

  async function persistStops(id, kind) {
    const o = overlays.get(id);
    const accountId = ctx().accountId;
    if (!o || !accountId || !window.AlphaFXApi) return;

    const sym = o.pos.symbol;
    const body = { account_id: accountId };
    if (kind === "sl") body.stop_loss = o.slVal;
    if (kind === "tp") body.take_profit = o.tpVal;

    try {
      await window.AlphaFXApi.request(`/api/v1/trade/positions/${id}/stops`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const open = ctx().open || [];
      const row = open.find((p) => p.id === id);
      if (row) {
        if (kind === "sl") row.sl = o.slVal;
        if (kind === "tp") row.tp = o.tpVal;
      }
      if (kind === "sl") {
        o.slSaved = true;
        o.pos.sl = o.slVal;
      }
      if (kind === "tp") {
        o.tpSaved = true;
        o.pos.tp = o.tpVal;
      }
      const msg =
        kind === "sl"
          ? `Stop loss set · ${fmtPrice(sym, o.slVal)}`
          : `Take profit set · ${fmtPrice(sym, o.tpVal)}`;
      window.AlphaFXToast?.show(msg, "success");
      notifyTicket(o);
    } catch (e) {
      window.AlphaFXToast?.show(e?.message || "Could not save stops", "error");
      sync();
    }
  }

  function onPointerDown(ev) {
    if (!series || !chart || drag) return;

    const tag = ev.target.closest(".cpf-pos-tag");
    if (tag) {
      const row = tag.closest(".cpf-pos-row");
      const id = Number(row?.dataset.posId);
      const kind = row?.dataset.kind;
      if (id && (kind === "sl" || kind === "tp")) {
        ev.preventDefault();
        ev.stopPropagation();
        drag = { id, kind, pointerId: ev.pointerId, moved: false };
        document.body.style.cursor = "ns-resize";
        overlayRoot?.classList.add("is-dragging");
        chart.applyOptions({ handleScroll: false, handleScale: false });
        overlayRoot?.setPointerCapture?.(ev.pointerId);
        return;
      }
    }

    const y = chartY(ev.clientY);
    const hit = findHit(y);
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    drag = { ...hit, pointerId: ev.pointerId, moved: false };
    document.body.style.cursor = "ns-resize";
    overlayRoot?.classList.add("is-dragging");
    chart.applyOptions({ handleScroll: false, handleScale: false });
    container?.setPointerCapture?.(ev.pointerId);
  }

  function onPointerMove(ev) {
    if (!drag || !series) return;
    const y = chartY(ev.clientY);
    if (y == null) return;
    const price = series.coordinateToPrice(y);
    if (price == null) return;
    const o = overlays.get(drag.id);
    if (!o) return;
    const entry = Number(o.pos.entry);
    const isBuy = String(o.pos.side).toUpperCase() === "BUY";
    if (drag.kind === "sl") {
      if (isBuy && price >= entry) return;
      if (!isBuy && price <= entry) return;
    } else {
      if (isBuy && price <= entry) return;
      if (!isBuy && price >= entry) return;
    }
    drag.moved = true;
    applyDragPrice(drag.kind, price);
  }

  function onPointerUp(ev) {
    if (!drag) return;
    const { id, kind, pointerId, moved } = drag;
    drag = null;
    document.body.style.cursor = "";
    overlayRoot?.classList.remove("is-dragging");
    chart?.applyOptions({ handleScroll: true, handleScale: true });
    try {
      container?.releasePointerCapture?.(pointerId);
      overlayRoot?.releasePointerCapture?.(pointerId);
    } catch {
      /* ignore */
    }
    if (moved) persistStops(id, kind);
  }

  function bindDrag() {
    if (dragHost) return;
    dragHost = overlayRoot?.parentElement || container;
    if (!dragHost) return;
    dragHost.addEventListener("pointerdown", onPointerDown);
    dragHost.addEventListener("pointermove", onPointerMove);
    dragHost.addEventListener("pointerup", onPointerUp);
    dragHost.addEventListener("pointercancel", onPointerUp);
  }

  function unbindDrag() {
    if (!dragHost) return;
    dragHost.removeEventListener("pointerdown", onPointerDown);
    dragHost.removeEventListener("pointermove", onPointerMove);
    dragHost.removeEventListener("pointerup", onPointerUp);
    dragHost.removeEventListener("pointercancel", onPointerUp);
    dragHost = null;
  }

  function attach({ chart: c, series: s, container: el, getContext: gc }) {
    chart = c;
    series = s;
    container = el;
    getContext = gc;
    overlayRoot =
      el.parentElement?.querySelector("#trade-pos-overlays") ||
      el.parentElement?.querySelector(".trade-pos-overlays");
    if (!overlayRoot && el.parentElement) {
      overlayRoot = document.createElement("div");
      overlayRoot.id = "trade-pos-overlays";
      overlayRoot.className = "trade-pos-overlays";
      overlayRoot.setAttribute("aria-hidden", "true");
      el.parentElement.appendChild(overlayRoot);
    }
    rangeSubscribed = false;
    bindDrag();
    sync();
  }

  function detach() {
    clear();
    unbindDrag();
    chart = null;
    series = null;
    container = null;
    overlayRoot = null;
    getContext = null;
    rangeSubscribed = false;
  }

  window.AlphaFXChartPositions = {
    attach,
    detach,
    sync,
    clear,
    updateLivePnl,
    layoutAll,
  };
})();

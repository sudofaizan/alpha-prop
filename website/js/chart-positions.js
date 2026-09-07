/**
 * Open position overlays — Capify-exact entry / SL / TP lines + floating pill.
 */
(function () {
  const HIT_PX = 16;
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

  function slPrice(pos) {
    return hasSl(pos) ? Number(pos.sl) : null;
  }

  function tpPrice(pos) {
    return hasTp(pos) ? Number(pos.tp) : null;
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
      if (o.slVal != null && hitLine(y, o.slVal)) return { id, kind: "sl" };
      if (o.tpVal != null && hitLine(y, o.tpVal)) return { id, kind: "tp" };
    }
    return null;
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

  function createLine(price, color, style, axisColor, textColor) {
    return series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: style,
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

  function buildTag(kind, posId) {
    const row = document.createElement("div");
    row.className = `cpf-pos-row cpf-pos-row--${kind}`;
    row.dataset.posId = String(posId);
    row.dataset.kind = kind;
    row.innerHTML = `<span class="cpf-pos-tag cpf-pos-tag--${kind}">${kind.toUpperCase()}</span>`;
    return row;
  }

  function layoutOverlay(o) {
    if (!o.dom) return;
    const entryY = priceY(Number(o.pos.entry));
    if (entryY != null && o.entryRow) {
      o.entryRow.style.top = `${entryY}px`;
      o.entryRow.style.display = "";
    } else if (o.entryRow) {
      o.entryRow.style.display = "none";
    }

    const slY = o.slVal != null ? priceY(o.slVal) : null;
    if (slY != null && o.slRow) {
      o.slRow.style.top = `${slY}px`;
      o.slRow.style.display = "";
    } else if (o.slRow) {
      o.slRow.style.display = "none";
    }

    const tpY = o.tpVal != null ? priceY(o.tpVal) : null;
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

    const entryLine = createLine(
      entry,
      COLORS.entry,
      LC().LineStyle.Solid,
      COLORS.entryAxis,
      COLORS.entryText
    );

    let slLine = null;
    let tpLine = null;
    if (sl != null) {
      slLine = createLine(sl, COLORS.sl, LC().LineStyle.Solid, COLORS.slAxis, COLORS.slText);
    }
    if (tp != null) {
      tpLine = createLine(tp, COLORS.tp, LC().LineStyle.Solid, COLORS.tpAxis, COLORS.tpText);
    }

    const entryRow = buildEntryPill(pos);
    overlayRoot.appendChild(entryRow);

    let slRow = null;
    let tpRow = null;
    if (sl != null) {
      slRow = buildTag("sl", pos.id);
      overlayRoot.appendChild(slRow);
    }
    if (tp != null) {
      tpRow = buildTag("tp", pos.id);
      overlayRoot.appendChild(tpRow);
    }

    const record = {
      pos,
      entryLine,
      slLine,
      tpLine,
      slVal: sl,
      tpVal: tp,
      entryRow,
      slRow,
      tpRow,
    };
    overlays.set(pos.id, record);
    layoutOverlay(record);
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
    ensureRangeSub();
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
    const sym = o.pos.symbol;
    const exact = Number(price);
    if (kind === "sl") {
      o.slVal = exact;
      if (o.slLine) {
        o.slLine.applyOptions({ price: exact });
      } else {
        o.slLine = createLine(exact, COLORS.sl, LC().LineStyle.Solid, COLORS.slAxis, COLORS.slText);
      }
      if (!o.slRow && overlayRoot) {
        o.slRow = buildTag("sl", o.pos.id);
        overlayRoot.appendChild(o.slRow);
      }
    } else {
      o.tpVal = exact;
      if (o.tpLine) {
        o.tpLine.applyOptions({ price: exact });
      } else {
        o.tpLine = createLine(exact, COLORS.tp, LC().LineStyle.Solid, COLORS.tpAxis, COLORS.tpText);
      }
      if (!o.tpRow && overlayRoot) {
        o.tpRow = buildTag("tp", o.pos.id);
        overlayRoot.appendChild(o.tpRow);
      }
    }
    layoutOverlay(o);
  }

  async function persistStops(id, kind) {
    const o = overlays.get(id);
    const accountId = ctx().accountId;
    if (!o || !accountId || !window.AlphaFXApi) return;

    const body = {
      account_id: accountId,
      stop_loss: o.slVal,
      take_profit: o.tpVal,
    };
    try {
      await window.AlphaFXApi.request(`/api/v1/trade/positions/${id}/stops`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const open = ctx().open || [];
      const row = open.find((p) => p.id === id);
      if (row) {
        row.sl = o.slVal;
        row.tp = o.tpVal;
      }
      o.pos.sl = o.slVal;
      o.pos.tp = o.tpVal;
      const sym = o.pos.symbol;
      const msg =
        kind === "sl"
          ? `Stop loss set · ${fmtPrice(sym, o.slVal)}`
          : kind === "tp"
            ? `Take profit set · ${fmtPrice(sym, o.tpVal)}`
            : "Stop levels updated";
      window.AlphaFXToast?.show(msg, "success");
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
        drag = { id, kind, pointerId: ev.pointerId };
        document.body.style.cursor = "ns-resize";
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
    drag = { ...hit, pointerId: ev.pointerId };
    document.body.style.cursor = "ns-resize";
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
    applyDragPrice(drag.kind, price);
  }

  function onPointerUp(ev) {
    if (!drag) return;
    const { id, kind, pointerId } = drag;
    drag = null;
    document.body.style.cursor = "";
    chart?.applyOptions({ handleScroll: true, handleScale: true });
    try {
      container?.releasePointerCapture?.(pointerId);
      overlayRoot?.releasePointerCapture?.(pointerId);
    } catch {
      /* ignore */
    }
    persistStops(id, kind);
  }

  let dragHost = null;

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

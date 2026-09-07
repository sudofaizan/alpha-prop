/**
 * Open position overlays on Lightweight Charts — entry / SL / TP lines with drag.
 */
(function () {
  const HIT_PX = 14;
  const LC = () => window.LightweightCharts;

  let chart = null;
  let series = null;
  let container = null;
  let getContext = null;
  let overlays = new Map();
  let drag = null;
  let bound = false;

  function ctx() {
    return getContext?.() || {};
  }

  function fmtPrice(symbol, value) {
    const fn = ctx().fmtPrice;
    return fn ? fn(symbol, value) : Number(value).toFixed(2);
  }

  function defaultOffset(symbol) {
    const meta = ctx().symbolMeta?.[symbol];
    const tick = meta?.tick_size || 0.01;
    if (symbol === "XAUUSD") return tick * 200;
    if (symbol === "BTCUSD") return tick * 500;
    if (symbol === "USDJPY") return tick * 200;
    return tick * 150;
  }

  function defaultSl(pos) {
    const entry = Number(pos.entry);
    const off = defaultOffset(pos.symbol);
    return String(pos.side).toUpperCase() === "BUY" ? entry - off : entry + off;
  }

  function defaultTp(pos) {
    const entry = Number(pos.entry);
    const off = defaultOffset(pos.symbol);
    return String(pos.side).toUpperCase() === "BUY" ? entry + off : entry - off;
  }

  function slPrice(pos) {
    return pos.sl != null && pos.sl !== "" ? Number(pos.sl) : defaultSl(pos);
  }

  function tpPrice(pos) {
    return pos.tp != null && pos.tp !== "" ? Number(pos.tp) : defaultTp(pos);
  }

  function chartY(clientY) {
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return clientY - rect.top;
  }

  function hitLine(y, price) {
    if (!series || y == null || price == null) return false;
    const py = series.priceToCoordinate(price);
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

  function entryTitle(pos) {
    const pnl = Number(pos.pnl || 0);
    const sign = pnl >= 0 ? "+" : "";
    return `${pos.side} ${pos.volume} · ${sign}$${Math.abs(pnl).toFixed(2)}`;
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
    overlays.delete(id);
  }

  function clear() {
    for (const id of [...overlays.keys()]) removeOverlay(id);
    drag = null;
    if (series) {
      try {
        series.setMarkers([]);
      } catch {
        /* ignore */
      }
    }
  }

  function createLine(price, color, style, title, axisLabelVisible = true) {
    return series.createPriceLine({
      price,
      color,
      lineWidth: 2,
      lineStyle: style,
      axisLabelVisible,
      title,
    });
  }

  function upsertOverlay(pos) {
    if (!series) return;
    removeOverlay(pos.id);

    const isBuy = String(pos.side).toUpperCase() === "BUY";
    const entry = Number(pos.entry);
    const sl = slPrice(pos);
    const tp = tpPrice(pos);
    const slSaved = pos.sl != null && pos.sl !== "";
    const tpSaved = pos.tp != null && pos.tp !== "";

    const entryLine = createLine(
      entry,
      isBuy ? "#22c55e" : "#ef4444",
      LC().LineStyle.Solid,
      entryTitle(pos)
    );
    const slLine = createLine(
      sl,
      "#ef4444",
      slSaved ? LC().LineStyle.Dashed : LC().LineStyle.Dotted,
      slSaved ? `SL ${fmtPrice(pos.symbol, sl)}` : `SL · drag`
    );
    const tpLine = createLine(
      tp,
      "#22c55e",
      tpSaved ? LC().LineStyle.Dashed : LC().LineStyle.Dotted,
      tpSaved ? `TP ${fmtPrice(pos.symbol, tp)}` : `TP · drag`
    );

    overlays.set(pos.id, {
      pos,
      entryLine,
      slLine,
      tpLine,
      slVal: sl,
      tpVal: tp,
      slSaved,
      tpSaved,
    });
  }

  function syncMarkers(positions) {
    if (!series || !positions.length) {
      try {
        series?.setMarkers([]);
      } catch {
        /* ignore */
      }
      return;
    }

    function snapTime(t) {
      const bars = ctx().barBuffer || [];
      if (!bars.length || !t) return t || ctx().fallbackTime?.();
      if (bars.some((b) => b.time === t)) return t;
      let best = bars[0].time;
      for (const b of bars) {
        if (b.time <= t) best = b.time;
        else break;
      }
      return best;
    }

    const markers = positions
      .map((pos) => {
        const t = snapTime(pos.opened_time);
        if (!t) return null;
        const isBuy = String(pos.side).toUpperCase() === "BUY";
        return {
          time: t,
          position: isBuy ? "belowBar" : "aboveBar",
          color: isBuy ? "#22c55e" : "#ef4444",
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: `${pos.side} ${pos.volume}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
    try {
      series.setMarkers(markers);
    } catch {
      /* ignore */
    }
  }

  function sync() {
    clear();
    if (!series || !chart) return;

    const { activeSymbol, open = [] } = ctx();
    const positions = open.filter((p) => p.symbol === activeSymbol);
    positions.forEach(upsertOverlay);
    syncMarkers(positions);
  }

  function updateLivePnl() {
    if (!series) return;
    const { open = [] } = ctx();
    for (const [id, o] of overlays) {
      const live = open.find((p) => p.id === id);
      if (!live || !o.entryLine) continue;
      try {
        o.entryLine.applyOptions({ title: entryTitle(live) });
      } catch {
        /* ignore */
      }
    }
  }

  function applyDragPrice(kind, price) {
    const o = overlays.get(drag.id);
    if (!o) return;
    const sym = o.pos.symbol;
    const rounded = Number(fmtPrice(sym, price));
    if (kind === "sl") {
      o.slVal = rounded;
      o.slLine.applyOptions({
        price: rounded,
        title: `SL ${fmtPrice(sym, rounded)}`,
        lineStyle: LC().LineStyle.Dashed,
      });
    } else {
      o.tpVal = rounded;
      o.tpLine.applyOptions({
        price: rounded,
        title: `TP ${fmtPrice(sym, rounded)}`,
        lineStyle: LC().LineStyle.Dashed,
      });
    }
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
      o.slSaved = true;
      o.tpSaved = true;
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
    }
  }

  function onMouseDown(ev) {
    if (!series || !chart || drag) return;
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

  function onMouseMove(ev) {
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

  function onMouseUp(ev) {
    if (!drag) return;
    const { id, kind, pointerId } = drag;
    drag = null;
    document.body.style.cursor = "";
    chart?.applyOptions({ handleScroll: true, handleScale: true });
    try {
      container?.releasePointerCapture?.(pointerId);
    } catch {
      /* ignore */
    }
    persistStops(id, kind);
  }

  function bindDrag() {
    if (!container || bound) return;
    bound = true;
    container.addEventListener("pointerdown", onMouseDown);
    container.addEventListener("pointermove", onMouseMove);
    container.addEventListener("pointerup", onMouseUp);
    container.addEventListener("pointercancel", onMouseUp);
  }

  function attach({ chart: c, series: s, container: el, getContext: gc }) {
    chart = c;
    series = s;
    container = el;
    getContext = gc;
    bindDrag();
    sync();
  }

  function detach() {
    clear();
    chart = null;
    series = null;
    container = null;
    getContext = null;
  }

  window.AlphaFXChartPositions = {
    attach,
    detach,
    sync,
    clear,
    updateLivePnl,
  };
})();

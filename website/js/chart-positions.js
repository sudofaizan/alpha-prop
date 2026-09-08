/**
 * Open position overlays — entry / SL / TP lines.
 * Desktop: Capify-style always-visible SL/TP with drag.
 * MT5 mobile: entry only until selected; SL/TP via bottom bar + draggable lines with cancel.
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
  let selectedPosId = null;
  let mt5BarBound = false;
  /** @type {'full' | 'close-only'} */
  let barMode = "full";
  /** @type {'close' | 'modify'} */
  let sliderPane = "close";
  let sliderTouchStartX = 0;
  let sliderBound = false;
  /** Restores overlay UI state across sync() rebuilds */
  let syncRestore = null;

  function getRestore(id) {
    return syncRestore?.get(id) || null;
  }

  function ctx() {
    return getContext?.() || {};
  }

  function isMt5Mode() {
    return !!ctx().isMt5Mobile?.();
  }

  function isLiteChartUi() {
    return isMt5Mode() || document.body.classList.contains("trade-clean-mode");
  }

  function isCleanDesktop() {
    return document.body.classList.contains("trade-clean-mode");
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

  function pnlAtPrice(pos, exitPrice) {
    if (!window.AlphaFXSimPnl?.calcPnl || exitPrice == null) return 0;
    const meta = ctx().symbolMeta?.[pos.symbol];
    return window.AlphaFXSimPnl.calcPnl(pos.symbol, pos.side, pos.volume, pos.entry, exitPrice, meta);
  }

  function fmtTagPnl(pnl) {
    const n = Number(pnl || 0);
    if (n === 0) return "$0.00";
    const sign = n > 0 ? "+" : "-";
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  function tagPnlClass(pnl) {
    const n = Number(pnl || 0);
    if (n > 0) return "positive";
    if (n < 0) return "negative";
    return "";
  }

  function updateTagPrices(o) {
    if (isLiteChartUi()) {
      if (o.slRow && isStopActive(o, "sl")) {
        const el = o.slRow.querySelector(".cpf-mt5-text-main");
        if (el) el.textContent = `SL, ${fmtTagPnl(pnlAtPrice(o.pos, o.slVal))}`;
      }
      if (o.tpRow && isStopActive(o, "tp")) {
        const el = o.tpRow.querySelector(".cpf-mt5-text-main");
        if (el) el.textContent = `TP, ${fmtTagPnl(pnlAtPrice(o.pos, o.tpVal))}`;
      }
      return;
    }
    const slPx = o.slRow?.querySelector(".cpf-pos-tag-pnl");
    const tpPx = o.tpRow?.querySelector(".cpf-pos-tag-pnl");
    if (slPx && o.slVal != null) {
      const pnl = pnlAtPrice(o.pos, o.slVal);
      slPx.textContent = fmtTagPnl(pnl);
      slPx.classList.remove("positive", "negative");
      slPx.classList.add(tagPnlClass(pnl));
    }
    if (tpPx && o.tpVal != null) {
      const pnl = pnlAtPrice(o.pos, o.tpVal);
      tpPx.textContent = fmtTagPnl(pnl);
      tpPx.classList.remove("positive", "negative");
      tpPx.classList.add(tagPnlClass(pnl));
    }
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
    const px = isMt5Mode() ? 28 : HIT_PX;
    return Math.abs(y - py) <= px;
  }

  function findHit(y) {
    for (const [id, o] of overlays) {
      if (isMt5Mode()) {
        if (hitLine(y, Number(o.pos.entry))) return { id, kind: "entry" };
      }
      if (shouldShowSl(o) && hitLine(y, o.slVal)) return { id, kind: "sl" };
      if (shouldShowTp(o) && hitLine(y, o.tpVal)) return { id, kind: "tp" };
    }
    return null;
  }

  function shouldShowSl(o) {
    if (isCleanDesktop()) return o.slSaved;
    if (!isMt5Mode()) return true;
    if (o.slSaved) return true;
    if (selectedPosId === o.pos.id && o.slVisible) return true;
    return false;
  }

  function shouldShowTp(o) {
    if (isCleanDesktop()) return o.tpSaved;
    if (!isMt5Mode()) return true;
    if (o.tpSaved) return true;
    if (selectedPosId === o.pos.id && o.tpVisible) return true;
    return false;
  }

  function isStopActive(o, kind) {
    if (isCleanDesktop()) {
      const dragging = drag && drag.id === o.pos.id && drag.kind === kind;
      if (kind === "sl") return o.slDirty || dragging;
      return o.tpDirty || dragging;
    }
    if (!isMt5Mode()) return false;
    if (selectedPosId !== o.pos.id) return false;
    const dragging = drag && drag.id === o.pos.id && drag.kind === kind;
    if (kind === "sl") return o.slVisible || o.slDirty || dragging;
    return o.tpVisible || o.tpDirty || dragging;
  }

  function stopLineSolid(o, kind) {
    if (isCleanDesktop()) return isStopActive(o, kind);
    if (!isMt5Mode()) {
      return kind === "sl" ? o.slSaved && !o.slDirty : o.tpSaved && !o.tpDirty;
    }
    return isStopActive(o, kind);
  }

  function notifyTicket(o) {
    if (isMt5Mode() && selectedPosId !== o?.pos?.id) return;
    ctx().syncTicketStops?.({
      sl: o?.slVisible || !isMt5Mode() ? o?.slVal : null,
      tp: o?.tpVisible || !isMt5Mode() ? o?.tpVal : null,
      slSaved: o?.slSaved,
      tpSaved: o?.tpSaved,
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

  function destroyStopOverlay(o, kind) {
    if (kind === "sl") {
      try {
        if (o.slLine) series.removePriceLine(o.slLine);
      } catch {
        /* ignore */
      }
      o.slLine = null;
      o.slRow?.remove();
      o.slRow = null;
    } else {
      try {
        if (o.tpLine) series.removePriceLine(o.tpLine);
      } catch {
        /* ignore */
      }
      o.tpLine = null;
      o.tpRow?.remove();
      o.tpRow = null;
    }
  }

  function removeStopOverlay(o, kind) {
    destroyStopOverlay(o, kind);
    if (kind === "sl") o.slVisible = false;
    else o.tpVisible = false;
  }

  function removeOverlayDom(o) {
    o.entryRow?.remove();
    o.slRow?.remove();
    o.tpRow?.remove();
  }

  function stripOverlay(id) {
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

  function removeOverlay(id) {
    const wasSelected = selectedPosId === id;
    stripOverlay(id);
    if (wasSelected) deselectPosition(false);
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

  function createLine(price, color, solid, axisColor, textColor) {
    return series.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: lineStyle(solid),
      axisLabelVisible: true,
      title: "",
      axisLabelColor: axisColor,
      axisLabelTextColor: textColor,
    });
  }

  function createMt5EntryLine(price) {
    return series.createPriceLine({
      price,
      color: "#d4d4d8",
      lineWidth: 1,
      lineStyle: LC().LineStyle.Dashed,
      axisLabelVisible: true,
      title: "",
      axisLabelColor: "#52525b",
      axisLabelTextColor: "#fafafa",
    });
  }

  function sideLabel(pos) {
    return String(pos.side || "").toUpperCase();
  }

  function buildEntryPill(pos) {
    const lite = isLiteChartUi();
    const side = sideLabel(pos);
    const isBuy = side === "BUY";
    const row = document.createElement("div");
    row.className = `cpf-pos-row cpf-pos-row--entry${selectedPosId === pos.id ? " is-selected" : ""}`;
    row.dataset.posId = String(pos.id);

    if (lite) {
      row.innerHTML = `<span class="cpf-mt5-text cpf-mt5-text--entry">${side} ${pos.volume}</span>`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        selectPosition(pos.id);
      });
      return row;
    }

    const pnl = Number(pos.pnl || 0);
    const pnlCls = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
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

  function buildTag(kind, pos, levelPrice, active) {
    const row = document.createElement("div");
    row.className = `cpf-pos-row cpf-pos-row--${kind}${active ? " is-active" : ""}`;
    row.dataset.posId = String(pos.id);
    row.dataset.kind = kind;

    if (isLiteChartUi()) {
      const pnl = pnlAtPrice(pos, levelPrice);
      const label = active
        ? `${kind.toUpperCase()}, ${fmtTagPnl(pnl)}`
        : kind.toUpperCase();
      row.innerHTML = `
        <span class="cpf-mt5-text cpf-mt5-text--${kind}">
          <span class="cpf-mt5-text-main">${label}</span>
          ${active ? `<button type="button" class="cpf-tag-cancel" data-cancel-stop="${kind}" aria-label="Remove ${kind.toUpperCase()}">×</button>` : ""}
        </span>`;
      row.querySelector("[data-cancel-stop]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const o = overlays.get(pos.id);
        if (o) cancelStop(o, kind);
      });
      return row;
    }

    const pnl = pnlAtPrice(pos, levelPrice);
    const pnlCls = tagPnlClass(pnl);
    const saved = !active;
    row.innerHTML = `
      <span class="cpf-pos-tag cpf-pos-tag--${kind}">
        <span class="cpf-pos-tag-label">${kind.toUpperCase()}</span>
        <span class="cpf-pos-tag-pnl ${pnlCls}">${fmtTagPnl(pnl)}</span>
        ${!saved ? `<button type="button" class="cpf-tag-cancel" data-cancel-stop="${kind}" aria-label="Remove ${kind.toUpperCase()}">×</button>` : ""}
      </span>
    `;
    row.querySelector("[data-cancel-stop]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const o = overlays.get(pos.id);
      if (o) cancelStop(o, kind);
    });
    return row;
  }

  function rebuildStopRow(o, kind) {
    const isSl = kind === "sl";
    const active = isStopActive(o, kind);
    const price = isSl ? o.slVal : o.tpVal;
    const saved = isSl ? o.slSaved : o.tpSaved;
    if (isSl) {
      o.slRow?.remove();
      o.slRow = buildTag("sl", o.pos, price, active);
      overlayRoot?.appendChild(o.slRow);
    } else {
      o.tpRow?.remove();
      o.tpRow = buildTag("tp", o.pos, price, active);
      overlayRoot?.appendChild(o.tpRow);
    }
    return active;
  }

  function ensureStopOverlay(o, kind) {
    const isSl = kind === "sl";
    const active = isStopActive(o, kind);
    const solid = stopLineSolid(o, kind);
    const price = isSl ? o.slVal : o.tpVal;

    if (isSl) {
      if (!o.slLine) {
        o.slLine = createLine(price, COLORS.sl, solid, COLORS.slAxis, COLORS.slText);
        o.slRow = buildTag("sl", o.pos, price, active);
        overlayRoot?.appendChild(o.slRow);
      } else {
        const prevActive = o.slRow?.classList.contains("is-active");
        if (prevActive !== active) rebuildStopRow(o, "sl");
        o.slLine.applyOptions({ price, lineStyle: lineStyle(solid) });
      }
    } else {
      if (!o.tpLine) {
        o.tpLine = createLine(price, COLORS.tp, solid, COLORS.tpAxis, COLORS.tpText);
        o.tpRow = buildTag("tp", o.pos, price, active);
        overlayRoot?.appendChild(o.tpRow);
      } else {
        const prevActive = o.tpRow?.classList.contains("is-active");
        if (prevActive !== active) rebuildStopRow(o, "tp");
        o.tpLine.applyOptions({ price, lineStyle: lineStyle(solid) });
      }
    }
  }

  function refreshStopVisibility(o) {
    if (shouldShowSl(o)) {
      ensureStopOverlay(o, "sl");
    } else {
      destroyStopOverlay(o, "sl");
    }

    if (shouldShowTp(o)) {
      ensureStopOverlay(o, "tp");
    } else {
      destroyStopOverlay(o, "tp");
    }
  }

  function layoutOverlay(o) {
    const entryY = priceY(Number(o.pos.entry));
    if (entryY != null && o.entryRow) {
      o.entryRow.style.transform = `translateY(${entryY}px)`;
      o.entryRow.style.display = "";
      o.entryRow.classList.toggle("is-selected", selectedPosId === o.pos.id);
    } else if (o.entryRow) {
      o.entryRow.style.display = "none";
    }

    const slY = shouldShowSl(o) ? priceY(o.slVal) : null;
    if (slY != null && o.slRow) {
      o.slRow.style.transform = `translateY(${slY}px)`;
      o.slRow.style.display = "";
    } else if (o.slRow) {
      o.slRow.style.display = "none";
    }

    const tpY = shouldShowTp(o) ? priceY(o.tpVal) : null;
    if (tpY != null && o.tpRow) {
      o.tpRow.style.transform = `translateY(${tpY}px)`;
      o.tpRow.style.display = "";
    } else if (o.tpRow) {
      o.tpRow.style.display = "none";
    }
    updateTagPrices(o);
  }

  function layoutAll() {
    if (document.body.classList.contains("trade-clean-mode")) {
      window.AlphaFXPositionOverlay?.reposition?.();
      return;
    }
    for (const o of overlays.values()) layoutOverlay(o);
  }

  function ensureRangeSub() {
    if (!chart || rangeSubscribed) return;
    rangeSubscribed = true;
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => layoutAll());
  }

  function priceChanged(a, b, symbol) {
    const digits = ctx().symbolMeta?.[symbol]?.digits ?? 5;
    const eps = 10 ** -digits;
    return Math.abs(Number(a) - Number(b)) > eps;
  }

  function overlayDirty(o) {
    return !!(o?.slDirty || o?.tpDirty);
  }

  function resetOverlayEditState(o) {
    if (!o) return;
    o.slDirty = false;
    o.tpDirty = false;
    o.slBaseline = o.slSaved ? Number(o.pos.sl) : null;
    o.tpBaseline = o.tpSaved ? Number(o.pos.tp) : null;
  }

  function clearStopEditing(o) {
    o.slVisible = false;
    o.tpVisible = false;
    refreshStopVisibility(o);
  }

  function endEditingOnOverlay(o) {
    if (!o) return;
    o.slVisible = false;
    o.tpVisible = false;
    refreshStopVisibility(o);
    layoutOverlay(o);
  }

  function setSliderPane(pane, animate = true) {
    sliderPane = pane;
    const track = document.getElementById("mt5-pos-slider-track");
    const wrap = document.getElementById("mt5-pos-slider-wrap");
    const o = overlays.get(selectedPosId);
    const canModify = overlayDirty(o);
    if (track) {
      track.classList.toggle("is-modify", pane === "modify");
      if (!animate) track.style.transition = "none";
      else track.style.transition = "";
      requestAnimationFrame(() => {
        if (track.style.transition === "none") track.style.transition = "";
      });
    }
    if (wrap) wrap.classList.toggle("can-modify", canModify);
  }

  function updateMt5PosBar(pos) {
    const bar = document.getElementById("mt5-pos-bar");
    if (!bar) return;
    if (!pos || !isMt5Mode()) {
      bar.hidden = true;
      bar.setAttribute("aria-hidden", "true");
      document.body.classList.remove("mt5-pos-active");
      barMode = "full";
      sliderPane = "close";
      return;
    }
    bar.hidden = false;
    bar.setAttribute("aria-hidden", "false");
    document.body.classList.add("mt5-pos-active");

    const o = overlays.get(pos.id);
    const side = sideLabel(pos).toLowerCase();
    const text = document.getElementById("mt5-pos-close-text");
    const vol = document.getElementById("mt5-pos-close-vol");
    const stops = document.getElementById("mt5-pos-stops");
    const dismiss = document.getElementById("mt5-pos-bar-dismiss");
    const slBtn = document.getElementById("mt5-pos-sl");
    const tpBtn = document.getElementById("mt5-pos-tp");
    const wrap = document.getElementById("mt5-pos-slider-wrap");

    const dirty = overlayDirty(o);
    bar.classList.toggle("is-close-only", barMode === "close-only");
    wrap?.classList.toggle("can-modify", dirty);

    if (dirty) {
      setSliderPane("modify");
    } else if (barMode === "close-only") {
      setSliderPane("close");
    }

    if (text) text.textContent = `Close ${side}`;
    if (vol) {
      vol.textContent = String(pos.volume);
      vol.hidden = false;
    }

    if (barMode === "close-only") {
      if (stops) stops.hidden = true;
      if (dismiss) dismiss.hidden = true;
      wrap?.classList.remove("can-modify");
      setSliderPane("close");
    } else {
      if (stops) stops.hidden = false;
      if (dismiss) dismiss.hidden = false;
    }

    slBtn?.classList.toggle("is-active", !!o?.slVisible);
    tpBtn?.classList.toggle("is-active", !!o?.tpVisible);
  }

  function selectPosition(id) {
    if (!isMt5Mode()) return;

    if (selectedPosId === id) {
      const o = overlays.get(id);
      if (!o) return;
      if (overlayDirty(o)) {
        setSliderPane("modify");
      } else if (barMode === "close-only") {
        barMode = "full";
      } else {
        barMode = "close-only";
        setSliderPane("close");
      }
      layoutOverlay(o);
      layoutAll();
      updateMt5PosBar(o.pos);
      notifyTicket(o);
      return;
    }

    const prev = selectedPosId;
    selectedPosId = id;
    barMode = "full";
    const o = overlays.get(id);
    if (!o) return;

    if (prev && prev !== id) {
      const prevO = overlays.get(prev);
      if (prevO) {
        endEditingOnOverlay(prevO);
        resetOverlayEditState(prevO);
      }
    }

    resetOverlayEditState(o);
    clearStopEditing(o);
    layoutOverlay(o);
    layoutAll();
    updateMt5PosBar(o.pos);
    notifyTicket(o);
  }

  function deselectPosition(clearBar = true) {
    if (!selectedPosId) return;
    const o = overlays.get(selectedPosId);
    if (o) {
      endEditingOnOverlay(o);
      resetOverlayEditState(o);
      o.entryRow?.classList.remove("is-selected");
    }
    selectedPosId = null;
    barMode = "full";
    sliderPane = "close";
    if (clearBar) updateMt5PosBar(null);
    layoutAll();
    ctx().syncTicketStops?.({ sl: null, tp: null, slSaved: false, tpSaved: false, dragging: false });
  }

  function showStopLine(o, kind) {
    const isSl = kind === "sl";
    if (isSl) {
      o.slVal = o.slSaved ? Number(o.pos.sl) : defaultSl(o.pos);
      o.slBaseline = o.slVal;
      o.slDirty = false;
      o.slVisible = true;
    } else {
      o.tpVal = o.tpSaved ? Number(o.pos.tp) : defaultTp(o.pos);
      o.tpBaseline = o.tpVal;
      o.tpDirty = false;
      o.tpVisible = true;
    }
    barMode = "full";
    refreshStopVisibility(o);
    layoutOverlay(o);
  }

  function deactivateStopEditor(o, kind) {
    if (kind === "sl") o.slVisible = false;
    else o.tpVisible = false;
    refreshStopVisibility(o);
    layoutOverlay(o);
  }

  function showStopEditor(kind) {
    if (!selectedPosId) return;
    if (barMode === "close-only") barMode = "full";
    const o = overlays.get(selectedPosId);
    if (!o) return;
    const isSl = kind === "sl";
    const editing = isSl ? o.slVisible : o.tpVisible;
    if (editing) {
      deactivateStopEditor(o, kind);
    } else {
      showStopLine(o, kind);
    }
    updateMt5PosBar(o.pos);
    notifyTicket(o);
  }

  function markStopDirty(o, kind) {
    if (kind === "sl") {
      o.slDirty = priceChanged(o.slVal, o.slBaseline, o.pos.symbol);
    } else {
      o.tpDirty = priceChanged(o.tpVal, o.tpBaseline, o.pos.symbol);
    }
    if (overlayDirty(o)) setSliderPane("modify");
    updateMt5PosBar(o.pos);
  }

  async function modifyPosition() {
    const o = overlays.get(selectedPosId);
    const accountId = ctx().accountId;
    if (!o || !accountId || !window.AlphaFXApi) return;

    const body = { account_id: accountId };
    if (o.slDirty) body.stop_loss = o.slVal;
    if (o.tpDirty) body.take_profit = o.tpVal;
    if (!("stop_loss" in body) && !("take_profit" in body)) return;

    const saveSl = o.slDirty;
    const saveTp = o.tpDirty;

    try {
      await window.AlphaFXApi.request(`/api/v1/trade/positions/${selectedPosId}/stops`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const open = ctx().open || [];
      const row = open.find((p) => p.id === selectedPosId);
      if (saveSl) {
        o.slSaved = true;
        o.pos.sl = o.slVal;
        if (row) row.sl = o.slVal;
        o.slBaseline = o.slVal;
        o.slDirty = false;
        o.slVisible = false;
        o.slLine?.applyOptions({ lineStyle: LC().LineStyle.Dotted });
        rebuildStopRow(o, "sl");
      }
      if (saveTp) {
        o.tpSaved = true;
        o.pos.tp = o.tpVal;
        if (row) row.tp = o.tpVal;
        o.tpBaseline = o.tpVal;
        o.tpDirty = false;
        o.tpVisible = false;
        o.tpLine?.applyOptions({ lineStyle: LC().LineStyle.Dotted });
        rebuildStopRow(o, "tp");
      }
      barMode = "full";
      setSliderPane("close");
      refreshStopVisibility(o);
      layoutOverlay(o);
      window.AlphaFXToast?.show("Position modified", "success");
      updateMt5PosBar(o.pos);
      notifyTicket(o);
    } catch (e) {
      window.AlphaFXToast?.show(e?.message || "Could not modify position", "error");
    }
  }

  async function cancelStop(o, kind) {
    const isSl = kind === "sl";
    try {
      if (isSl && o.slSaved) {
        await clearStopOnServer(o.pos.id, kind);
        o.slSaved = false;
        o.pos.sl = null;
        const open = ctx().open || [];
        const row = open.find((p) => p.id === o.pos.id);
        if (row) row.sl = null;
      } else if (!isSl && o.tpSaved) {
        await clearStopOnServer(o.pos.id, kind);
        o.tpSaved = false;
        o.pos.tp = null;
        const open = ctx().open || [];
        const row = open.find((p) => p.id === o.pos.id);
        if (row) row.tp = null;
      } else if (isSl) {
        o.slVal = o.slBaseline ?? defaultSl(o.pos);
        o.slDirty = false;
      } else {
        o.tpVal = o.tpBaseline ?? defaultTp(o.pos);
        o.tpDirty = false;
      }
      removeStopOverlay(o, kind);
      if (!overlayDirty(o) && !o.slVisible && !o.tpVisible) {
        setSliderPane("close");
      }
      layoutOverlay(o);
      updateMt5PosBar(o.pos);
      notifyTicket(o);
      window.AlphaFXToast?.show(`${kind.toUpperCase()} removed`, "success");
    } catch (e) {
      window.AlphaFXToast?.show(e?.message || "Could not remove stop", "error");
    }
  }

  async function clearStopOnServer(id, kind) {
    const accountId = ctx().accountId;
    if (!accountId || !window.AlphaFXApi) return;
    const body = { account_id: accountId };
    if (kind === "sl") body.stop_loss = null;
    else body.take_profit = null;
    await window.AlphaFXApi.request(`/api/v1/trade/positions/${id}/stops`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  function upsertOverlay(pos) {
    if (!series || !overlayRoot) return;

    const restored = getRestore(pos.id);
    const prev = overlays.get(pos.id);
    const prevState =
      restored ||
      (prev
        ? {
            slVisible: prev.slVisible,
            tpVisible: prev.tpVisible,
            slDirty: prev.slDirty,
            tpDirty: prev.tpDirty,
            slBaseline: prev.slBaseline,
            tpBaseline: prev.tpBaseline,
            slVal: prev.slVal,
            tpVal: prev.tpVal,
            selected: selectedPosId === pos.id,
          }
        : null);

    stripOverlay(pos.id);

    const entry = Number(pos.entry);
    const slSaved = hasSl(pos);
    const tpSaved = hasTp(pos);
    const lite = isLiteChartUi();

    const entryLine = lite
      ? createMt5EntryLine(entry)
      : createLine(entry, COLORS.entry, true, COLORS.entryAxis, COLORS.entryText);
    const entryRow = buildEntryPill(pos);
    overlayRoot.append(entryRow);

    const record = {
      pos,
      entryLine,
      slLine: null,
      tpLine: null,
      slVal: slSaved ? Number(pos.sl) : defaultSl(pos),
      tpVal: tpSaved ? Number(pos.tp) : defaultTp(pos),
      slSaved,
      tpSaved,
      slVisible: lite ? false : true,
      tpVisible: lite ? false : true,
      slDirty: false,
      tpDirty: false,
      slBaseline: slSaved ? Number(pos.sl) : null,
      tpBaseline: tpSaved ? Number(pos.tp) : null,
      entryRow,
      slRow: null,
      tpRow: null,
    };

    if (prevState) {
      record.slVisible = prevState.slVisible;
      record.tpVisible = prevState.tpVisible;
      record.slDirty = prevState.slDirty;
      record.tpDirty = prevState.tpDirty;
      record.slBaseline = prevState.slBaseline;
      record.tpBaseline = prevState.tpBaseline;
      if (prevState.slVal != null) record.slVal = prevState.slVal;
      if (prevState.tpVal != null) record.tpVal = prevState.tpVal;
    }

    overlays.set(pos.id, record);

    if (!lite) {
      record.slLine = createLine(record.slVal, COLORS.sl, slSaved, COLORS.slAxis, COLORS.slText);
      record.tpLine = createLine(record.tpVal, COLORS.tp, tpSaved, COLORS.tpAxis, COLORS.tpText);
      record.slRow = buildTag("sl", pos, record.slVal, true);
      record.tpRow = buildTag("tp", pos, record.tpVal, true);
      overlayRoot.append(record.slRow, record.tpRow);
    } else if (prevState && (prevState.selected || selectedPosId === pos.id)) {
      if (prevState.selected) selectedPosId = pos.id;
      refreshStopVisibility(record);
    } else if (lite && (slSaved || tpSaved)) {
      refreshStopVisibility(record);
    }

    layoutOverlay(record);
    if (selectedPosId === pos.id) notifyTicket(record);
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
    if (document.body.classList.contains("trade-clean-mode")) {
      window.AlphaFXPositionOverlay?.sync();
      return;
    }
    const prevSelected = selectedPosId;
    const prevBarMode = barMode;
    const prevSlider = sliderPane;
    syncRestore = new Map();

    for (const [id, o] of overlays) {
      syncRestore.set(id, {
        slVisible: o.slVisible,
        tpVisible: o.tpVisible,
        slDirty: o.slDirty,
        tpDirty: o.tpDirty,
        slBaseline: o.slBaseline,
        tpBaseline: o.tpBaseline,
        slVal: o.slVal,
        tpVal: o.tpVal,
        selected: selectedPosId === id,
      });
    }

    for (const id of [...overlays.keys()]) {
      const o = overlays.get(id);
      if (!o) continue;
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
    drag = null;
    if (overlayRoot) overlayRoot.innerHTML = "";

    if (!series || !chart) {
      syncRestore = null;
      return;
    }

    const { activeSymbol, open = [], pending = [] } = ctx();
    const positions = open.filter((p) => p.symbol === activeSymbol);
    const pendingOrders = pending.filter((p) => p.symbol === activeSymbol);

    selectedPosId = prevSelected;
    barMode = prevBarMode;
    sliderPane = prevSlider;
    positions.forEach((pos) => upsertOverlay(pos));
    pendingOrders.forEach(upsertPendingOverlay);

    syncRestore = null;

    if (selectedPosId && !overlays.has(selectedPosId)) {
      deselectPosition();
    } else if (selectedPosId && isMt5Mode()) {
      updateMt5PosBar(overlays.get(selectedPosId)?.pos);
    }

    if (!positions.length) {
      deselectPosition();
      ctx().syncTicketStops?.({ sl: null, tp: null, slSaved: false, tpSaved: false, dragging: false });
    }
    ensureRangeSub();
    layoutAll();
  }

  function updateLivePnl() {
    if (document.body.classList.contains("trade-clean-mode")) {
      window.AlphaFXPositionOverlay?.updateLivePnl?.();
      return;
    }
    if (isMt5Mode()) return;
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
      const solid = stopLineSolid(o, "sl");
      o.slLine?.applyOptions({ price: exact, lineStyle: lineStyle(solid) });
      rebuildStopRow(o, "sl");
    } else {
      o.tpVal = exact;
      const solid = stopLineSolid(o, "tp");
      o.tpLine?.applyOptions({ price: exact, lineStyle: lineStyle(solid) });
      rebuildStopRow(o, "tp");
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
      updateMt5PosBar(o.pos);
    } catch (e) {
      window.AlphaFXToast?.show(e?.message || "Could not save stops", "error");
      sync();
    }
  }

  function editingStops() {
    if (!selectedPosId) return false;
    const o = overlays.get(selectedPosId);
    return !!(o && (o.slVisible || o.tpVisible || overlayDirty(o)));
  }

  function beginStopDrag(id, kind, ev) {
    selectedPosId = id;
    const o = overlays.get(id);
    if (o) {
      if (kind === "sl" && !o.slVisible) showStopLine(o, "sl");
      if (kind === "tp" && !o.tpVisible) showStopLine(o, "tp");
    }
    ev.preventDefault();
    ev.stopPropagation();
    drag = { id, kind, pointerId: ev.pointerId, moved: false };
    document.body.style.cursor = "ns-resize";
    overlayRoot?.classList.add("is-dragging");
    chart.applyOptions({ handleScroll: false, handleScale: false });
    (overlayRoot || container)?.setPointerCapture?.(ev.pointerId);
  }

  function onPointerDown(ev) {
    if (!series || !chart || drag) return;

    if (ev.target.closest("[data-cancel-stop]")) return;
    if (ev.target.closest("#mt5-pos-bar")) return;

    const stopRow = ev.target.closest(".cpf-pos-row--sl, .cpf-pos-row--tp");
    if (stopRow && isMt5Mode()) {
      const id = Number(stopRow.dataset.posId);
      const kind = stopRow.dataset.kind;
      if (id && (kind === "sl" || kind === "tp")) {
        selectedPosId = id;
        beginStopDrag(id, kind, ev);
        return;
      }
    }

    const tag = ev.target.closest(".cpf-pos-tag");
    if (tag) {
      const row = tag.closest(".cpf-pos-row");
      const id = Number(row?.dataset.posId);
      const kind = row?.dataset.kind;
      if (id && (kind === "sl" || kind === "tp")) {
        selectedPosId = id;
        beginStopDrag(id, kind, ev);
        return;
      }
    }

    if (ev.target.closest(".cpf-entry-label")) return;

    const y = chartY(ev.clientY);
    const hit = findHit(y);
    if (!hit) {
      if (isMt5Mode() && selectedPosId && !editingStops()) {
        deselectPosition();
      }
      return;
    }

    if (hit.kind === "entry" && isMt5Mode()) {
      ev.preventDefault();
      ev.stopPropagation();
      selectPosition(hit.id);
      return;
    }

    if (hit.kind === "sl" || hit.kind === "tp") {
      selectedPosId = hit.id;
      beginStopDrag(hit.id, hit.kind, ev);
    }
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
    if (isMt5Mode()) markStopDirty(o, drag.kind);
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
    if (moved && !isMt5Mode()) persistStops(id, kind);
    else if (moved && isMt5Mode()) {
      const o = overlays.get(id);
      if (o) {
        refreshStopVisibility(o);
        layoutOverlay(o);
      }
    }
  }

  function bindMt5Slider() {
    if (sliderBound) return;
    sliderBound = true;
    const wrap = document.getElementById("mt5-pos-slider-wrap");
    if (!wrap) return;

    wrap.addEventListener(
      "touchstart",
      (e) => {
        sliderTouchStartX = e.touches[0]?.clientX ?? 0;
      },
      { passive: true }
    );

    wrap.addEventListener(
      "touchend",
      (e) => {
        const o = overlays.get(selectedPosId);
        if (!overlayDirty(o)) return;
        const endX = e.changedTouches[0]?.clientX ?? 0;
        const dx = endX - sliderTouchStartX;
        if (dx < -36) setSliderPane("modify");
        else if (dx > 36) setSliderPane("close");
      },
      { passive: true }
    );

    wrap.addEventListener("mousedown", (e) => {
      sliderTouchStartX = e.clientX;
    });

    wrap.addEventListener("mouseup", (e) => {
      const o = overlays.get(selectedPosId);
      if (!overlayDirty(o)) return;
      const dx = e.clientX - sliderTouchStartX;
      if (dx < -36) setSliderPane("modify");
      else if (dx > 36) setSliderPane("close");
    });
  }

  function bindMt5PosBar() {
    if (mt5BarBound) return;
    mt5BarBound = true;
    bindMt5Slider();

    document.getElementById("mt5-pos-pane-close")?.addEventListener("click", () => {
      if (!selectedPosId) return;
      ctx().closePosition?.(selectedPosId);
      deselectPosition();
    });

    document.getElementById("mt5-pos-pane-modify")?.addEventListener("click", () => {
      modifyPosition();
    });

    document.getElementById("mt5-pos-sl")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showStopEditor("sl");
    });
    document.getElementById("mt5-pos-tp")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showStopEditor("tp");
    });

    document.getElementById("mt5-pos-bar-dismiss")?.addEventListener("click", () => deselectPosition());
  }

  function bindDrag() {
    if (dragHost) return;
    dragHost = overlayRoot?.parentElement || container;
    if (!dragHost) return;
    dragHost.addEventListener("pointerdown", onPointerDown);
    dragHost.addEventListener("pointermove", onPointerMove);
    dragHost.addEventListener("pointerup", onPointerUp);
    dragHost.addEventListener("pointercancel", onPointerUp);
    bindMt5PosBar();
  }

  function unbindDrag() {
    if (!dragHost) return;
    dragHost.removeEventListener("pointerdown", onPointerDown);
    dragHost.removeEventListener("pointermove", onPointerMove);
    dragHost.removeEventListener("pointerup", onPointerUp);
    dragHost.removeEventListener("pointercancel", onPointerUp);
    dragHost = null;
  }

  function onModeChange() {
    if (!chart || !series || !container || !getContext) return;
    const clean = document.body.classList.contains("trade-clean-mode");
    if (clean) {
      clear();
      deselectPosition();
      window.AlphaFXPositionOverlay?.attach({ chart, series, container, getContext });
      return;
    }
    window.AlphaFXPositionOverlay?.detach();
    overlayRoot =
      container.parentElement?.querySelector("#trade-pos-overlays") ||
      container.parentElement?.querySelector(".trade-pos-overlays");
    if (!overlayRoot && container.parentElement) {
      overlayRoot = document.createElement("div");
      overlayRoot.id = "trade-pos-overlays";
      overlayRoot.className = "trade-pos-overlays";
      overlayRoot.setAttribute("aria-hidden", "true");
      container.parentElement.appendChild(overlayRoot);
    }
    if (!dragHost) bindDrag();
    if (!isMt5Mode()) deselectPosition();
    sync();
  }

  function attach({ chart: c, series: s, container: el, getContext: gc }) {
    chart = c;
    series = s;
    container = el;
    getContext = gc;

    if (document.body.classList.contains("trade-clean-mode")) {
      window.AlphaFXPositionOverlay?.attach({ chart: c, series: s, container: el, getContext: gc });
      window.addEventListener("resize", onModeChange);
      return;
    }
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
    window.addEventListener("resize", onModeChange);
  }

  function detach() {
    if (document.body.classList.contains("trade-clean-mode")) {
      window.AlphaFXPositionOverlay?.detach();
      return;
    }
    clear();
    unbindDrag();
    deselectPosition();
    window.removeEventListener("resize", onModeChange);
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
    deselectPosition,
    modeChange: onModeChange,
  };
})();

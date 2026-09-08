/**
 * AlphaFX web trade terminal — live data mapping
 */
(function () {
  const STORAGE_TABS = "alphafx_trade_tabs";
  const STORAGE_TF = "alphafx_trade_tf";
  const STORAGE_SYMBOL = "alphafx_trade_symbol";
  const STORAGE_ACCOUNT = "alphafx_trade_account";
  const DEFAULT_SYMBOL = "BTCUSD";
  const DEFAULT_TABS = ["XAUUSD", "BTCUSD"];
  const DEFAULT_TIMEFRAME = "M1";
  const TIMEFRAMES = [
    { id: "M1", label: "1m", step: 60 },
    { id: "M5", label: "5m", step: 300 },
    { id: "M15", label: "15m", step: 900 },
    { id: "M30", label: "30m", step: 1800 },
    { id: "H1", label: "1H", step: 3600 },
    { id: "H4", label: "4H", step: 14400 },
    { id: "D1", label: "1D", step: 86400 },
    { id: "W1", label: "1W", step: 604800 },
    { id: "MN1", label: "1M", step: 2592000 },
  ];

  let activeSymbol = DEFAULT_SYMBOL;
  let activeTimeframe = DEFAULT_TIMEFRAME;
  let openTabs = [...DEFAULT_TABS];
  let chart = null;
  let series = null;
  let barBuffer = [];
  let groups = {};
  let symbolMeta = {};
  let accountId = null;
  let accountData = null;
  let tradeSnapshot = { open: [], pending: [], closed: [], counts: { open: 0, pending: 0, closed: 0 } };
  let bottomPanel = "open";
  let lastPrices = {};
  let initialized = false;
  let accountPollTimer = null;
  let chartLoading = false;
  let chartMount = null;
  let loadChartPromise = null;
  let layoutReady = false;
  /** @type {Map<string, number>} */
  const sessionFillTimes = new Map();
  let historyVisible = true;
  const STORAGE_HISTORY = "alphafx_trade_history_visible";

  function tickTimeMs(tick) {
    let t = Number(tick?.time_ms) || Date.now();
    if (t < 1e12) t *= 1000;
    return t;
  }

  function tfStep(tf) {
    return TIMEFRAMES.find((t) => t.id === tf)?.step || 60;
  }

  function barBucket(ms, tf) {
    const sec = Math.floor(ms / 1000);
    if (tf === "MN1") {
      const d = new Date(ms);
      return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
    }
    if (tf === "W1") {
      const d = new Date(ms);
      const day = d.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff) / 1000);
    }
    const step = tfStep(tf);
    return Math.floor(sec / step) * step;
  }

  function applyTimeScaleOptions() {
    if (!chart) return;
    const intraday = ["M1", "M5", "M15", "M30", "H1", "H4"].includes(activeTimeframe);
    chart.applyOptions({
      timeScale: {
        timeVisible: true,
        secondsVisible: activeTimeframe === "M1",
      },
    });
  }

  let chartResizeObserver = null;
  let liveBarQueued = false;
  let chartSource = "none";
  let tradingEnabled = false;
  let orderBusy = false;
  let orderType = "market";
  const closingTradeIds = new Set();
  let pendingReloadTimer = null;

  function toast(message, type = "info") {
    window.AlphaFXToast?.show(message, type);
  }

  /** Trade table time — same timezone as chart axis (browser local from unix). */
  function fmtTradeTime(row, field) {
    const secKey =
      field === "opened" || field === "created"
        ? "opened_time"
        : field === "closed"
          ? "closed_time"
          : `${field}_time`;
    const sec = row?.[secKey];
    if (sec != null && sec !== "" && window.AlphaFXTime?.formatLocalDateTime) {
      return window.AlphaFXTime.formatLocalDateTime(sec);
    }
    const iso = row?.[field];
    if (iso && window.AlphaFXTime?.formatLocalDateTime) {
      const d = window.AlphaFXTime.parseUtc(iso);
      if (d && !Number.isNaN(d.getTime())) {
        return window.AlphaFXTime.formatLocalDateTime(Math.floor(d.getTime() / 1000));
      }
    }
    return iso ?? "—";
  }

  function chartBodyEl(container) {
    return container?.closest(".trade-chart-body") || container?.parentElement;
  }

  function measureChart(container) {
    const body = chartBodyEl(container);
    const el = body || container;
    const rect = el?.getBoundingClientRect();
    const w = Math.max(Math.floor(rect?.width || el?.clientWidth || 320), 200);
    const h = Math.max(Math.floor(rect?.height || el?.clientHeight || 360), 200);
    return { w, h };
  }

  function applyChartSize(container) {
    if (!chart || !container) return;
    const { w, h } = measureChart(container);
    chart.applyOptions({ width: w, height: h });
  }

  function patchFormingBar(tick) {
    if (!tick || !series || !barBuffer.length) return;
    const bid = Number(tick.bid);
    const ask = Number(tick.ask);
    const mid = anchorFromTick(tick);
    const bucket = barBucket(tickTimeMs(tick), activeTimeframe);
    const last = barBuffer[barBuffer.length - 1];
    if (!last) return;

    if (bucket === last.time) {
      last.high = Math.max(last.high, ask, mid);
      last.low = Math.min(last.low, bid, mid);
      last.close = mid;
      series.update({ ...last });
      return;
    }

    const step = tfStep(activeTimeframe);
    if (bucket > last.time && bucket - last.time === step) {
      const bar = { time: bucket, open: mid, high: ask, low: bid, close: mid };
      barBuffer.push(bar);
      series.update(bar);
    }
  }

  function queueLiveBarUpdate(tick) {
    if (liveBarQueued) return;
    liveBarQueued = true;
    requestAnimationFrame(() => {
      liveBarQueued = false;
      patchFormingBar(tick);
      window.AlphaFXChartPositions?.layoutAll?.();
    });
  }

  function normalizeUnixSec(t) {
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }

  function isPlausibleUnixSec(sec) {
    return sec != null && sec >= 1_000_000_000;
  }

  /** True when unix sec falls inside a loaded OHLC bar window. */
  function isTimeInBarBuffer(unixSec) {
    const sec = normalizeUnixSec(unixSec);
    if (sec == null || !barBuffer.length) return false;
    const bucket = barBucket(sec * 1000, activeTimeframe);
    const step = tfStep(activeTimeframe);
    const first = barBuffer[0].time;
    const last = barBuffer[barBuffer.length - 1].time;
    if (bucket < first || bucket >= last + step) return false;
    return barBuffer.some((b) => b.time === bucket);
  }

  function rememberSessionFillTime(tradeId, unixSec) {
    const sec = normalizeUnixSec(unixSec);
    if (tradeId == null || sec == null || !isPlausibleUnixSec(sec)) return;
    sessionFillTimes.set(String(tradeId), sec);
  }

  function barAtUnixSec(unixSec) {
    const sec = normalizeUnixSec(unixSec);
    if (sec == null || !barBuffer.length) return null;
    const bucket = barBucket(sec * 1000, activeTimeframe);
    return barBuffer.find((b) => b.time === bucket) || null;
  }

  function priceFitsBar(price, bar) {
    if (!bar || price == null) return false;
    const p = Number(price);
    if (!Number.isFinite(p)) return false;
    const span = Math.max(Number(bar.high) - Number(bar.low), 0.01);
    const pad = Math.max(0.15, span * 0.15);
    return p >= Number(bar.low) - pad && p <= Number(bar.high) + pad;
  }

  function barMidSec(bar) {
    if (!bar) return null;
    return bar.time + Math.floor(tfStep(activeTimeframe) / 2);
  }

  function acceptMarkerSec(sec, floorSec) {
    const normalized = normalizeUnixSec(sec);
    if (normalized == null || !isPlausibleUnixSec(normalized)) return null;
    if (floorSec != null && normalized < floorSec) return null;
    if (!isTimeInBarBuffer(normalized)) return null;
    return normalized;
  }

  function anchorBarIndex(anchorSec) {
    if (anchorSec == null || !barBuffer.length) return -1;
    const bar = barAtUnixSec(anchorSec);
    if (bar) return barBuffer.findIndex((b) => b.time === bar.time);
    const bucket = barBucket(anchorSec * 1000, activeTimeframe);
    if (bucket < barBuffer[0].time) return -1;
    for (let i = barBuffer.length - 1; i >= 0; i--) {
      if (barBuffer[i].time <= bucket) return i;
    }
    return -1;
  }

  /**
   * Pick marker time from server timestamps; only search a small bar window
   * around the anchor when opened_at is stale (limit placed before fill).
   */
  function resolveMarkerTimeForPrice(price, preferredSec, closedSec, minSec) {
    const p = Number(price);
    const preferred = normalizeUnixSec(preferredSec);
    const closeHint = normalizeUnixSec(closedSec);
    const floorSec = normalizeUnixSec(minSec);
    const step = tfStep(activeTimeframe);

    const direct = acceptMarkerSec(preferred, floorSec) ?? acceptMarkerSec(closeHint, floorSec);
    if (direct != null) return direct;

    const anchorSec = closeHint ?? preferred;
    const anchorIdx = anchorBarIndex(anchorSec);
    if (anchorIdx < 0) return null;

    const prefBar = preferred != null ? barAtUnixSec(preferred) : null;
    const closeBar = closeHint != null ? barAtUnixSec(closeHint) : null;
    if (prefBar && priceFitsBar(p, prefBar)) {
      const sec = acceptMarkerSec(preferred, floorSec);
      if (sec != null) return sec;
    }
    if (closeBar && priceFitsBar(p, closeBar)) {
      const sec = acceptMarkerSec(closeHint, floorSec);
      if (sec != null) return sec;
    }

    // Stale opened_at: walk backward from anchor bar only (never scan the whole chart).
    const lookback = 8;
    const endIdx = Math.max(0, anchorIdx - lookback);
    if (Number.isFinite(p)) {
      for (let i = anchorIdx; i >= endIdx; i--) {
        const b = barBuffer[i];
        if (!priceFitsBar(p, b)) continue;
        const candidate = b.time + Math.floor(step / 2);
        if (floorSec != null && candidate < floorSec) continue;
        return candidate;
      }
    }

    const anchorBar = barBuffer[anchorIdx];
    const mid = barMidSec(anchorBar);
    if (mid != null && (floorSec == null || mid >= floorSec)) return mid;
    return null;
  }

  function resolveHistoryOpenSec(tradeId, serverOpenedTime, entry, closedTime) {
    const remembered =
      sessionFillTimes.get(String(tradeId)) ??
      window.AlphaFXPositionOverlay?.getHistoryFillSec?.(tradeId);
    if (remembered != null) {
      const sec = normalizeUnixSec(remembered);
      const accepted = acceptMarkerSec(sec);
      if (accepted != null) return accepted;
    }
    const opened = normalizeUnixSec(serverOpenedTime);
    const closed = normalizeUnixSec(closedTime);
    const accepted = acceptMarkerSec(opened);
    if (accepted != null) return accepted;
    return resolveMarkerTimeForPrice(entry, opened, closed);
  }

  function resolveHistoryCloseSec(tradeId, serverClosedTime, exit, openedTime, resolvedOpenSec) {
    const anchor = window.AlphaFXPositionOverlay?.getCloseAnchorSec?.(tradeId);
    if (anchor != null) {
      const sec = normalizeUnixSec(anchor);
      const accepted = acceptMarkerSec(sec);
      if (accepted != null) return accepted;
    }
    const closed = normalizeUnixSec(serverClosedTime);
    const opened = normalizeUnixSec(openedTime);
    const floorSec = normalizeUnixSec(resolvedOpenSec ?? openedTime);
    const accepted = acceptMarkerSec(closed, floorSec);
    if (accepted != null) return accepted;
    return resolveMarkerTimeForPrice(exit, closed, closed ?? opened, floorSec);
  }

  function destroyChart() {
    window.AlphaFXChartPositions?.detach?.();
    if (chartResizeObserver) {
      chartResizeObserver.disconnect();
      chartResizeObserver = null;
    }
    if (chart) {
      try {
        chart.remove();
      } catch {
        /* ignore */
      }
    }
    chart = null;
    series = null;
    chartMount = null;
  }

  function ensureChart(container) {
    if (chart && chartMount !== container) {
      destroyChart();
    }
    if (!chart) {
      chartMount = container;
      chart = window.LightweightCharts.createChart(container, {
        layout: { background: { color: "#0b0e11" }, textColor: "#848e9c" },
        grid: { vertLines: { color: "#1e2329" }, horzLines: { color: "#1e2329" } },
        crosshair: {
          mode: window.LightweightCharts.CrosshairMode.Normal,
          vertLine: {
            color: "rgba(234, 236, 239, 0.35)",
            width: 1,
            style: window.LightweightCharts.LineStyle.Dashed,
            labelBackgroundColor: "#2b3139",
          },
          horzLine: {
            color: "rgba(234, 236, 239, 0.35)",
            width: 1,
            style: window.LightweightCharts.LineStyle.Dashed,
            labelBackgroundColor: "#2b3139",
          },
        },
        timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#1e2329" },
        rightPriceScale: { borderColor: "#1e2329" },
      });
      series = chart.addCandlestickSeries({
        upColor: "#0ecb81",
        downColor: "#f6465d",
        borderVisible: false,
        wickUpColor: "#0ecb81",
        wickDownColor: "#f6465d",
      });
      applyTimeScaleOptions();
      const body = chartBodyEl(container);
      const resize = () => applyChartSize(container);
      if (chartResizeObserver) chartResizeObserver.disconnect();
      chartResizeObserver = new ResizeObserver(resize);
      if (body) chartResizeObserver.observe(body);
      resize();
      bindChartPositions(container);
    } else {
      applyChartSize(container);
      bindChartPositions(container);
      chart.applyOptions({
        crosshair: {
          mode: window.LightweightCharts.CrosshairMode.Normal,
          vertLine: {
            color: "rgba(255, 255, 255, 0.55)",
            width: 1,
            style: window.LightweightCharts.LineStyle.Dashed,
            labelBackgroundColor: "#27272a",
          },
          horzLine: {
            color: "rgba(255, 255, 255, 0.55)",
            width: 1,
            style: window.LightweightCharts.LineStyle.Dashed,
            labelBackgroundColor: "#27272a",
          },
        },
      });
    }
    return series;
  }

  function syncTicketStopsFromChart({ sl, tp, slSaved, tpSaved, dragging }) {
    const slEl = document.getElementById("trade-sl");
    const tpEl = document.getElementById("trade-tp");
    const sym = activeSymbol;
    if (slEl) {
      if (slSaved || dragging) slEl.value = sl != null ? fmtPrice(sym, sl) : "";
      else if (!dragging) slEl.value = "";
      slEl.placeholder = slSaved || dragging ? "" : "—";
    }
    if (tpEl) {
      if (tpSaved || dragging) tpEl.value = tp != null ? fmtPrice(sym, tp) : "";
      else if (!dragging) tpEl.value = "";
      tpEl.placeholder = tpSaved || dragging ? "" : "—";
    }
  }

  function chartPositionsContext() {
    return {
      activeSymbol,
      open: tradeSnapshot.open || [],
      pending: tradeSnapshot.pending || [],
      closed: tradeSnapshot.closed || [],
      accountId,
      symbolMeta,
      fmtPrice,
      barBuffer,
      fallbackTime: () => barBuffer[barBuffer.length - 1]?.time,
      resolveHistoryOpenSec,
      resolveHistoryCloseSec,
      resolveMarkerTimeForPrice,
      closePosition: (id) => closePosition(id),
      cancelPendingOrder: (id) => cancelPendingOrder(id),
      submitDraftOrder: (draft) => submitDraftOrder(draft),
      reloadSnapshot: () => loadTradeSnapshot(),
      getMarketPrice: () => {
        const tick = window.AlphaFXQuotes?.getLast?.(activeSymbol);
        if (!tick) return null;
        return (Number(tick.bid) + Number(tick.ask)) / 2;
      },
      snapBarTime: (unixSec) => barBucket(Number(unixSec) * 1000, activeTimeframe),
      tfStep,
      activeTimeframe,
      syncTicketStops: syncTicketStopsFromChart,
      isMt5Mobile: () => document.body.classList.contains("trade-mt5-mode"),
    };
  }

  async function submitDraftOrder(draft) {
    if (!tradingEnabled || !accountId) throw new Error("Trading unavailable");
    const res = await window.AlphaFXApi.request("/api/v1/trade/orders", {
      method: "POST",
      body: JSON.stringify({
        account_id: accountId,
        symbol: activeSymbol,
        side: draft.side,
        volume: draft.volume,
        order_type: draft.orderKind,
        price: draft.price,
        stop_loss: draft.sl,
        take_profit: draft.tp,
      }),
    });
    toast(res.message || "Order placed", "success");
    if (String(draft.orderKind || "").toLowerCase() === "market") window.playOrderFilledSound?.();
    const fillSec = Math.floor(Date.now() / 1000);
    const barTime =
      window.AlphaFXPositionOverlay?.barTimeForSec?.(fillSec) ??
      (barBuffer.length > 0
        ? barBuffer[barBuffer.length - 1].time
        : barBucket(fillSec * 1000, activeTimeframe));
    if (res.trade_id != null) {
      rememberSessionFillTime(res.trade_id, fillSec);
      window.AlphaFXPositionOverlay?.setFillAnchor?.(res.trade_id, { unixSec: fillSec, barTime });
    }
    await loadTradeSnapshot();
    window.AlphaFXPositionOverlay?.sync?.();
  }

  function bindChartPositions(container) {
    if (!window.AlphaFXChartPositions || !chart || !series) return;
    window.AlphaFXChartPositions.attach({
      chart,
      series,
      container,
      getContext: chartPositionsContext,
    });
  }

  function syncChartPositions() {
    if (!window.AlphaFXChartPositions || !series) return;
    window.AlphaFXChartPositions.sync();
  }

  const money = (n) =>
    `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function fmtPrice(symbol, value) {
    const digits = symbolMeta[symbol]?.digits ?? { EURUSD: 5, GBPUSD: 5, USDJPY: 3, XAUUSD: 2, BTCUSD: 3 }[symbol] ?? 5;
    return Number(value).toFixed(digits);
  }

  function loadTimeframePref() {
    try {
      const saved = localStorage.getItem(STORAGE_TF);
      if (saved && TIMEFRAMES.some((t) => t.id === saved)) activeTimeframe = saved;
    } catch {
      /* ignore */
    }
  }

  function loadSymbolPref() {
    try {
      const saved = localStorage.getItem(STORAGE_SYMBOL);
      if (saved) activeSymbol = String(saved);
    } catch {
      /* ignore */
    }
  }

  function saveSymbolPref() {
    try {
      localStorage.setItem(STORAGE_SYMBOL, activeSymbol);
    } catch {
      /* ignore */
    }
  }

  function loadAccountPref() {
    try {
      const saved = localStorage.getItem(STORAGE_ACCOUNT);
      if (saved) accountId = Number(saved) || null;
    } catch {
      /* ignore */
    }
  }

  function saveAccountPref() {
    try {
      if (accountId) localStorage.setItem(STORAGE_ACCOUNT, String(accountId));
    } catch {
      /* ignore */
    }
  }

  function saveTimeframePref() {
    try {
      localStorage.setItem(STORAGE_TF, activeTimeframe);
    } catch {
      /* ignore */
    }
  }

  function loadHistoryPref() {
    try {
      const raw = localStorage.getItem(STORAGE_HISTORY);
      if (raw === "0" || raw === "false") historyVisible = false;
      else if (raw === "1" || raw === "true") historyVisible = true;
    } catch {
      /* ignore */
    }
  }

  function saveHistoryPref() {
    try {
      localStorage.setItem(STORAGE_HISTORY, historyVisible ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function applyHistoryVisibility() {
    window.AlphaFXPositionOverlay?.setHistoryVisible?.(historyVisible);
    const btn = document.getElementById("trade-history-toggle");
    if (btn) {
      btn.textContent = historyVisible ? "Hide history" : "Show history";
      btn.setAttribute("aria-pressed", historyVisible ? "true" : "false");
      btn.classList.toggle("is-off", !historyVisible);
    }
  }

  function toggleHistoryVisibility() {
    historyVisible = !historyVisible;
    saveHistoryPref();
    applyHistoryVisibility();
  }

  function allChartSymbols() {
    const out = [];
    const seen = new Set();
    Object.values(groups).forEach((items) => {
      (items || []).forEach((item) => {
        const sym = String(item.symbol || "").toUpperCase();
        if (!sym || seen.has(sym)) return;
        seen.add(sym);
        out.push({ symbol: sym, name: item.name || sym });
      });
    });
    return out;
  }

  function renderChartSymbolSelect() {
    const sel = document.getElementById("trade-chart-symbol");
    if (!sel) return;
    const prev = sel.value;
    const symbols = allChartSymbols();
    if (!symbols.length) {
      sel.innerHTML = `<option value="${activeSymbol}">${activeSymbol}</option>`;
      sel.value = activeSymbol;
      return;
    }
    const byGroup = {};
    Object.entries(groups).forEach(([group, items]) => {
      byGroup[group] = (items || []).map((i) => String(i.symbol).toUpperCase());
    });
    sel.innerHTML = Object.entries(byGroup)
      .map(([group, syms]) => {
        const opts = syms
          .map((sym) => {
            const item = symbols.find((s) => s.symbol === sym);
            const label = item?.name && item.name !== sym ? `${sym} — ${item.name}` : sym;
            return `<option value="${sym}">${label}</option>`;
          })
          .join("");
        return `<optgroup label="${group}">${opts}</optgroup>`;
      })
      .join("");
    const next = symbols.some((s) => s.symbol === prev) ? prev : activeSymbol;
    sel.value = next;
  }

  function syncChartSymbolSelect(symbol) {
    const sel = document.getElementById("trade-chart-symbol");
    if (!sel) return;
    if (sel.value !== symbol) sel.value = symbol;
  }

  function bindChartControls() {
    document.getElementById("trade-history-toggle")?.addEventListener("click", toggleHistoryVisibility);
    document.getElementById("trade-chart-symbol")?.addEventListener("change", (e) => {
      const sym = e.target.value;
      if (sym && sym !== activeSymbol) selectSymbol(sym);
    });
  }

  function renderTimeframes() {
    const root = document.getElementById("trade-timeframes");
    if (!root) return;
    root.innerHTML = TIMEFRAMES.map(
      (tf) =>
        `<button type="button" class="trade-tf-btn${tf.id === activeTimeframe ? " active" : ""}" data-tf="${tf.id}" role="tab" aria-selected="${tf.id === activeTimeframe}">${tf.label}</button>`
    ).join("");
  }

  function bindTimeframes() {
    const root = document.getElementById("trade-timeframes");
    if (!root) return;
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tf]");
      if (!btn) return;
      const tf = btn.dataset.tf;
      if (!tf || tf === activeTimeframe) return;
      activeTimeframe = tf;
      saveTimeframePref();
      renderTimeframes();
      syncCleanTitle(activeSymbol);
      applyTimeScaleOptions();
      loadChart(activeSymbol);
    });
  }

  function tfLabel(tf) {
    return TIMEFRAMES.find((t) => t.id === tf)?.label || tf;
  }

  function loadTabs() {
    try {
      const raw = localStorage.getItem(STORAGE_TABS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) openTabs = parsed.map(String);
      }
    } catch {
      /* ignore */
    }
    if (!openTabs.includes(activeSymbol)) openTabs.unshift(activeSymbol);
  }

  function saveTabs() {
    localStorage.setItem(STORAGE_TABS, JSON.stringify(openTabs));
  }

  function setLiveStatus(live) {
    const dot = document.getElementById("trade-live-dot");
    const label = document.getElementById("trade-live-label");
    if (dot) dot.classList.toggle("live", !!live);
    if (label) label.textContent = live ? "Live" : "Reconnecting…";
    const mt5Dot = document.getElementById("mt5-live-dot");
    const mt5Text = document.getElementById("mt5-live-text");
    if (mt5Dot) mt5Dot.classList.toggle("is-live", !!live);
    if (mt5Text) mt5Text.textContent = live ? "Live" : "…";
  }

  function renderSymbolTabs() {
    const roots = [
      document.getElementById("trade-symbol-tabs"),
      document.getElementById("trade-clean-symbols"),
    ].filter(Boolean);
    if (!roots.length) return;
    roots.forEach((root) => {
      root.innerHTML = "";
      openTabs.forEach((sym) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "trade-symbol-tab" + (sym === activeSymbol ? " active" : "");
        btn.dataset.symbol = sym;
        btn.innerHTML = `${sym}<span class="trade-tab-close" data-close="${sym}" aria-label="Close">×</span>`;
        btn.addEventListener("click", (e) => {
          if (e.target.closest("[data-close]")) return;
          selectSymbol(sym);
        });
        btn.querySelector("[data-close]")?.addEventListener("click", (e) => {
          e.stopPropagation();
          closeTab(sym);
        });
        root.appendChild(btn);
      });
    });
  }

  function closeTab(sym) {
    if (openTabs.length <= 1) return;
    openTabs = openTabs.filter((s) => s !== sym);
    saveTabs();
    if (activeSymbol === sym) selectSymbol(openTabs[0]);
    else renderSymbolTabs();
  }

  function openTab(sym) {
    if (!openTabs.includes(sym)) {
      openTabs.push(sym);
      saveTabs();
    }
    renderSymbolTabs();
  }

  function renderWatchlist() {
    const root = document.getElementById("trade-watchlist");
    if (!root) return;
    root.innerHTML = "";
    Object.entries(groups).forEach(([group, items]) => {
      const head = document.createElement("div");
      head.className = "trade-watchlist-group";
      head.textContent = group;
      root.appendChild(head);
      items.forEach((item) => {
        symbolMeta[item.symbol] = item;
        const row = document.createElement("div");
        row.className = "trade-watchlist-row" + (item.symbol === activeSymbol ? " active" : "");
        row.dataset.symbol = item.symbol;
        row.innerHTML = `<div><div class="sym">${item.symbol}</div><div class="name">${item.name}</div></div><div class="px" data-px="${item.symbol}">—</div>`;
        row.addEventListener("click", () => {
          openTab(item.symbol);
          selectSymbol(item.symbol);
        });
        root.appendChild(row);
      });
    });
  }

  function updateWatchlistPrice(tick) {
    const sym = tick.symbol;
    const el = document.querySelector(`[data-px="${sym}"]`);
    if (!el) return;

    const prev = lastPrices[sym];
    const next = tick.bid;
    el.textContent = fmtPrice(sym, next);
    if (prev != null) {
      el.classList.remove("up", "down");
      if (next > prev) el.classList.add("up");
      if (next < prev) el.classList.add("down");
    }
    lastPrices[sym] = next;
    refreshMt5QuotePrices();

    if (sym === activeSymbol) updateTicket(tick);
  }

  function updateChartBadge(symbol) {
    syncCleanTitle(symbol);
    const badge = document.getElementById("trade-chart-badge");
    if (!badge || !barBuffer.length) return;
    const src =
      chartSource === "mt5" ? "MT5" : chartSource === "synthetic" ? "Simulated" : "Live";
    badge.textContent = `${src} | ${symbol} · ${tfLabel(activeTimeframe)} · ${barBuffer.length} bars`;
  }

  function syncCleanTitle(symbol) {
    const title = document.getElementById("trade-clean-title");
    if (!title || !document.body.classList.contains("trade-clean-mode")) return;
    const sym = symbol || activeSymbol || "—";
    const bars = barBuffer.length ? `${barBuffer.length} bars` : "loading";
    title.textContent = `${sym} · ${tfLabel(activeTimeframe)} · ${bars}`;
  }

  function updatePositionsBtn() {
    const btn = document.getElementById("trade-positions-btn");
    if (!btn) return;
    const open = tradeSnapshot.open?.length || 0;
    const pending = tradeSnapshot.pending?.length || 0;
    const total = open + pending;
    btn.textContent = total ? `Positions (${total})` : "Positions";
  }

  function togglePositionsSheet(open) {
    const panel = document.getElementById("trade-bottom");
    if (!panel) return;
    const next = open ?? !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", next);
  }

  let cleanWidgetBound = false;

  function bindCleanTradeWidget() {
    if (cleanWidgetBound) return;
    cleanWidgetBound = true;

    const ticket = document.getElementById("trade-ticket");
    const header = document.getElementById("afx-trade-header");
    const body = document.getElementById("afx-trade-body");
    const collapse = document.getElementById("afx-trade-collapse");

    collapse?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!ticket || !body) return;
      const expanded = body.hidden;
      body.hidden = !expanded;
      ticket.classList.toggle("afx-trade-widget--collapsed", !expanded);
      collapse.textContent = expanded ? "−" : "+";
      collapse.setAttribute("aria-expanded", expanded ? "true" : "false");
      collapse.title = expanded ? "Collapse panel" : "Expand panel";
      resizeChartSoon();
    });

    document.getElementById("trade-positions-btn")?.addEventListener("click", () => {
      togglePositionsSheet();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") togglePositionsSheet(false);
    });

    if (!header || !ticket) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches?.[0] || e;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      const parent = ticket.offsetParent?.getBoundingClientRect();
      if (!parent) return;
      const maxLeft = Math.max(0, parent.width - ticket.offsetWidth);
      const maxTop = Math.max(0, parent.height - ticket.offsetHeight);
      const left = Math.min(maxLeft, Math.max(0, originLeft + dx));
      const top = Math.min(maxTop, Math.max(0, originTop + dy));
      ticket.style.left = `${left}px`;
      ticket.style.top = `${top}px`;
      ticket.style.right = "auto";
      ticket.style.bottom = "auto";
    };

    const onUp = () => {
      dragging = false;
      header.style.cursor = "grab";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };

    header.addEventListener("mousedown", (e) => {
      if (!document.body.classList.contains("trade-clean-mode")) return;
      if (e.target.closest("button, select, input")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originLeft = ticket.offsetLeft;
      originTop = ticket.offsetTop;
      header.style.cursor = "grabbing";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    header.addEventListener("touchstart", (e) => {
      if (!document.body.classList.contains("trade-clean-mode")) return;
      if (e.target.closest("button, select, input")) return;
      const pt = e.touches[0];
      dragging = true;
      startX = pt.clientX;
      startY = pt.clientY;
      originLeft = ticket.offsetLeft;
      originTop = ticket.offsetTop;
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
    }, { passive: true });
  }

  function mountCleanTicket() {
    const main = document.getElementById("trade-main");
    const chartBody = document.querySelector(".trade-chart-body");
    const ticket = document.getElementById("trade-ticket");
    if (!main || !chartBody || !ticket) return;

    const mobile = window.matchMedia("(max-width: 960px)").matches;
    if (mobile) {
      if (ticket.parentElement !== main) main.appendChild(ticket);
      ticket.classList.remove("afx-trade-widget", "afx-trade-widget--collapsed");
      ticket.style.left = "";
      ticket.style.top = "";
      return;
    }

    if (ticket.parentElement !== chartBody) chartBody.appendChild(ticket);
    ticket.classList.add("afx-trade-widget", "afx-trade-widget--collapsed");
  }

  function updateTicket(tick) {
    const sell = document.getElementById("trade-sell-px");
    const buy = document.getElementById("trade-buy-px");
    const mt5Sell = document.getElementById("mt5-sell-px");
    const mt5Buy = document.getElementById("mt5-buy-px");
    const bid = fmtPrice(tick.symbol, tick.bid);
    const ask = fmtPrice(tick.symbol, tick.ask);
    if (sell) sell.textContent = bid;
    if (buy) buy.textContent = ask;
    if (mt5Sell) {
      const prev = mt5Sell.textContent;
      mt5Sell.textContent = bid;
      flashMt5Price(mt5Sell, prev, bid);
    }
    if (mt5Buy) {
      const prev = mt5Buy.textContent;
      mt5Buy.textContent = ask;
      flashMt5Price(mt5Buy, prev, ask);
    }
    if (tick.symbol === activeSymbol) updateChartBadge(tick.symbol);
  }

  function flashMt5Price(el, prev, next) {
    if (!el || prev === "—" || prev === next) return;
    const up = Number(next) > Number(prev);
    el.classList.remove("flash-up", "flash-down");
    el.classList.add(up ? "flash-up" : "flash-down");
    setTimeout(() => el.classList.remove("flash-up", "flash-down"), 280);
  }

  function mapAccountMetrics(account, live = null) {
    if (!account) return;
    accountData = account;
    const m = live || tradeSnapshot.metrics || {};
    const eq = document.getElementById("trade-equity");
    const bal = document.getElementById("trade-balance");
    const fm = document.getElementById("trade-free-margin");
    const mu = document.getElementById("trade-margin-used");
    const up = document.getElementById("trade-unrealised");
    const topBal = document.getElementById("trade-account-balance");

    const balance = m.balance ?? account.balance;
    const openPnl = m.open_pnl ?? account.open_pnl;
    const equity = m.equity ?? balance + openPnl;
    const marginUsed = m.margin_used ?? 0;
    const freeMargin = m.free_margin ?? equity - marginUsed;

    if (eq) eq.textContent = money(equity);
    if (bal) bal.textContent = money(balance);
    if (fm) fm.textContent = money(freeMargin);
    if (mu) mu.textContent = money(marginUsed);
    if (up) {
      up.textContent = (openPnl >= 0 ? "+" : "") + money(openPnl);
      up.classList.toggle("positive", openPnl > 0);
      up.classList.toggle("negative", openPnl < 0);
    }
    if (topBal) topBal.textContent = `${money(equity)} USD · ${account.phase_label}`;
  }

  let liveMetricsRaf = null;

  function positionSymbols() {
    const syms = [
      ...(tradeSnapshot.open || []).map((p) => p.symbol),
      ...(tradeSnapshot.pending || []).map((p) => p.symbol),
    ];
    return [...new Set(syms.filter(Boolean))];
  }

  function syncPositionQuoteSubscriptions() {
    const syms = positionSymbols();
    if (syms.length && window.AlphaFXQuotes?.subscribe) {
      window.AlphaFXQuotes.subscribe(syms);
    }
  }

  function computeLiveMetrics() {
    const open = tradeSnapshot.open || [];
    const base = tradeSnapshot.metrics || {};
    const balance = base.balance ?? accountData?.balance ?? 0;
    const marginUsed = base.margin_used ?? 0;
    if (!open.length) {
      return {
        balance,
        open_pnl: base.open_pnl ?? accountData?.open_pnl ?? 0,
        equity: base.equity ?? accountData?.equity ?? balance,
        margin_used: marginUsed,
        free_margin: (base.equity ?? balance) - marginUsed,
      };
    }

    let openPnl = 0;
    const pnlById = {};
    for (const pos of open) {
      const tick = window.AlphaFXQuotes?.getLast(pos.symbol);
      const pnl = tick
        ? window.AlphaFXSimPnl.positionPnl(
            { symbol: pos.symbol, side: pos.side, volume: pos.volume, entry: pos.entry },
            tick,
            symbolMeta[pos.symbol]
          )
        : Number(pos.pnl || 0);
      pnlById[pos.id] = pnl;
      openPnl += pnl;
      pos.pnl = pnl;
    }

    openPnl = Math.round(openPnl * 100) / 100;
    const equity = Math.round((balance + openPnl) * 100) / 100;
    return {
      balance,
      open_pnl: openPnl,
      equity,
      margin_used: marginUsed,
      free_margin: Math.round((equity - marginUsed) * 100) / 100,
      pnlById,
    };
  }

  function detectStopHit(pos, tick) {
    const sl = pos.sl != null && pos.sl !== "" ? Number(pos.sl) : null;
    const tp = pos.tp != null && pos.tp !== "" ? Number(pos.tp) : null;
    if (sl == null && tp == null) return null;
    const side = String(pos.side || "").toUpperCase();
    const bid = Number(tick.bid);
    const ask = Number(tick.ask);
    if (side === "BUY") {
      if (sl != null && bid <= sl) return "sl";
      if (tp != null && bid >= tp) return "tp";
    } else {
      if (sl != null && ask >= sl) return "sl";
      if (tp != null && ask <= tp) return "tp";
    }
    return null;
  }

  async function autoCloseOnStopHit(tradeId, reason, symbol) {
    if (!accountId || closingTradeIds.has(tradeId)) return;
    const pos = tradeSnapshot.open.find((p) => p.id === tradeId);
    const exitOverride =
      reason === "sl" && pos?.sl != null
        ? Number(pos.sl)
        : reason === "tp" && pos?.tp != null
          ? Number(pos.tp)
          : null;
    noteCloseAnchor(tradeId, pos, exitOverride);
    closingTradeIds.add(tradeId);
    orderBusy = true;
    setTradingControls(tradingEnabled);
    try {
      const res = await window.AlphaFXApi.request(`/api/v1/trade/positions/${tradeId}/close`, {
        method: "POST",
        body: JSON.stringify({ account_id: accountId, reason }),
      });
      playStopHitSound(tradeId, reason);
      const label = reason === "tp" ? "Take profit" : "Stop loss";
      toast(`${symbol} · ${label} hit · ${res.message || "Position closed"}`, "success");
      await loadTradeSnapshot();
    } catch (e) {
      toast(e?.message || "Stop close failed", "error");
    } finally {
      closingTradeIds.delete(tradeId);
      orderBusy = false;
      setTradingControls(tradingEnabled);
    }
  }

  function checkStopHits(tick) {
    if (!tick || !accountId || orderBusy) return;
    for (const pos of tradeSnapshot.open || []) {
      if (pos.symbol !== tick.symbol || closingTradeIds.has(pos.id)) continue;
      const hit = detectStopHit(pos, tick);
      if (hit) autoCloseOnStopHit(pos.id, hit, pos.symbol);
    }
  }

  const seenPendingFillIds = new Set();
  const seenStopHitKeys = new Set();

  function playStopHitSound(tradeId, reason) {
    const hitReason = String(reason || "").toLowerCase();
    if (hitReason !== "sl" && hitReason !== "tp") return;
    const key = tradeId != null ? `${tradeId}:${hitReason}` : null;
    if (key && seenStopHitKeys.has(key)) return;
    if (key) seenStopHitKeys.add(key);
    if (hitReason === "tp") window.playTpHitSound?.();
    else window.playSlHitSound?.();
  }

  function notifyPendingFills(fills) {
    if (!fills?.length) return;
    let playedOrderSound = false;
    for (const f of fills) {
      const fillId = f.id;
      if (fillId != null && seenPendingFillIds.has(fillId)) continue;
      if (fillId != null) seenPendingFillIds.add(fillId);
      toast(`${f.symbol} · ${String(f.order_type || "order").toUpperCase()} ${f.side} filled @ ${f.price}`, "success");
      if (!playedOrderSound) {
        window.playOrderFilledSound?.();
        playedOrderSound = true;
      }
    }
  }

  function detectPendingFill(p, tick) {
    const ot = String(p.order_type || "LIMIT").toLowerCase();
    const price = Number(p.price);
    const side = String(p.side || "").toUpperCase();
    const bid = Number(tick.bid);
    const ask = Number(tick.ask);
    if (ot === "limit") {
      if (side === "BUY") return ask <= price;
      return bid >= price;
    }
    if (ot === "stop") {
      if (side === "BUY") return ask >= price;
      return bid <= price;
    }
    return false;
  }

  function schedulePendingReload() {
    if (pendingReloadTimer) return;
    pendingReloadTimer = setTimeout(async () => {
      pendingReloadTimer = null;
      await loadTradeSnapshot();
    }, 400);
  }

  function checkPendingFills(tick) {
    if (!tick || !accountId || orderBusy) return;
    for (const p of tradeSnapshot.pending || []) {
      if (p.symbol !== tick.symbol) continue;
      if (detectPendingFill(p, tick)) {
        schedulePendingReload();
        break;
      }
    }
  }

  function notifyStopHits(hits) {
    if (!hits?.length) return;
    for (const h of hits) {
      playStopHitSound(h.id, h.reason);
      const label = h.reason === "tp" ? "Take profit" : "Stop loss";
      toast(`${h.symbol} · ${label} hit @ ${h.exit} · P/L ${money(h.pnl)}`, "success");
    }
  }

  function refreshLiveMetrics() {
    if (!accountData || !(tradeSnapshot.open || []).length) return;
    if (liveMetricsRaf) return;
    liveMetricsRaf = requestAnimationFrame(() => {
      liveMetricsRaf = null;
      const live = computeLiveMetrics();
      mapAccountMetrics(accountData, live);
      if (live.pnlById) {
        for (const [id, pnl] of Object.entries(live.pnlById)) {
          const cell = document.querySelector(`[data-trade-pnl="${id}"]`);
          if (!cell) continue;
          cell.textContent = (pnl >= 0 ? "+" : "") + money(pnl);
          cell.classList.toggle("positive", pnl > 0);
          cell.classList.toggle("negative", pnl < 0);
        }
      }
      window.AlphaFXChartPositions?.updateLivePnl?.();
    });
  }

  function setTradingControls(enabled) {
    tradingEnabled = Boolean(enabled);
    const ids = [
      "trade-volume",
      "trade-sl",
      "trade-tp",
      "trade-price",
      "trade-buy-btn",
      "trade-sell-btn",
      "mt5-lot-input",
      "mt5-buy-btn",
      "mt5-sell-btn",
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !tradingEnabled || orderBusy;
    });
    document.querySelectorAll("#trade-order-type-tabs button").forEach((btn) => {
      btn.disabled = !tradingEnabled || orderBusy;
    });
  }

  function updateOrderTicketUI() {
    const priceField = document.getElementById("trade-price-field");
    const priceInput = document.getElementById("trade-price");
    const isPending = orderType === "limit" || orderType === "stop";
    if (priceField) priceField.hidden = !isPending;
    if (priceInput) priceInput.required = isPending;

    document.querySelectorAll("#trade-order-type-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === orderType);
    });

    const buyBtn = document.getElementById("trade-buy-btn");
    const sellBtn = document.getElementById("trade-sell-btn");
    if (orderType === "market") {
      if (buyBtn) buyBtn.innerHTML = `BUY<br><span class="sub" id="trade-buy-px">—</span>`;
      if (sellBtn) sellBtn.innerHTML = `SELL<br><span class="sub" id="trade-sell-px">—</span>`;
      const tick = window.AlphaFXQuotes?.getLast(activeSymbol);
      if (tick) updateTicket(tick);
    } else {
      const label = orderType === "limit" ? "Place limit" : "Place stop";
      if (buyBtn) buyBtn.textContent = `${label} BUY`;
      if (sellBtn) sellBtn.textContent = `${label} SELL`;
    }
  }

  function bindOrderTypeTabs() {
    document.querySelectorAll("#trade-order-type-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!tradingEnabled || orderBusy) return;
        const t = btn.dataset.type;
        if (!t || t === orderType) return;
        orderType = t;
        updateOrderTicketUI();
      });
    });
  }

  function parseOptionalPrice(raw) {
    const v = String(raw ?? "").trim();
    if (!v || v === "—") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const DRAFT_ORDER_OFFSET = 2;

  function defaultDraftOrderPrice(side, kind) {
    const tick = window.AlphaFXQuotes?.getLast(activeSymbol);
    if (!tick) return null;
    const mid = (Number(tick.bid) + Number(tick.ask)) / 2;
    if (!Number.isFinite(mid)) return null;
    const s = String(side).toLowerCase();
    const k = String(kind).toLowerCase();
    let raw = mid;
    if (k === "limit") raw = s === "buy" ? mid - DRAFT_ORDER_OFFSET : mid + DRAFT_ORDER_OFFSET;
    else if (k === "stop") raw = s === "buy" ? mid + DRAFT_ORDER_OFFSET : mid - DRAFT_ORDER_OFFSET;
    return Number(fmtPrice(activeSymbol, raw));
  }

  async function submitOrder(side) {
    if (!tradingEnabled || orderBusy || !accountId) return;
    const volume = Number(document.getElementById("trade-volume")?.value || 0);
    if (!volume || volume < 0.01) {
      toast("Enter a valid volume (min 0.01 lots).", "error");
      return;
    }

    const isClean = document.body.classList.contains("trade-clean-mode");

    if (isClean && orderType !== "market") {
      let price = parseOptionalPrice(document.getElementById("trade-price")?.value);
      if (price == null) {
        price = defaultDraftOrderPrice(side, orderType);
        if (price == null) {
          toast("Waiting for market price…", "error");
          return;
        }
        const priceInput = document.getElementById("trade-price");
        if (priceInput) priceInput.value = fmtPrice(activeSymbol, price);
      }
      window.AlphaFXPositionOverlay?.clearDrafts?.();
      window.AlphaFXPositionOverlay?.openDraft({
        side,
        volume,
        orderKind: orderType,
        price,
      });
      const body = document.getElementById("afx-trade-body");
      const ticket = document.getElementById("trade-ticket");
      if (body && ticket && !body.hidden) {
        body.hidden = true;
        ticket.classList.add("afx-trade-widget--collapsed");
        const collapse = document.getElementById("afx-trade-collapse");
        if (collapse) {
          collapse.textContent = "+";
          collapse.setAttribute("aria-expanded", "false");
        }
      }
      return;
    }

    const price = parseOptionalPrice(document.getElementById("trade-price")?.value);
    if ((orderType === "limit" || orderType === "stop") && price == null) {
      toast("Enter an order price for limit/stop orders.", "error");
      return;
    }
    orderBusy = true;
    setTradingControls(tradingEnabled);
    try {
      const body = {
        account_id: accountId,
        symbol: activeSymbol,
        side,
        volume,
        order_type: orderType,
        price,
      };
      if (!isClean) {
        body.stop_loss = parseOptionalPrice(document.getElementById("trade-sl")?.value);
        body.take_profit = parseOptionalPrice(document.getElementById("trade-tp")?.value);
      }
      const res = await window.AlphaFXApi.request("/api/v1/trade/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const fillSec = Math.floor(Date.now() / 1000);
      const barTime =
        window.AlphaFXPositionOverlay?.barTimeForSec?.(fillSec) ??
        (barBuffer.length > 0
          ? barBuffer[barBuffer.length - 1].time
          : barBucket(fillSec * 1000, activeTimeframe));
      if (res.trade_id != null) {
        rememberSessionFillTime(res.trade_id, fillSec);
        window.AlphaFXPositionOverlay?.setFillAnchor?.(res.trade_id, {
          unixSec: fillSec,
          barTime,
        });
      }
      toast(res.message || (orderType === "market" ? "Order filled" : "Order placed"), "success");
      if (orderType === "market") window.playOrderFilledSound?.();
      await loadTradeSnapshot();
    } catch (e) {
      toast(e?.message || "Order failed", "error");
    } finally {
      orderBusy = false;
      setTradingControls(tradingEnabled);
    }
  }

  async function cancelPendingOrder(tradeId) {
    if (!accountId || orderBusy) return;
    orderBusy = true;
    setTradingControls(tradingEnabled);
    try {
      await window.AlphaFXApi.request(`/api/v1/trade/orders/pending/${tradeId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ account_id: accountId }),
      });
      toast("Pending order cancelled", "info");
      await loadTradeSnapshot();
    } catch (e) {
      toast(e?.message || "Cancel failed", "error");
    } finally {
      orderBusy = false;
      setTradingControls(tradingEnabled);
    }
  }

  function noteCloseAnchor(tradeId, pos, exitOverride) {
    if (tradeId == null || !pos) return;
    const side = String(pos.side).toLowerCase();
    let exit = exitOverride != null ? Number(exitOverride) : null;
    if (exit == null || !Number.isFinite(exit)) {
      const tick = window.AlphaFXQuotes?.getLast?.(pos.symbol);
      if (tick) exit = side === "buy" ? Number(tick.bid) : Number(tick.ask);
    }
    if (exit == null || !Number.isFinite(exit)) return;
    const fillSec = Math.floor(Date.now() / 1000);
    const barTime =
      window.AlphaFXPositionOverlay?.barTimeForSec?.(fillSec) ??
      (barBuffer.length > 0
        ? barBuffer[barBuffer.length - 1].time
        : barBucket(fillSec * 1000, activeTimeframe));
    window.AlphaFXPositionOverlay?.setCloseAnchor?.(tradeId, {
      side: pos.side,
      exit,
      unixSec: fillSec,
      barTime,
      symbol: pos.symbol,
    });
  }

  async function closePosition(tradeId) {
    if (!accountId || orderBusy) return;
    const pos = tradeSnapshot.open.find((p) => p.id === tradeId);
    noteCloseAnchor(tradeId, pos);
    orderBusy = true;
    setTradingControls(tradingEnabled);
    try {
      await window.AlphaFXApi.request(`/api/v1/trade/positions/${tradeId}/close`, {
        method: "POST",
        body: JSON.stringify({ account_id: accountId }),
      });
      toast("Position closed", "success");
      await loadTradeSnapshot();
    } catch (e) {
      toast(e?.message || "Close failed", "error");
    } finally {
      orderBusy = false;
      setTradingControls(tradingEnabled);
    }
  }

  function bindTradeActions() {
    document.getElementById("trade-buy-btn")?.addEventListener("click", () => submitOrder("buy"));
    document.getElementById("trade-sell-btn")?.addEventListener("click", () => submitOrder("sell"));
    document.getElementById("mt5-buy-btn")?.addEventListener("click", () => submitOrder("buy"));
    document.getElementById("mt5-sell-btn")?.addEventListener("click", () => submitOrder("sell"));
    document.getElementById("trade-bottom-body")?.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-close-trade]");
      if (closeBtn) {
        closePosition(Number(closeBtn.dataset.closeTrade));
        return;
      }
      const cancelBtn = e.target.closest("[data-cancel-pending]");
      if (cancelBtn) cancelPendingOrder(Number(cancelBtn.dataset.cancelPending));
    });
  }

  function renderAccountSelect(accounts, selectedId) {
    const sel = document.getElementById("trade-account-select");
    if (!sel) return;
    if (!accounts.length) {
      sel.innerHTML = `<option value="">No challenge account</option>`;
      sel.disabled = true;
      return;
    }
    sel.disabled = accounts.length <= 1;
    sel.innerHTML = accounts
      .map((a) => `<option value="${a.id}"${a.id === selectedId ? " selected" : ""}>${a.label}</option>`)
      .join("");
    sel.onchange = () => {
      accountId = Number(sel.value) || null;
      saveAccountPref();
      loadTradeSnapshot();
    };
  }

  async function loadTradeSnapshot() {
    const q = accountId ? `?account_id=${accountId}` : "";
    try {
      tradeSnapshot = await window.AlphaFXApi.request(`/api/v1/trade/snapshot${q}`);
      if (tradeSnapshot.account) {
        accountId = tradeSnapshot.account.id;
        saveAccountPref();
        mapAccountMetrics(tradeSnapshot.account);
      }
      notifyStopHits(tradeSnapshot.stop_hits);
      notifyPendingFills(tradeSnapshot.pending_fills);
      setTradingControls(tradeSnapshot.trading_enabled && tradeSnapshot.account);
      renderAccountSelect(tradeSnapshot.accounts || [], accountId);
      syncPositionQuoteSubscriptions();
      refreshLiveMetrics();
      syncChartPositions();
      window.AlphaFXPositionOverlay?.sync?.();
      updateBottomCounts();
      renderBottomPanel();
      updatePositionsBtn();
    } catch (e) {
      console.error(e);
    }
  }

  function updateBottomCounts() {
    const c = tradeSnapshot.counts || { open: 0, pending: 0, closed: 0 };
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n);
    };
    set("trade-count-open", c.open ?? tradeSnapshot.open?.length ?? 0);
    set("trade-count-pending", c.pending ?? tradeSnapshot.pending?.length ?? 0);
    set("trade-count-closed", c.closed ?? tradeSnapshot.closed?.length ?? 0);
  }

  function renderBottomPanel() {
    const body = document.getElementById("trade-bottom-body");
    if (!body) return;

    const items =
      bottomPanel === "open"
        ? tradeSnapshot.open
        : bottomPanel === "pending"
          ? tradeSnapshot.pending
          : tradeSnapshot.closed;

    if (!items?.length) {
      const msgs = {
        open: "No open positions. Place a simulated market order from the ticket.",
        pending: "No pending limit or stop orders.",
        closed: "No closed trades yet.",
      };
      body.innerHTML = `<div class="trade-empty">${msgs[bottomPanel]}</div>`;
      syncMt5HistorySheet();
      return;
    }

    if (bottomPanel === "pending") {
      body.innerHTML = `<div class="trade-table-wrap"><table class="trade-table">
        <thead><tr>
          <th>Order ID</th><th>Created</th><th>Symbol</th><th>Side</th><th>Type</th>
          <th>Volume</th><th>Price</th><th>SL</th><th>TP</th><th></th>
        </tr></thead>
        <tbody>${items
          .map((r) => {
            const fmt = (v) => (v == null || v === "" ? "—" : v);
            return `<tr>
          <td>${r.id ?? "—"}</td>
          <td>${fmtTradeTime(r, "created")}</td>
          <td>${r.symbol ?? "—"}</td>
          <td class="${(r.side || "").toLowerCase()}">${r.side ?? "—"}</td>
          <td>${String(r.order_type || "LIMIT").toUpperCase()}</td>
          <td>${r.volume ?? "—"}</td>
          <td>${r.price ?? "—"}</td>
          <td>${fmt(r.sl)}</td>
          <td>${fmt(r.tp)}</td>
          <td><button type="button" class="trade-cancel-btn" data-cancel-pending="${r.id}">Cancel</button></td>
        </tr>`;
          })
          .join("")}</tbody></table></div>`;
      syncMt5HistorySheet();
      return;
    }

    const actionCol = bottomPanel === "open" ? "<th></th>" : "";
    body.innerHTML = `<div class="trade-table-wrap"><table class="trade-table">
      <thead><tr>
        <th>Order ID</th><th>Opened</th><th>Closed</th><th>Symbol</th><th>Side</th>
        <th>Volume</th><th>Entry</th><th>Exit</th><th>P/L</th><th>Reason</th>${actionCol}
      </tr></thead>
      <tbody>${items
        .map((r) => {
          const pnl = r.pnl == null ? "—" : (Number(r.pnl) >= 0 ? "+" : "") + money(r.pnl);
          const closeBtn =
            bottomPanel === "open"
              ? `<td><button type="button" class="trade-close-btn" data-close-trade="${r.id}">Close</button></td>`
              : "";
          return `<tr>
        <td>${r.id ?? "—"}</td>
        <td>${fmtTradeTime(r, "opened")}</td>
        <td>${fmtTradeTime(r, "closed")}</td>
        <td>${r.symbol ?? "—"}</td>
        <td class="${(r.side || "").toLowerCase()}">${r.side ?? "—"}</td>
        <td>${r.volume ?? "—"}</td>
        <td>${r.entry ?? "—"}</td>
        <td>${r.exit ?? "—"}</td>
        <td class="${Number(r.pnl) >= 0 ? "positive" : "negative"}"${bottomPanel === "open" ? ` data-trade-pnl="${r.id}"` : ""}>${pnl}</td>
        <td>${r.reason ?? "—"}</td>${closeBtn}
      </tr>`;
        })
        .join("")}</tbody></table></div>`;

    syncMt5HistorySheet();
  }

  function syncMt5HistorySheet() {
    if (!isMobileMt5() || mt5SheetTab !== "history") return;
    const histBody = document.getElementById("mt5-history-body");
    const desktopBody = document.getElementById("trade-bottom-body");
    if (histBody && desktopBody) histBody.innerHTML = desktopBody.innerHTML;
    const c = tradeSnapshot.counts || {
      open: tradeSnapshot.open?.length ?? 0,
      pending: tradeSnapshot.pending?.length ?? 0,
      closed: tradeSnapshot.closed?.length ?? 0,
    };
    document.querySelectorAll("#mt5-history-tabs button").forEach((btn) => {
      const panel = btn.dataset.panel;
      const countEl = btn.querySelector(".trade-tab-count");
      if (countEl && panel) countEl.textContent = String(c[panel] ?? 0);
      btn.classList.toggle("active", panel === bottomPanel);
    });
  }

  function refreshMt5QuotePrices() {
    if (!isMobileMt5() || mt5SheetTab !== "quotes") return;
    document.querySelectorAll("[data-mt5-symbol]").forEach((row) => {
      const sym = row.dataset.mt5Symbol;
      const px = lastPrices[sym];
      const pxEl = row.querySelector(".px");
      if (pxEl && px != null) pxEl.textContent = fmtPrice(sym, px);
    });
  }

  function bindBottomTabs() {
    document.querySelectorAll("#trade-bottom-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        bottomPanel = btn.dataset.panel || "open";
        document.querySelectorAll("#trade-bottom-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
        renderBottomPanel();
      });
    });
  }

  function resizeChartSoon() {
    const container = document.getElementById("trade-chart");
    if (!container) return;
    requestAnimationFrame(() => applyChartSize(container));
  }

  function applyMobileTradeLayout() {
    const main = document.getElementById("trade-main");
    if (!main) return;
    const mobile = window.matchMedia("(max-width: 960px)").matches;
    main.classList.toggle("trade-mobile", mobile);
    document.body.classList.toggle("trade-mt5-mode", mobile);
    document.body.classList.toggle("trade-clean-mode", !mobile);
    const mt5 = document.getElementById("mt5-mobile");
    if (mt5) mt5.hidden = !mobile;
    mountCleanTicket();
    if (mobile) {
      main.classList.add("watchlist-collapsed");
      syncMt5Chrome();
      togglePositionsSheet(false);
    } else {
      closeMt5Sheet();
      syncCleanTitle(activeSymbol);
      window.AlphaFXChartPositions?.deselectPosition?.();
    }
    window.AlphaFXChartPositions?.sync?.();
    window.AlphaFXChartPositions?.modeChange?.();
    resizeChartSoon();
  }

  let mt5SheetTab = null;
  let mt5Bound = false;

  function isMobileMt5() {
    return document.body.classList.contains("trade-mt5-mode");
  }

  function syncMt5Chrome() {
    const sym = document.getElementById("mt5-symbol-name");
    const tf = document.getElementById("mt5-tf-btn");
    const lot = document.getElementById("mt5-lot-input");
    const vol = document.getElementById("trade-volume");
    if (sym) sym.textContent = activeSymbol || "—";
    if (tf) tf.textContent = tfLabel(activeTimeframe);
    if (lot && vol && lot !== document.activeElement) lot.value = vol.value;
  }

  function syncVolumeFromMt5() {
    const lot = document.getElementById("mt5-lot-input");
    const vol = document.getElementById("trade-volume");
    if (lot && vol) vol.value = lot.value;
  }

  function stepMt5Lot(delta) {
    const lot = document.getElementById("mt5-lot-input");
    const vol = document.getElementById("trade-volume");
    const el = lot || vol;
    if (!el) return;
    const next = Math.max(0.01, Math.round((Number(el.value || 0.01) + delta) * 100) / 100);
    el.value = String(next);
    if (lot && vol) vol.value = lot.value;
  }

  function renderMt5Quotes() {
    const body = document.getElementById("mt5-sheet-body");
    if (!body) return;
    const items = Object.values(groups || {}).flat();
    if (!items.length) {
      body.innerHTML = `<p style="padding:16px;color:var(--text-mute);">Loading symbols…</p>`;
      return;
    }
    body.innerHTML = items
      .map((item) => {
        const px = lastPrices[item.symbol];
        const pxText = px != null ? fmtPrice(item.symbol, px) : "—";
        return `<button type="button" class="mt5-quote-row${item.symbol === activeSymbol ? " is-active" : ""}" data-mt5-symbol="${item.symbol}">
          <div><div class="sym">${item.symbol}</div><div class="name">${item.name || ""}</div></div>
          <div class="px">${pxText}</div>
        </button>`;
      })
      .join("");
  }

  function renderMt5TradeSheet() {
    const body = document.getElementById("mt5-sheet-body");
    const ticket = document.querySelector(".trade-ticket");
    if (!body || !ticket) return;
    body.innerHTML = `<div class="mt5-trade-form" id="mt5-trade-form-mount"></div>`;
    const mount = document.getElementById("mt5-trade-form-mount");
    if (!mount) return;
    const tabs = document.getElementById("trade-order-type-tabs");
    if (tabs) mount.appendChild(tabs);
    ["trade-price-field", "trade-sl", "trade-tp"].forEach((id) => {
      const el = document.getElementById(id);
      const field = el?.closest(".trade-field");
      if (field) mount.appendChild(field);
    });
    const metrics = document.getElementById("trade-metrics");
    if (metrics) mount.appendChild(metrics);
    updateOrderTicketUI();
  }

  function restoreMt5TradeSheet() {
    const ticket = document.querySelector(".trade-ticket");
    const mount = document.getElementById("mt5-trade-form-mount");
    if (!ticket || !mount) return;
    while (mount.firstChild) ticket.appendChild(mount.firstChild);
    updateOrderTicketUI();
  }

  function renderMt5HistorySheet() {
    const body = document.getElementById("mt5-sheet-body");
    if (!body) return;
    body.innerHTML = `
      <div class="trade-bottom-tabs" id="mt5-history-tabs">
        <button type="button" class="${bottomPanel === "open" ? "active" : ""}" data-panel="open">Open <span class="trade-tab-count">${tradeSnapshot.counts?.open ?? 0}</span></button>
        <button type="button" class="${bottomPanel === "pending" ? "active" : ""}" data-panel="pending">Pending <span class="trade-tab-count">${tradeSnapshot.counts?.pending ?? 0}</span></button>
        <button type="button" class="${bottomPanel === "closed" ? "active" : ""}" data-panel="closed">Closed <span class="trade-tab-count">${tradeSnapshot.counts?.closed ?? 0}</span></button>
      </div>
      <div id="mt5-history-body"></div>`;
    const histBody = document.getElementById("mt5-history-body");
    const desktopBody = document.getElementById("trade-bottom-body");
    if (histBody && desktopBody) {
      histBody.innerHTML = desktopBody.innerHTML;
    }
    document.getElementById("mt5-history-tabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-panel]");
      if (!btn) return;
      bottomPanel = btn.dataset.panel || "open";
      renderBottomPanel();
      renderMt5HistorySheet();
    });
    histBody?.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-close-trade]");
      if (closeBtn) closePosition(Number(closeBtn.dataset.closeTrade));
      const cancelBtn = e.target.closest("[data-cancel-pending]");
      if (cancelBtn) cancelPendingOrder(Number(cancelBtn.dataset.cancelPending));
    });
  }

  function renderMt5MenuSheet() {
    const body = document.getElementById("mt5-sheet-body");
    if (!body) return;
    const bal = document.getElementById("trade-account-balance")?.textContent || "—";
    body.innerHTML = `
      <div style="padding:8px 12px 12px;font-size:12px;color:var(--text-mute);">${bal}</div>
      <a class="mt5-menu-link" href="dashboard.html">Dashboard</a>
      <a class="mt5-menu-link" href="accounts.html">My Accounts</a>
      <a class="mt5-menu-link" href="notifications.html">Notifications</a>
      <a class="mt5-menu-link" href="support.html">Support</a>
      <button type="button" class="mt5-menu-link" id="mt5-sign-out" style="width:100%;border:none;background:transparent;cursor:pointer;text-align:left;">Sign out</button>`;
    document.getElementById("mt5-sign-out")?.addEventListener("click", () => {
      window.AlphaFXAuth?.logout?.().finally(() => {
        window.location.href = "login.html";
      });
    });
  }

  function renderMt5TfSheet() {
    const body = document.getElementById("mt5-sheet-body");
    if (!body) return;
    body.innerHTML = `<div class="mt5-tf-grid">${TIMEFRAMES.map(
      (t) =>
        `<button type="button" class="${t.id === activeTimeframe ? "is-active" : ""}" data-mt5-tf="${t.id}">${t.label}</button>`
    ).join("")}</div>`;
    body.querySelectorAll("[data-mt5-tf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tf = btn.dataset.mt5Tf;
        if (!tf || tf === activeTimeframe) {
          closeMt5Sheet();
          return;
        }
        activeTimeframe = tf;
        saveTimeframePref();
        renderTimeframes();
        applyTimeScaleOptions();
        syncMt5Chrome();
        loadChart(activeSymbol);
        closeMt5Sheet();
      });
    });
  }

  function openMt5Sheet(tab) {
    const sheet = document.getElementById("mt5-sheet");
    const title = document.getElementById("mt5-sheet-title");
    if (!sheet) return;
    if (tab === "chart") {
      closeMt5Sheet();
      return;
    }
    mt5SheetTab = tab;
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    document.querySelectorAll(".mt5-dock-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mt5Tab === tab);
    });
    if (tab === "quotes") {
      if (title) title.textContent = "Quotes";
      renderMt5Quotes();
    } else if (tab === "trade") {
      if (title) title.textContent = "Trade";
      renderMt5TradeSheet();
    } else if (tab === "history") {
      if (title) title.textContent = "History";
      renderMt5HistorySheet();
    } else if (tab === "menu") {
      if (title) title.textContent = "Menu";
      renderMt5MenuSheet();
    }
  }

  function closeMt5Sheet() {
    const sheet = document.getElementById("mt5-sheet");
    if (!sheet) return;
    if (mt5SheetTab === "trade") restoreMt5TradeSheet();
    mt5SheetTab = null;
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    document.querySelector(".mt5-dock-btn[data-mt5-tab='chart']")?.classList.add("is-active");
    document.querySelectorAll(".mt5-dock-btn:not([data-mt5-tab='chart'])").forEach((b) => b.classList.remove("is-active"));
  }

  function bindMobileMt5() {
    if (mt5Bound) return;
    mt5Bound = true;

    document.getElementById("mt5-lot-minus")?.addEventListener("click", () => stepMt5Lot(-0.01));
    document.getElementById("mt5-lot-plus")?.addEventListener("click", () => stepMt5Lot(0.01));
    document.getElementById("mt5-lot-input")?.addEventListener("input", syncVolumeFromMt5);

    document.getElementById("mt5-symbol-btn")?.addEventListener("click", () => openMt5Sheet("quotes"));
    document.getElementById("mt5-tf-btn")?.addEventListener("click", () => {
      const sheet = document.getElementById("mt5-sheet");
      const title = document.getElementById("mt5-sheet-title");
      if (sheet) {
        sheet.classList.add("is-open");
        sheet.setAttribute("aria-hidden", "false");
        if (title) title.textContent = "Timeframe";
        renderMt5TfSheet();
      }
    });

    document.querySelectorAll(".mt5-dock-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.mt5Tab;
        if (tab === "chart") closeMt5Sheet();
        else openMt5Sheet(tab);
      });
    });

    document.getElementById("mt5-sheet-close")?.addEventListener("click", closeMt5Sheet);
    document.getElementById("mt5-sheet-backdrop")?.addEventListener("click", closeMt5Sheet);

    document.getElementById("mt5-sheet-body")?.addEventListener("click", (e) => {
      const symBtn = e.target.closest("[data-mt5-symbol]");
      if (!symBtn) return;
      selectSymbol(symBtn.dataset.mt5Symbol);
      closeMt5Sheet();
    });
  }

  function bindWatchlistToggle() {
    const btn = document.getElementById("trade-watchlist-toggle");
    const main = document.getElementById("trade-main");
    if (!btn || !main) return;

    const KEY = "alphafx_trade_watchlist";
    try {
      if (localStorage.getItem(KEY) === "collapsed") {
        main.classList.add("watchlist-collapsed");
        btn.setAttribute("aria-expanded", "false");
        btn.title = "Show watchlist";
      }
    } catch {
      /* ignore */
    }

    btn.addEventListener("click", () => {
      const collapsed = main.classList.toggle("watchlist-collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.title = collapsed ? "Show watchlist" : "Hide watchlist";
      try {
        localStorage.setItem(KEY, collapsed ? "collapsed" : "open");
      } catch {
        /* ignore */
      }
      setTimeout(resizeChartSoon, 280);
    });
  }

  async function selectSymbol(symbol) {
    activeSymbol = symbol;
    saveSymbolPref();
    openTab(symbol);
    renderSymbolTabs();
    syncChartSymbolSelect(symbol);
    document.querySelectorAll(".trade-watchlist-row").forEach((row) => {
      row.classList.toggle("active", row.dataset.symbol === symbol);
    });
    const last = window.AlphaFXQuotes.getLast(symbol);
    if (last) updateTicket(last);
    window.AlphaFXQuotes.subscribe([symbol]);
    await loadChart(symbol);
    syncMt5Chrome();
    syncCleanTitle(symbol);
  }

  async function loadSymbols() {
    const data = await window.AlphaFXApi.request("/api/v1/market/symbols");
    groups = data.groups || {};
    renderWatchlist();
    loadTabs();
    renderSymbolTabs();
    renderChartSymbolSelect();
  }

  function waitForQuote(symbol, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const sym = symbol.toUpperCase();
      const existing = window.AlphaFXQuotes?.getLast(sym);
      if (existing) {
        resolve(existing);
        return;
      }
      let done = false;
      const finish = (tick) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (off) off();
        resolve(tick || null);
      };
      const timer = setTimeout(() => finish(window.AlphaFXQuotes?.getLast(sym)), timeoutMs);
      const off = window.AlphaFXQuotes?.onTick((tick) => {
        if (tick.symbol === sym) finish(tick);
      });
    });
  }

  function anchorFromTick(tick) {
    if (!tick) return null;
    return (tick.bid + tick.ask) / 2;
  }

  async function loadChart(symbol) {
    if (loadChartPromise) return loadChartPromise;
    loadChartPromise = loadChartInner(symbol).finally(() => {
      loadChartPromise = null;
    });
    return loadChartPromise;
  }

  async function loadChartInner(symbol) {
    const container = document.getElementById("trade-chart");
    if (!container || !window.LightweightCharts) return;

    chartLoading = true;
    try {
      ensureChart(container);

      const tick = window.AlphaFXQuotes?.getLast(symbol) || (await waitForQuote(symbol, 8000));
      const anchor = anchorFromTick(tick);
      const badge = document.getElementById("trade-chart-badge");

      if (anchor == null) {
        barBuffer = [];
        series.setData([]);
        if (badge) badge.textContent = `Waiting for live | ${symbol}`;
        return;
      }

      const hist = await window.AlphaFXApi.request(
        `/api/v1/market/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(activeTimeframe)}&limit=300&anchor=${encodeURIComponent(anchor)}`
      );
      const nextBars = (hist.bars || []).map((b) => ({
        time: Math.floor(b.time),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      if (!nextBars.length) return;

      barBuffer = nextBars;
      chartSource = hist.source || "none";
      ensureChart(container);
      series.setData(barBuffer);
      patchFormingBar(tick);
      chart.timeScale().fitContent();
      applyTimeScaleOptions();
      applyChartSize(container);
      updateChartBadge(symbol);
      syncChartPositions();
      window.AlphaFXPositionOverlay?.sync?.();
      applyHistoryVisibility();
    } catch (e) {
      console.error("loadChart failed:", e);
    } finally {
      chartLoading = false;
    }
  }

  async function onTick(tick) {
    updateWatchlistPrice(tick);
    checkStopHits(tick);
    checkPendingFills(tick);
    refreshLiveMetrics();

    if (tick.symbol !== activeSymbol) return;

    const container = document.getElementById("trade-chart");
    if (!container || !series) {
      if (!chartLoading && !loadChartPromise) await loadChart(activeSymbol);
      return;
    }

    if (barBuffer.length === 0) {
      if (!chartLoading && !loadChartPromise) await loadChart(activeSymbol);
      return;
    }

    queueLiveBarUpdate(tick);
  }

  async function init() {
    if (document.body.dataset.page !== "trade" || initialized || !layoutReady) return;
    if (!window.AlphaFXApi?.getToken?.()) return;
    initialized = true;

    bindBottomTabs();
    bindWatchlistToggle();
    bindTradeActions();
    bindMobileMt5();
    bindCleanTradeWidget();
    bindOrderTypeTabs();
    updateOrderTicketUI();
    loadTimeframePref();
    loadSymbolPref();
    loadHistoryPref();
    loadAccountPref();
    renderTimeframes();
    bindTimeframes();
    bindChartControls();
    applyHistoryVisibility();
    document.getElementById("pt-sidebar-toggle")?.addEventListener("click", () => {
      setTimeout(resizeChartSoon, 280);
    });
    if (document.getElementById("trade-main")?.classList.contains("watchlist-collapsed")) {
      setTimeout(resizeChartSoon, 0);
    }
    await loadSymbols();
    await loadTradeSnapshot();

    const allSymbols = Object.values(groups).flat().map((i) => i.symbol);
    window.AlphaFXQuotes.onTick(onTick);
    window.AlphaFXQuotes.connect(allSymbols);
    window.addEventListener("alphafx:quotes:status", (e) => setLiveStatus(e.detail?.live));

    let startSym = activeSymbol;
    if (!allSymbols.includes(startSym)) {
      startSym = openTabs.find((s) => allSymbols.includes(s)) || allSymbols[0] || DEFAULT_SYMBOL;
      activeSymbol = startSym;
    }
    await waitForQuote(startSym, 5000);
    await selectSymbol(startSym);

    applyMobileTradeLayout();
    window.addEventListener("resize", () => {
      applyMobileTradeLayout();
      window.AlphaFXChartPositions?.sync?.();
    });

    accountPollTimer = setInterval(loadTradeSnapshot, 8000);
  }

  function bootTrade() {
    if (document.body.dataset.page !== "trade" || initialized) return;
    if (!layoutReady || !window.AlphaFXApi?.getToken?.()) return;
    init();
  }

  window.addEventListener("alphafx:layout-ready", () => {
    layoutReady = true;
    bootTrade();
  });
  window.addEventListener("alphafx:user", bootTrade);
  if (document.querySelector("[data-portal]")) {
    layoutReady = true;
    bootTrade();
  }

  window.addEventListener("beforeunload", () => {
    if (accountPollTimer) clearInterval(accountPollTimer);
  });
})();

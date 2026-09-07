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
    });
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
        layout: { background: { color: "#0f0f14" }, textColor: "#a1a1aa" },
        grid: { vertLines: { color: "#1f1f28" }, horzLines: { color: "#1f1f28" } },
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
        timeScale: { timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: "#27272a" },
      });
      series = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
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
      accountId,
      symbolMeta,
      fmtPrice,
      barBuffer,
      fallbackTime: () => barBuffer[barBuffer.length - 1]?.time,
      closePosition: (id) => closePosition(id),
      syncTicketStops: syncTicketStopsFromChart,
    };
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
  }

  function renderSymbolTabs() {
    const root = document.getElementById("trade-symbol-tabs");
    if (!root) return;
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

    if (sym === activeSymbol) updateTicket(tick);
  }

  function updateChartBadge(symbol) {
    const badge = document.getElementById("trade-chart-badge");
    if (!badge || !barBuffer.length) return;
    const src =
      chartSource === "mt5" ? "MT5" : chartSource === "synthetic" ? "Simulated" : "Live";
    badge.textContent = `${src} | ${symbol} · ${tfLabel(activeTimeframe)} · ${barBuffer.length} bars`;
  }

  function updateTicket(tick) {
    const sell = document.getElementById("trade-sell-px");
    const buy = document.getElementById("trade-buy-px");
    if (sell) sell.textContent = fmtPrice(tick.symbol, tick.bid);
    if (buy) buy.textContent = fmtPrice(tick.symbol, tick.ask);
    if (tick.symbol === activeSymbol) updateChartBadge(tick.symbol);
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
    closingTradeIds.add(tradeId);
    orderBusy = true;
    setTradingControls(tradingEnabled);
    try {
      const res = await window.AlphaFXApi.request(`/api/v1/trade/positions/${tradeId}/close`, {
        method: "POST",
        body: JSON.stringify({ account_id: accountId, reason }),
      });
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

  function notifyPendingFills(fills) {
    if (!fills?.length) return;
    for (const f of fills) {
      toast(`${f.symbol} · ${String(f.order_type || "order").toUpperCase()} ${f.side} filled @ ${f.price}`, "success");
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
    const ids = ["trade-volume", "trade-sl", "trade-tp", "trade-price", "trade-buy-btn", "trade-sell-btn"];
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

  async function submitOrder(side) {
    if (!tradingEnabled || orderBusy || !accountId) return;
    const volume = Number(document.getElementById("trade-volume")?.value || 0);
    if (!volume || volume < 0.01) {
      toast("Enter a valid volume (min 0.01 lots).", "error");
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
      const res = await window.AlphaFXApi.request("/api/v1/trade/orders", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          symbol: activeSymbol,
          side,
          volume,
          order_type: orderType,
          price,
          stop_loss: parseOptionalPrice(document.getElementById("trade-sl")?.value),
          take_profit: parseOptionalPrice(document.getElementById("trade-tp")?.value),
        }),
      });
      toast(res.message || (orderType === "market" ? "Order filled" : "Order placed"), "success");
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

  async function closePosition(tradeId) {
    if (!accountId || orderBusy) return;
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
      updateBottomCounts();
      renderBottomPanel();
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
          <td>${r.created ?? "—"}</td>
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
        <td>${r.opened ?? "—"}</td>
        <td>${r.closed ?? "—"}</td>
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
    if (mobile) main.classList.add("watchlist-collapsed");
    resizeChartSoon();
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
    document.querySelectorAll(".trade-watchlist-row").forEach((row) => {
      row.classList.toggle("active", row.dataset.symbol === symbol);
    });
    const last = window.AlphaFXQuotes.getLast(symbol);
    if (last) updateTicket(last);
    window.AlphaFXQuotes.subscribe([symbol]);
    await loadChart(symbol);
  }

  async function loadSymbols() {
    const data = await window.AlphaFXApi.request("/api/v1/market/symbols");
    groups = data.groups || {};
    renderWatchlist();
    loadTabs();
    renderSymbolTabs();
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
    bindOrderTypeTabs();
    updateOrderTicketUI();
    loadTimeframePref();
    loadSymbolPref();
    loadAccountPref();
    renderTimeframes();
    bindTimeframes();
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
    window.addEventListener("resize", applyMobileTradeLayout);

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

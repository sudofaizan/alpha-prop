/**
 * AlphaFX web trade terminal — live data mapping
 */
(function () {
  const STORAGE_TABS = "alphafx_trade_tabs";
  const DEFAULT_SYMBOL = "BTCUSD";
  const DEFAULT_TABS = ["XAUUSD", "BTCUSD"];

  let activeSymbol = DEFAULT_SYMBOL;
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

  function priceDrift(mid) {
    if (!barBuffer.length) return false;
    const lastClose = barBuffer[barBuffer.length - 1].close;
    if (!lastClose || !mid) return false;
    return Math.abs(mid - lastClose) / mid > 0.015;
  }

  const money = (n) =>
    `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function fmtPrice(symbol, value) {
    const digits = symbolMeta[symbol]?.digits ?? { EURUSD: 5, GBPUSD: 5, USDJPY: 3, XAUUSD: 2, BTCUSD: 3 }[symbol] ?? 5;
    return Number(value).toFixed(digits);
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

  function updateTicket(tick) {
    const sell = document.getElementById("trade-sell-px");
    const buy = document.getElementById("trade-buy-px");
    const badge = document.getElementById("trade-chart-badge");
    if (sell) sell.textContent = fmtPrice(tick.symbol, tick.bid);
    if (buy) buy.textContent = fmtPrice(tick.symbol, tick.ask);
    if (badge) badge.textContent = `Live | ${tick.symbol}`;
  }

  function mapAccountMetrics(account) {
    if (!account) return;
    accountData = account;
    const eq = document.getElementById("trade-equity");
    const bal = document.getElementById("trade-balance");
    const fm = document.getElementById("trade-free-margin");
    const mu = document.getElementById("trade-margin-used");
    const up = document.getElementById("trade-unrealised");
    const topBal = document.getElementById("trade-account-balance");

    if (eq) eq.textContent = money(account.equity);
    if (bal) bal.textContent = money(account.balance);
    if (fm) fm.textContent = money(account.equity);
    if (mu) mu.textContent = money(0);
    if (up) {
      up.textContent = (account.open_pnl >= 0 ? "+" : "") + money(account.open_pnl);
      up.classList.toggle("positive", account.open_pnl > 0);
      up.classList.toggle("negative", account.open_pnl < 0);
    }
    if (topBal) topBal.textContent = `${money(account.equity)} USD · ${account.phase_label}`;
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
      loadTradeSnapshot();
    };
  }

  async function loadTradeSnapshot() {
    const q = accountId ? `?account_id=${accountId}` : "";
    try {
      tradeSnapshot = await window.AlphaFXApi.request(`/api/v1/trade/snapshot${q}`);
      if (tradeSnapshot.account) {
        accountId = tradeSnapshot.account.id;
        mapAccountMetrics(tradeSnapshot.account);
      }
      renderAccountSelect(tradeSnapshot.accounts || [], accountId);
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
        open: "No open positions. Orders will appear here once MT5 Manager is connected.",
        pending: "No pending orders.",
        closed: "No closed trades yet.",
      };
      body.innerHTML = `<div class="trade-empty">${msgs[bottomPanel]}</div>`;
      return;
    }

    body.innerHTML = `<div class="trade-table-wrap"><table class="trade-table">
      <thead><tr>
        <th>Order ID</th><th>Opened</th><th>Closed</th><th>Symbol</th><th>Side</th>
        <th>Volume</th><th>Entry</th><th>Exit</th><th>P/L</th><th>Reason</th>
      </tr></thead>
      <tbody>${items
        .map(
          (r) => `<tr>
        <td>${r.id ?? "—"}</td>
        <td>${r.opened ?? "—"}</td>
        <td>${r.closed ?? "—"}</td>
        <td>${r.symbol ?? "—"}</td>
        <td class="${(r.side || "").toLowerCase()}">${r.side ?? "—"}</td>
        <td>${r.volume ?? "—"}</td>
        <td>${r.entry ?? "—"}</td>
        <td>${r.exit ?? "—"}</td>
        <td class="${Number(r.pnl) >= 0 ? "positive" : "negative"}">${r.pnl ?? "—"}</td>
        <td>${r.reason ?? "—"}</td>
      </tr>`
        )
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

  async function selectSymbol(symbol) {
    activeSymbol = symbol;
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
    const container = document.getElementById("trade-chart");
    if (!container || !window.LightweightCharts) return;

    if (!chart) {
      chart = window.LightweightCharts.createChart(container, {
        layout: { background: { color: "#0f0f14" }, textColor: "#a1a1aa" },
        grid: { vertLines: { color: "#1f1f28" }, horzLines: { color: "#1f1f28" } },
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
      const resize = () => {
        chart.applyOptions({ width: container.clientWidth, height: Math.max(container.clientHeight, 420) });
      };
      new ResizeObserver(resize).observe(container);
      resize();
    }

    const tick = window.AlphaFXQuotes?.getLast(symbol) || (await waitForQuote(symbol, 8000));
    const anchor = anchorFromTick(tick);
    const badge = document.getElementById("trade-chart-badge");

    if (anchor == null) {
      barBuffer = [];
      series.setData([]);
      if (badge) badge.textContent = `Waiting for live | ${symbol}`;
      return;
    }

    try {
      const hist = await window.AlphaFXApi.request(
        `/api/v1/market/history?symbol=${encodeURIComponent(symbol)}&timeframe=M1&limit=240&anchor=${encodeURIComponent(anchor)}`
      );
      barBuffer = (hist.bars || []).map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      series.setData(barBuffer);
      chart.timeScale().scrollToRealTime();
      if (badge) badge.textContent = `Live | ${symbol}`;
    } catch (e) {
      console.error(e);
    }
  }

  async function onTick(tick) {
    updateWatchlistPrice(tick);
    if (!series || tick.symbol !== activeSymbol) return;

    const mid = (tick.bid + tick.ask) / 2;
    if (barBuffer.length === 0 || priceDrift(mid)) {
      if (!chartLoading) {
        chartLoading = true;
        await loadChart(activeSymbol);
        chartLoading = false;
      }
      if (barBuffer.length === 0) return;
    }

    const bucket = Math.floor(tick.time_ms / 60000) * 60;
    const last = barBuffer[barBuffer.length - 1];
    if (!last || last.time !== bucket) {
      const bar = { time: bucket, open: mid, high: mid, low: mid, close: mid };
      barBuffer.push(bar);
      series.update(bar);
    } else {
      last.high = Math.max(last.high, mid);
      last.low = Math.min(last.low, mid);
      last.close = mid;
      series.update({ ...last });
    }
  }

  async function init() {
    if (document.body.dataset.page !== "trade" || initialized) return;
    initialized = true;

    bindBottomTabs();
    await loadSymbols();
    await loadTradeSnapshot();

    const allSymbols = Object.values(groups).flat().map((i) => i.symbol);
    window.AlphaFXQuotes.onTick(onTick);
    window.AlphaFXQuotes.connect(allSymbols);
    window.addEventListener("alphafx:quotes:status", (e) => setLiveStatus(e.detail?.live));

    const startSym = openTabs.includes(activeSymbol) ? activeSymbol : openTabs[0] || DEFAULT_SYMBOL;
    await waitForQuote(startSym, 5000);
    await selectSymbol(startSym);

    accountPollTimer = setInterval(loadTradeSnapshot, 8000);
  }

  window.addEventListener("alphafx:user", init);
  if (window.AlphaFXApi?.getToken?.()) init();

  window.addEventListener("beforeunload", () => {
    if (accountPollTimer) clearInterval(accountPollTimer);
  });
})();

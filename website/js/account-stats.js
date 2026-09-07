/**
 * Account statistics — live equity / open P&L from simulated positions + tick stream.
 */
(function () {
  if (document.body.dataset.page !== "account-stats") return;

  const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  let account = null;
  let snapshot = null;
  let symbolMeta = {};
  let liveRaf = null;

  function computeLive() {
    const base = snapshot?.metrics || {};
    const balance = base.balance ?? account?.balance ?? 0;
    const marginUsed = base.margin_used ?? 0;
    const open = snapshot?.open || [];

    if (!open.length) {
      return {
        balance,
        open_pnl: base.open_pnl ?? account?.open_pnl ?? 0,
        equity: base.equity ?? account?.equity ?? balance,
        free_margin: (base.equity ?? balance) - marginUsed,
      };
    }

    let openPnl = 0;
    for (const pos of open) {
      const tick = window.AlphaFXQuotes?.getLast(pos.symbol);
      openPnl += tick
        ? window.AlphaFXSimPnl.positionPnl(
            { symbol: pos.symbol, side: pos.side, volume: pos.volume, entry: pos.entry },
            tick,
            symbolMeta[pos.symbol]
          )
        : Number(pos.pnl || 0);
    }
    openPnl = Math.round(openPnl * 100) / 100;
    const equity = Math.round((balance + openPnl) * 100) / 100;
    return {
      balance,
      open_pnl: openPnl,
      equity,
      margin_used: marginUsed,
      free_margin: Math.round((equity - marginUsed) * 100) / 100,
    };
  }

  function paintLive() {
    if (!account) return;
    const live = computeLive();
    const eq = document.getElementById("stat-equity");
    const bal = document.getElementById("stat-balance");
    const pnl = document.getElementById("stat-open-pnl");
    const fm = document.getElementById("stat-free-margin");
    const mu = document.getElementById("stat-margin-used");
    if (eq) eq.textContent = money(live.equity);
    if (bal) bal.textContent = money(live.balance);
    if (pnl) {
      pnl.textContent = (live.open_pnl >= 0 ? "+" : "") + money(live.open_pnl);
      pnl.classList.toggle("is-positive", live.open_pnl > 0);
      pnl.classList.toggle("is-negative", live.open_pnl < 0);
    }
    if (fm) fm.textContent = money(live.free_margin);
    if (mu) mu.textContent = money(live.margin_used);
  }

  function refreshLive() {
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(() => {
      liveRaf = null;
      paintLive();
    });
  }

  function render(scope, a, snap) {
    const openCount = snap?.counts?.open ?? snap?.open?.length ?? 0;
    const closedCount = snap?.counts?.closed ?? snap?.closed?.length ?? 0;
    scope.innerHTML = `
      <header class="pt-header"><div class="pt-header-body">
        <span class="pt-header-tag">Account · #${a.account_number}</span>
        <h1 class="pt-header-title">${a.account_size_label} · ${a.program_label}</h1>
        <p class="pt-header-sub">${a.phase_label} · ${a.status.toUpperCase()} · Simulated trading</p>
      </div><div class="pt-header-actions"><a class="pt-btn pt-btn--ghost" href="accounts.html">← Back</a><a class="pt-btn pt-btn--primary" href="trade.html">Trade</a></div></header>
      <div class="pt-grid-stats pt-stagger">
        <div class="pt-stat-card pt-stat-card--gold"><div class="pt-stat-label">Equity</div><div class="pt-stat-value is-gold" id="stat-equity">${money(a.equity)}</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Balance</div><div class="pt-stat-value" id="stat-balance">${money(a.balance)}</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Open P&amp;L</div><div class="pt-stat-value" id="stat-open-pnl">${money(a.open_pnl)}</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Free margin</div><div class="pt-stat-value" id="stat-free-margin">—</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Margin used</div><div class="pt-stat-value" id="stat-margin-used">—</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Profit target</div><div class="pt-stat-value">${a.profit_target_progress.toFixed(1)}%</div></div>
      </div>
      <div class="pt-card" style="padding:24px;margin-top:16px;">
        <h2 class="pt-section-title">Trading activity</h2>
        <p class="pt-section-sub">${openCount} open · ${closedCount} closed · metrics update live with market prices</p>
        <p style="color:var(--text-dim);font-size:13px;margin:12px 0 0;">Daily loss used: ${a.daily_loss_used_pct}% · Overall loss used: ${a.overall_loss_used_pct}%</p>
      </div>`;
    paintLive();
  }

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const scope = document.querySelector(".dfx-scope[data-screen-label='Account Detail']") || document.querySelector(".pt-page.dfx-scope");
    if (!scope || !id) {
      if (scope) scope.innerHTML = `<div class="pt-card" style="padding:32px;margin:28px;">Select an account from <a href="accounts.html">My Accounts</a>.</div>`;
      return;
    }

    try {
      const [a, symData, snap] = await Promise.all([
        window.AlphaFXApi.getAccount(id),
        window.AlphaFXApi.getMarketSymbols?.() || window.AlphaFXApi.request("/api/v1/market/symbols"),
        window.AlphaFXApi.request(`/api/v1/trade/snapshot?account_id=${encodeURIComponent(id)}`),
      ]);
      account = a;
      snapshot = snap;
      Object.values(symData.groups || {}).flat().forEach((item) => {
        symbolMeta[item.symbol] = item;
      });
      render(scope, a, snap);

      const symbols = [...new Set((snap.open || []).map((p) => p.symbol))];
      const allSymbols = Object.values(symData.groups || {})
        .flat()
        .map((i) => i.symbol);
      window.AlphaFXQuotes.onTick(refreshLive);
      window.AlphaFXQuotes.connect(symbols.length ? [...new Set([...symbols, ...allSymbols])] : allSymbols);
      refreshLive();
      setInterval(async () => {
        snapshot = await window.AlphaFXApi.request(`/api/v1/trade/snapshot?account_id=${encodeURIComponent(id)}`);
        account = await window.AlphaFXApi.getAccount(id);
        refreshLive();
      }, 15000);
    } catch (err) {
      scope.innerHTML = `<div class="pt-card" style="padding:32px;margin:28px;color:var(--danger);">${err.message}</div>`;
    }
  }

  if (document.querySelector("[data-portal]")) {
    boot();
  } else {
    window.addEventListener("alphafx:layout-ready", boot);
    window.addEventListener("alphafx:user", boot);
  }
})();

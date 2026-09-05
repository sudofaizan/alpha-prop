/**
 * Account statistics — loads live account from API by ?id=
 */
(function () {
  if (document.body.dataset.page !== "account-stats") return;

  const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const scope = document.querySelector(".dfx-scope[data-screen-label='Account Detail']") || document.querySelector(".pt-page.dfx-scope");
    if (!scope || !id) {
      if (scope) scope.innerHTML = `<div class="pt-card" style="padding:32px;margin:28px;">Select an account from <a href="accounts.html">My Accounts</a>.</div>`;
      return;
    }

    try {
      const a = await window.AlphaFXApi.getAccount(id);
      scope.innerHTML = `
        <header class="pt-header"><div class="pt-header-body">
          <span class="pt-header-tag">Account · #${a.account_number}</span>
          <h1 class="pt-header-title">${a.account_size_label} · ${a.program_label}</h1>
          <p class="pt-header-sub">${a.phase_label} · ${a.status.toUpperCase()}</p>
        </div><div class="pt-header-actions"><a class="pt-btn pt-btn--ghost" href="accounts.html">← Back</a></div></header>
        <div class="pt-grid-stats pt-stagger">
          <div class="pt-stat-card pt-stat-card--gold"><div class="pt-stat-label">Equity</div><div class="pt-stat-value is-gold">${money(a.equity)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Balance</div><div class="pt-stat-value">${money(a.balance)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Open P&amp;L</div><div class="pt-stat-value">${money(a.open_pnl)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Profit target</div><div class="pt-stat-value">${a.profit_target_progress.toFixed(1)}%</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Max daily loss</div><div class="pt-stat-value">${a.max_daily_loss_pct}%</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Max overall loss</div><div class="pt-stat-value">${a.max_overall_loss_pct}%</div></div>
        </div>
        <div class="pt-card" style="padding:24px;margin-top:16px;">
          <h2 class="pt-section-title">Statistics</h2>
          <p class="pt-section-sub">Fresh account — trade data will appear here once connected to the trading platform.</p>
          <p style="color:var(--text-dim);font-size:13px;margin:12px 0 0;">Daily loss used: ${a.daily_loss_used_pct}% · Overall loss used: ${a.overall_loss_used_pct}%</p>
        </div>`;
    } catch (err) {
      scope.innerHTML = `<div class="pt-card" style="padding:32px;margin:28px;color:var(--danger);">${err.message}</div>`;
    }
  });
})();

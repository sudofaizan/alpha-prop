/**
 * Dynamic portal pages — dashboard, accounts, billing, notifications
 */
(function () {
  const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n, d = 2) => `${Number(n).toFixed(d)}%`;
  let accountFilter = "all";

  function emptyState(title, sub, ctaHref, ctaLabel) {
    return `<div class="pt-card" style="padding:48px 32px;text-align:center;">
      <h2 class="pt-section-title" style="margin-bottom:8px;">${title}</h2>
      <p class="pt-section-sub" style="margin:0 auto 20px;max-width:420px;">${sub}</p>
      ${ctaHref ? `<a class="pt-btn pt-btn--primary" href="${ctaHref}" style="text-decoration:none;display:inline-flex;">${ctaLabel}</a>` : ""}
    </div>`;
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function initials(name) {
    if (!name) return "··";
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function tabBadge(count, active) {
    const bg = active ? "rgba(255, 215, 0, 0.18)" : "rgba(255, 255, 255, 0.07)";
    const color = active ? "var(--gold)" : "var(--text-mute)";
    if (!count) return "";
    return `<span style="font-family:var(--font-num);font-variant-numeric:tabular-nums;font-size:11px;font-weight:800;padding:1px 7px;border-radius:999px;background:${bg};color:${color};line-height:1.5;">${count}</span>`;
  }

  function renderAccountTabs(counts, active) {
    const tabs = [
      { key: "all", label: "All" },
      { key: "active", label: "Active" },
      { key: "funded", label: "Funded" },
      { key: "passed", label: "Passed" },
      { key: "breached", label: "Breached" },
      { key: "expired", label: "Expired" },
    ];
    return tabs
      .map((t) => {
        const count = counts[t.key] ?? 0;
        const isActive = active === t.key;
        const dim = !count && t.key !== "all" ? " is-dim" : "";
        const disabled = !count && t.key !== "all" ? " disabled" : "";
        return `<button type="button" role="tab" aria-selected="${isActive ? "true" : "false"}" data-account-filter="${t.key}" class="dfx-subtab${isActive ? " is-active" : ""}${dim}" style="display:inline-flex;align-items:center;gap:7px;"${disabled}>${t.label}${tabBadge(count, isActive)}</button>`;
      })
      .join("");
  }

  function progBar(usedPct, limitPct) {
    const width = limitPct > 0 ? Math.min(100, (usedPct / limitPct) * 100) : 0;
    return `<div class="pt-acc-prog-track"><div class="pt-acc-prog-fill" style="width:${width.toFixed(1)}%;"></div></div>`;
  }

  function accountCard(a) {
    const statsHref = `account-statistics.html?id=${a.id}`;
    const start = Number(a.starting_balance || a.account_size || 0);
    const totalPnl = Number(a.equity || 0) - start;
    const totalPct = start ? (totalPnl / start) * 100 : 0;
    const pnlClass = totalPnl > 0 ? "is-pos" : totalPnl < 0 ? "is-neg" : "";
    const pnlSign = totalPnl > 0 ? "+" : totalPnl < 0 ? "-" : "";
    const shortSize = a.account_size_label.replace("$", "");

    return `<article class="pt-account-card">
      <div class="pt-acc-glow" aria-hidden="true"></div>
      <div class="pt-acc-head">
        <div class="pt-acc-id">
          <div class="pt-acc-size">${a.account_size_label}</div>
          <div class="pt-acc-login">Account #${a.account_number}</div>
          <div class="pt-acc-name">${shortSize}</div>
          <div class="pt-acc-model">${a.program_label} · ${a.account_size_label}</div>
        </div>
        <span class="pt-acc-chip"><span class="pt-acc-chip-dot" aria-hidden="true"></span>${a.phase_label}</span>
      </div>
      <div class="pt-acc-wells">
        <div class="pt-acc-well">
          <div class="pt-acc-well-label">Equity</div>
          <div class="pt-acc-well-value">${money(a.equity)}</div>
        </div>
        <div class="pt-acc-well">
          <div class="pt-acc-well-label">Total P&amp;L</div>
          <div class="pt-acc-well-value ${pnlClass}">${pnlSign}${money(Math.abs(totalPnl))}<span class="pt-acc-well-sub">(${pnlSign}${pct(Math.abs(totalPct))})</span></div>
        </div>
      </div>
      <div class="pt-acc-progs">
        <div>
          <div class="pt-acc-prog-head">
            <span class="pt-acc-prog-head-label">Profit target</span>
            <span>${pct(a.profit_target_progress, 0)} / ${pct(a.profit_target_pct, 0)}</span>
          </div>
          ${progBar(a.profit_target_progress, a.profit_target_pct || 100)}
        </div>
        <div>
          <div class="pt-acc-prog-head">
            <span class="pt-acc-prog-head-label">Daily drawdown</span>
            <span>${pct(a.daily_loss_used_pct, 2)} / ${pct(a.max_daily_loss_pct, 0)}</span>
          </div>
          ${progBar(a.daily_loss_used_pct, a.max_daily_loss_pct || 100)}
        </div>
        <div>
          <div class="pt-acc-prog-head">
            <span class="pt-acc-prog-head-label">Max drawdown</span>
            <span>${pct(a.overall_loss_used_pct, 2)} / ${pct(a.max_overall_loss_pct, 0)}</span>
          </div>
          ${progBar(a.overall_loss_used_pct, a.max_overall_loss_pct || 100)}
        </div>
      </div>
      <div class="pt-acc-actions">
        <a class="pt-acc-btn pt-acc-btn--primary" href="${statsHref}" style="text-decoration:none;text-align:center;">Statistics</a>
        <button type="button" class="pt-acc-btn" disabled>Credentials</button>
      </div>
    </article>`;
  }

  async function renderAccounts(filter = accountFilter) {
    accountFilter = filter;
    const root = document.getElementById("portal-accounts-root");
    if (!root) return;
    root.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading accounts…</div>`;
    try {
      const data = await window.AlphaFXApi.getAccounts(filter);
      const tabs = root.closest(".dfx-scope")?.querySelector(".dfx-subtabs");
      if (tabs) {
        tabs.innerHTML = renderAccountTabs(data.counts, filter);
      }
      if (!data.items.length) {
        root.innerHTML = emptyState("No challenges yet", "Buy your first challenge to get a trading account.", "index.html", "Buy challenge");
        return;
      }
      root.innerHTML = `<div class="pt-grid-accounts">${data.items.map(accountCard).join("")}</div>`;
    } catch (err) {
      root.innerHTML = `<div class="pt-card" style="padding:24px;color:var(--danger);">${err.message}</div>`;
    }
  }

  function riskBanner(warning) {
    const isBreached = warning.kind === "breached";
    const count = Number(warning.strike_count || 0).toFixed(2);
    const limit = warning.strike_limit || 2;
    const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    const reason = String(warning.subtitle || "").split(" · ").slice(2).join(" · ") || "Manage risk carefully";
    const sub = isBreached
      ? warning.subtitle
      : `Current <span class="pt-num" style="color:#f59e0b;font-weight:700;">${count}</span> · limit <span class="pt-num">${limit}</span> · ${reason}`;
    return `<div class="pt-banner pt-banner--warn"${isBreached ? ' style="border-color:rgba(239,68,68,0.45);"' : ""}>
      <div class="pt-banner-icon">${icon}</div>
      <div class="pt-banner-body">
        <div class="pt-banner-title">${warning.title}</div>
        <div class="pt-banner-sub">${sub}</div>
      </div>
    </div>`;
  }

  async function renderDashboard() {
    const root = document.getElementById("portal-dashboard-root");
    if (!root) return;
    root.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading dashboard…</div>`;
    try {
      const data = await window.AlphaFXApi.getDashboard();
      if (!data.has_accounts || !data.primary_account) {
        root.innerHTML = emptyState("Welcome to AlphaFX", "Your portal is empty. Purchase a challenge to get started.", "index.html", "Browse challenges");
        return;
      }
      const a = data.primary_account;
      const start = Number(a.starting_balance || a.account_size || 0);
      const equity = Number(a.equity || 0);
      const totalPnl = equity - start;
      const eqPct = start ? ((equity - start) / start) * 100 : 0;
      const eqTrendClass = eqPct >= 0 ? "is-up" : "is-down";
      const eqTrendSign = eqPct >= 0 ? "▲" : "▼";
      const pnlClass = totalPnl >= 0 ? "is-success" : totalPnl < 0 ? "is-danger" : "";
      const dailyLimit = start * (a.max_daily_loss_pct / 100);
      const targetAmt = start * (a.profit_target_pct / 100);
      const warnings = (data.risk_warnings || []).map(riskBanner).join("");
      const userName = data.user_name || window.__ALPHAFX_USER?.full_name || "Trader";

      root.innerHTML = `
        <header class="pt-header">
          <div class="pt-header-body">
            <span class="pt-header-tag"><span class="pt-chip-dot" style="background:var(--gold);"></span>Welcome back</span>
            <h1 class="pt-header-title">${userName}<span style="color:var(--text-mute);font-weight:500;"> · </span>Evaluation</h1>
            <p class="pt-header-sub">Live performance for <strong style="color:var(--text);">account #${a.account_number}</strong> on the ${a.account_size_label} challenge.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <span class="pt-chip pt-chip--gold"><span class="pt-chip-dot"></span>${a.phase_label}</span>
              <span class="pt-chip">${a.account_size_label.replace("$", "")}</span>
              ${data.is_breached ? `<span class="pt-chip pt-chip--danger">Breached</span>` : ""}
            </div>
          </div>
          <div class="pt-header-actions">
            <a class="pt-btn pt-btn--ghost" href="accounts.html">My accounts</a>
            <a class="pt-btn pt-btn--primary" href="index.html">+ New challenge</a>
          </div>
        </header>
        ${warnings ? `<div class="pt-stagger" style="display:flex;flex-direction:column;gap:8px;">${warnings}</div>` : ""}
        <div class="pt-grid-stats pt-stagger">
          <div class="pt-stat-card pt-stat-card--gold">
            <div class="pt-stat-label">Account equity</div>
            <div class="pt-stat-value is-gold">${money(equity)}</div>
            <div class="pt-stat-trend ${eqTrendClass}">${eqTrendSign} ${pct(Math.abs(eqPct), 2)}</div>
            <div class="pt-stat-foot">Balance: ${money(a.balance)}</div>
          </div>
          <div class="pt-stat-card">
            <div class="pt-stat-label">Open P&amp;L</div>
            <div class="pt-stat-value ${Number(a.open_pnl) >= 0 ? "is-success" : Number(a.open_pnl) < 0 ? "is-danger" : ""}">${money(a.open_pnl)}</div>
            <div class="pt-stat-foot">Live unrealised</div>
          </div>
          <div class="pt-stat-card">
            <div class="pt-stat-label">Total profit</div>
            <div class="pt-stat-value ${pnlClass}">${totalPnl >= 0 ? "" : "-"}${money(Math.abs(totalPnl))}</div>
            <div class="pt-stat-trend ${eqTrendClass}">${eqTrendSign} ${pct(Math.abs(eqPct), 2)}</div>
            <div class="pt-stat-foot">Target: ${money(targetAmt)} · ${pct(a.profit_target_progress, 1)} done</div>
          </div>
          <div class="pt-stat-card">
            <div class="pt-stat-label">Daily limit</div>
            <div class="pt-stat-value">${money(dailyLimit)}</div>
            <div class="pt-stat-foot">Used ${pct(a.daily_loss_used_pct, 2)} of ${pct(a.max_daily_loss_pct, 0)}</div>
          </div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <a class="pt-btn pt-btn--primary" href="trade.html">Trade now</a>
          <a class="pt-btn pt-btn--ghost" href="account-statistics.html?id=${a.id}">View statistics</a>
          <a class="pt-btn pt-btn--ghost" href="accounts.html">All accounts (${data.total_accounts})</a>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="pt-card" style="padding:24px;color:var(--danger);">${err.message}</div>`;
    }
  }

  async function renderBilling() {
    const root = document.getElementById("portal-billing-root");
    if (!root) return;
    root.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading billing…</div>`;
    try {
      const data = await window.AlphaFXApi.getBilling();
      if (!data.items.length) {
        root.innerHTML = emptyState("No purchases yet", "When you buy a challenge, your invoices will appear here.", "index.html", "Buy challenge");
        return;
      }
      const rows = data.items.map((o) => {
        const date = new Date(o.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const discount = o.base_amount > o.amount ? `<span style="text-decoration:line-through;color:var(--text-mute);margin-right:6px;">${money(o.base_amount)}</span>` : "";
        return `<tr>
          <td>${date}</td>
          <td>${o.account_size_label} ${o.program_label}</td>
          <td>${discount}${money(o.amount)}</td>
          <td>${o.coupon_code || "—"}</td>
          <td><span class="pt-chip pt-chip--success">${o.status.toUpperCase()}</span></td>
          <td>${o.account_number ? `#${o.account_number}` : "—"}</td>
        </tr>`;
      }).join("");
      root.innerHTML = `
        <div class="pt-grid-stats pt-stagger" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:20px;">
          <div class="pt-stat-card pt-stat-card--gold"><div class="pt-stat-label">Total spent</div><div class="pt-stat-value is-gold">${money(data.total_spent)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Successful purchases</div><div class="pt-stat-value">${data.successful_purchases}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Pending payments</div><div class="pt-stat-value">${data.pending_payments}</div></div>
        </div>
        <div class="pt-card pt-card--flush"><div class="pt-table-wrap"><table class="pt-table">
          <thead><tr><th>Date</th><th>Challenge</th><th>Amount</th><th>Coupon</th><th>Status</th><th>Account</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div></div>`;
    } catch (err) {
      root.innerHTML = `<div class="pt-card" style="padding:24px;color:var(--danger);">${err.message}</div>`;
    }
  }

  async function renderProfile() {
    const root = document.getElementById("portal-profile-root");
    if (!root) return;
    root.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading profile…</div>`;
    try {
      const user = await window.AlphaFXApi.me();
      root.innerHTML = `
        <div class="pt-card pt-card--gold-edge" style="padding:28px;text-align:center;">
          <div style="width:96px;height:96px;border-radius:50%;margin:0 auto;background:radial-gradient(circle at 35% 35%,#ffe97a,#ffd700,#c99a2e);display:flex;align-items:center;justify-content:center;color:#1a1505;font-family:var(--font-display);font-weight:900;font-size:32px;">${initials(user.full_name)}</div>
          <div style="font-family:var(--font-display);font-weight:900;font-size:18px;color:var(--text);margin-top:14px;">${user.full_name}</div>
          <div class="pt-num" style="font-size:12.5px;color:var(--text-dim);margin-top:2px;">${user.email}</div>
          ${user.is_admin ? `<span class="pt-chip pt-chip--gold" style="margin-top:12px;display:inline-flex;">Admin</span>` : ""}
        </div>
        <div class="pt-card" style="margin-top:16px;padding:20px;">
          <h3 class="pt-card-title" style="margin:0 0 14px;">Account details</h3>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text-mute);">Trader ID</span><span class="pt-num" style="font-weight:700;">${String(user.id).padStart(6, "0")}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text-mute);">Member since</span><span class="pt-num" style="font-weight:700;">${formatDate(user.created_at)}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text-mute);">Email</span><span style="font-weight:600;">${user.email}</span></div>
          </div>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="pt-card" style="padding:24px;color:var(--danger);">${err.message}</div>`;
    }
  }

  async function renderNotifications() {
    const root = document.getElementById("portal-notifications-root");
    if (!root) return;
    root.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading notifications…</div>`;
    try {
      const data = await window.AlphaFXApi.getNotifications();
      const sub = document.getElementById("notifications-sub");
      if (sub) {
        sub.textContent = data.counts.unread
          ? `${data.counts.unread} unread message${data.counts.unread > 1 ? "s" : ""}`
          : "You're all caught up.";
      }
      if (!data.items.length) {
        root.innerHTML = emptyState("No notifications", "Purchase a challenge or complete verification to receive updates here.", null, null);
        return;
      }
      root.innerHTML = `<div class="pt-card pt-card--flush">${data.items.map((n) => `
        <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.06);${n.is_read ? "opacity:.75;" : ""}">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <strong style="color:${n.is_read ? "var(--text)" : "var(--gold)"};">${n.title}</strong>
            <span style="font-size:12px;color:var(--text-mute);">${timeAgo(n.created_at)}</span>
          </div>
          <p style="margin:8px 0 0;font-size:13px;color:var(--text-dim);line-height:1.5;">${n.body}</p>
        </div>`).join("")}</div>`;
    } catch (err) {
      root.innerHTML = `<div class="pt-card" style="padding:24px;color:var(--danger);">${err.message}</div>`;
    }
  }

  function bootPage() {
    const page = document.body.dataset.page;
    if (page === "accounts") renderAccounts(accountFilter);
    if (page === "dashboard") renderDashboard();
    if (page === "billing") renderBilling();
    if (page === "notifications") renderNotifications();
    if (page === "profile") renderProfile();
  }

  document.getElementById("mark-all-read-btn")?.addEventListener("click", async () => {
    await window.AlphaFXApi.markAllNotificationsRead();
    renderNotifications();
    window.dispatchEvent(new CustomEvent("alphafx:user", { detail: window.__ALPHAFX_USER }));
  });

  document.addEventListener("click", (e) => {
    if (document.body.dataset.page !== "accounts") return;
    const tab = e.target.closest("[data-account-filter]");
    if (!tab || tab.disabled) return;
    e.preventDefault();
    renderAccounts(tab.dataset.accountFilter);
  });

  document.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("alphafx:user", bootPage);
    window.addEventListener("alphafx:layout-ready", () => {
      if (window.__ALPHAFX_USER) bootPage();
    });
  });
})();

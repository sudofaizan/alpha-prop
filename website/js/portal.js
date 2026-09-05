/**
 * Dynamic portal pages — dashboard, accounts, billing, notifications
 */
(function () {
  const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

  function accountCard(a) {
    const statsHref = `account-statistics.html?id=${a.id}`;
    return `<article class="pt-account-card">
      <div class="pt-acc-glow" aria-hidden="true"></div>
      <div class="pt-acc-head">
        <div class="pt-acc-id">
          <div class="pt-acc-size">${a.account_size_label}</div>
          <div class="pt-acc-login">Account #${a.account_number}</div>
          <div class="pt-acc-model">${a.program_label} · ${a.account_size_label}</div>
        </div>
        <span class="pt-acc-chip"><span class="pt-acc-chip-dot"></span>${a.phase_label}</span>
      </div>
      <div class="pt-acc-wells">
        <div class="pt-acc-well"><div class="pt-acc-well-label">Equity</div><div class="pt-acc-well-value">${money(a.equity)}</div></div>
        <div class="pt-acc-well"><div class="pt-acc-well-label">Balance</div><div class="pt-acc-well-value">${money(a.balance)}</div></div>
        <div class="pt-acc-well"><div class="pt-acc-well-label">Open P&amp;L</div><div class="pt-acc-well-value">${money(a.open_pnl)}</div></div>
      </div>
      <div class="pt-acc-actions">
        <a class="pt-acc-btn pt-acc-btn--primary" href="${statsHref}">Statistics</a>
        <button type="button" class="pt-acc-btn" disabled>Credentials</button>
      </div>
    </article>`;
  }

  async function renderAccounts() {
    const root = document.getElementById("portal-accounts-root");
    if (!root) return;
    root.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading accounts…</div>`;
    try {
      const data = await window.AlphaFXApi.getAccounts("all");
      const tabs = root.closest(".dfx-scope")?.querySelector(".dfx-subtabs");
      if (tabs) {
        tabs.innerHTML = `
          <button type="button" class="dfx-subtab is-active">All <span class="pt-num">${data.counts.all}</span></button>
          <button type="button" class="dfx-subtab">Active <span class="pt-num">${data.counts.active}</span></button>
          <button type="button" class="dfx-subtab">Funded <span class="pt-num">${data.counts.funded}</span></button>`;
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
      root.innerHTML = `
        <header class="pt-header"><div class="pt-header-body">
          <span class="pt-header-tag">Primary account</span>
          <h1 class="pt-header-title">${a.account_size_label} · #${a.account_number}</h1>
          <p class="pt-header-sub">${a.program_label} · ${a.phase_label}</p>
        </div><div class="pt-header-actions">
          <a class="pt-btn pt-btn--primary" href="index.html">+ New challenge</a>
        </div></header>
        <div class="pt-grid-stats pt-stagger">
          <div class="pt-stat-card pt-stat-card--gold"><div class="pt-stat-label">Equity</div><div class="pt-stat-value is-gold">${money(a.equity)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Total spent</div><div class="pt-stat-value is-gold">${money(data.total_spent)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Accounts</div><div class="pt-stat-value">${data.total_accounts}</div></div>
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
    if (page === "accounts") renderAccounts();
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

  document.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("alphafx:user", bootPage);
    window.addEventListener("alphafx:layout-ready", () => {
      if (window.__ALPHAFX_USER) bootPage();
    });
  });
})();

(function () {
  if (document.body.dataset.page !== "admin") return;

  let activeTab = "users";

  function table(headers, rows) {
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }

  async function loadStats() {
    const stats = await window.AlphaFXApi.adminStats();
    document.getElementById("admin-stats").innerHTML = `
      <div class="admin-stat"><div class="admin-stat-label">Users</div><div class="admin-stat-value">${stats.users}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Blocked</div><div class="admin-stat-value">${stats.blocked_users}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Accounts</div><div class="admin-stat-value">${stats.accounts}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Orders</div><div class="admin-stat-value">${stats.orders}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Revenue</div><div class="admin-stat-value">$${stats.revenue.toFixed(2)}</div></div>`;
  }

  async function renderUsers() {
    const data = await window.AlphaFXApi.adminUsers();
    const rows = data.items.map((u) => {
      const btn = u.is_blocked
        ? `<button class="admin-btn admin-btn--ok" data-unblock="${u.id}">Unblock</button>`
        : `<button class="admin-btn admin-btn--danger" data-block="${u.id}">Block</button>`;
      return `<tr>
        <td>${u.full_name}<br><span style="color:var(--text-mute);font-size:12px;">${u.email}</span></td>
        <td>${u.is_admin ? "Admin" : "Trader"}</td>
        <td>${u.account_count}</td>
        <td>${u.order_count}</td>
        <td>${u.is_blocked ? `<span style="color:#fca5a5;">Blocked</span><br><small>${u.blocked_reason || ""}</small>` : "Active"}</td>
        <td><div class="admin-actions">${u.is_admin ? "" : btn}</div></td>
      </tr>`;
    });
    document.getElementById("admin-panel").innerHTML = table(["User", "Role", "Accounts", "Orders", "Status", "Actions"], rows);
  }

  async function renderAccounts() {
    const data = await window.AlphaFXApi.adminAccounts();
    const rows = data.items.map(
      (a) => `<tr>
        <td>#${a.account_number}</td>
        <td>${a.user_email || a.user_id}</td>
        <td>${a.program_label} · ${a.account_size_label}</td>
        <td>${a.phase_label}</td>
        <td>${a.status}</td>
        <td>$${a.equity.toFixed(2)}</td>
      </tr>`
    );
    document.getElementById("admin-panel").innerHTML = table(["Account", "User", "Plan", "Phase", "Status", "Equity"], rows);
  }

  async function renderOrders() {
    const data = await window.AlphaFXApi.adminOrders();
    const rows = data.items.map(
      (o) => `<tr>
        <td>#${o.id}</td>
        <td>${o.user_email || o.user_id}</td>
        <td>${o.program} · $${o.account_size}</td>
        <td>$${o.amount.toFixed(2)}</td>
        <td>${o.payment_method}</td>
        <td>${o.account_number || "—"}</td>
      </tr>`
    );
    document.getElementById("admin-panel").innerHTML = table(["Order", "User", "Plan", "Amount", "Method", "Account"], rows);
  }

  async function renderTab() {
    document.getElementById("admin-panel").innerHTML = `<div style="padding:20px;color:var(--text-dim);">Loading…</div>`;
    if (activeTab === "users") await renderUsers();
    if (activeTab === "accounts") await renderAccounts();
    if (activeTab === "orders") await renderOrders();
  }

  document.getElementById("admin-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("is-active", t === btn));
    renderTab();
  });

  document.getElementById("admin-panel")?.addEventListener("click", async (e) => {
    const blockId = e.target.dataset.block;
    const unblockId = e.target.dataset.unblock;
    if (blockId) {
      const reason = prompt("Block reason (optional):") || "Blocked by admin";
      await window.AlphaFXApi.adminBlockUser(blockId, true, reason);
      await loadStats();
      await renderTab();
    }
    if (unblockId) {
      await window.AlphaFXApi.adminBlockUser(unblockId, false, null);
      await loadStats();
      await renderTab();
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    setTimeout(async () => {
      try {
        await loadStats();
        await renderTab();
      } catch (err) {
        document.getElementById("admin-panel").innerHTML = `<div class="pt-card" style="padding:20px;color:var(--danger);">${err.message}</div>`;
      }
    }, 200);
  });
})();

(function () {
  if (document.body.dataset.page !== "admin") return;

  let activeTab = "live";
  let liveTimer = null;
  let supportTimer = null;
  let userDetailId = null;
  let userDetailAccountId = null;
  let supportTickets = [];
  let supportSelectedId = null;
  let supportThread = null;
  let supportSending = false;
  let adminDeviceFilter = "";

  const SUPPORT_POLL_MS = 3000;

  function tabFromHash() {
    const hash = (window.location.hash || "").replace("#", "").toLowerCase();
    return ["live", "users", "accounts", "orders", "support"].includes(hash) ? hash : "live";
  }

  function setActiveTab(tab, { skipHash = false, keepDetail = false } = {}) {
    activeTab = tab;
    if (!keepDetail) {
      userDetailId = null;
      userDetailAccountId = null;
    }
    if (!skipHash) {
      const next = `#${tab}`;
      if (window.location.hash !== next) history.replaceState(null, "", next);
    }
    document.querySelectorAll(".admin-tab").forEach((t) => {
      t.classList.toggle("is-active", t.dataset.tab === tab);
    });
    window.AlphaFXLayout?.refreshShellForUser?.(window.__ALPHAFX_USER);
  }

  let livePositions = [];
  let symbolMeta = {};
  let livePnlBound = false;

  function formatPnl(n) {
    const v = Number(n || 0);
    if (v === 0) return money(0);
    return (v > 0 ? "+" : "-") + money(Math.abs(v));
  }

  function pnlColor(n) {
    const v = Number(n || 0);
    if (v > 0) return "#86efac";
    if (v < 0) return "#fca5a5";
    return "var(--text)";
  }

  function pnlCell(id, pnl) {
    const n = Number(pnl || 0);
    return `<td class="is-num" data-admin-pnl="${id}" style="font-weight:700;color:${pnlColor(n)}">${formatPnl(n)}</td>`;
  }

  async function ensureSymbolMeta() {
    if (Object.keys(symbolMeta).length) return;
    const symData = await window.AlphaFXApi.getMarketSymbols();
    Object.values(symData.groups || {}).flat().forEach((item) => {
      symbolMeta[item.symbol] = item;
    });
  }

  function refreshLivePnlCells() {
    if (!livePositions.length) return;
    let total = 0;
    for (const p of livePositions) {
      const tick = window.AlphaFXQuotes?.getLast(p.symbol);
      const pnl = tick
        ? window.AlphaFXSimPnl.positionPnl(
            { symbol: p.symbol, side: p.side, volume: p.volume, entry: p.entry },
            tick,
            symbolMeta[p.symbol]
          )
        : Number(p.pnl || 0);
      total += pnl;
      const cell = document.querySelector(`[data-admin-pnl="${p.id}"]`);
      if (cell) {
        cell.textContent = formatPnl(pnl);
        cell.style.color = pnlColor(pnl);
      }
    }
    const totalEl = document.getElementById("admin-total-open-pnl");
    if (totalEl) {
      totalEl.textContent = formatPnl(total);
      totalEl.style.color = pnlColor(total);
    }
  }

  async function setupLiveQuotes(positions) {
    livePositions = positions || [];
    if (!livePositions.length) return;
    await ensureSymbolMeta();
    if (!livePnlBound && window.AlphaFXQuotes?.onTick) {
      livePnlBound = true;
      window.AlphaFXQuotes.onTick((tick) => {
        if (activeTab !== "live") return;
        if (livePositions.some((p) => p.symbol === tick.symbol)) refreshLivePnlCells();
      });
    }
    const syms = [...new Set(livePositions.map((p) => p.symbol))];
    window.AlphaFXQuotes?.connect?.(syms);
    refreshLivePnlCells();
  }

  const closeIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

  function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function table(headers, rows) {
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" style="color:var(--text-mute);padding:24px;text-align:center;">Nothing here yet.</td></tr>`}</tbody></table></div>`;
  }

  function setPanel(html) {
    document.getElementById("admin-panel").innerHTML = html;
  }

  async function loadStats() {
    const stats = await window.AlphaFXApi.adminStats();
    document.getElementById("admin-stats").innerHTML = `
      <div class="admin-stat"><div class="admin-stat-label">Users</div><div class="admin-stat-value">${stats.users}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Blocked</div><div class="admin-stat-value">${stats.blocked_users}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Funded</div><div class="admin-stat-value">${stats.funded_accounts ?? 0}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Open positions</div><div class="admin-stat-value">${stats.open_positions ?? 0}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Pending orders</div><div class="admin-stat-value">${stats.pending_orders ?? 0}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Active traders</div><div class="admin-stat-value">${stats.active_traders ?? 0}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Revenue</div><div class="admin-stat-value">${money(stats.revenue)}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Support open</div><div class="admin-stat-value">${stats.open_support_tickets ?? 0}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Awaiting reply</div><div class="admin-stat-value">${stats.support_awaiting_reply ?? 0}</div></div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function supportWhen(iso) {
    if (window.AlphaFXTime) return window.AlphaFXTime.formatTimeAgo(iso);
    return iso ? new Date(iso).toLocaleString("en-GB") : "";
  }

  function supportWhenFull(iso) {
    const d = window.AlphaFXTime ? window.AlphaFXTime.parseUtc(iso) : new Date(iso);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function renderSupportMessages(messages) {
    return (messages || [])
      .map(
        (m) => `
      <div class="support-chat-bubble${m.is_staff ? " is-staff" : " is-user"}">
        <div class="support-chat-meta">${m.is_staff ? "Support" : escapeHtml(m.sender_name || "User")} · ${supportWhenFull(m.created_at)}</div>
        <div class="support-chat-text">${escapeHtml(m.body)}</div>
      </div>`
      )
      .join("");
  }

  function renderSupportListHtml() {
    if (!supportTickets.length) {
      return `<p class="support-empty-list">No support tickets yet</p>`;
    }
    return supportTickets
      .map(
        (t) => `
      <button type="button" class="support-ticket-row${t.id === supportSelectedId ? " is-active" : ""}${t.needs_reply ? " needs-attention" : ""}" data-admin-support-id="${t.id}">
        <div class="support-ticket-subject">${escapeHtml(t.subject)}</div>
        <div class="support-ticket-meta">${escapeHtml(t.user_email || t.user_name || "User")} · ${t.priority} · ${supportWhen(t.last_message_at || t.created_at)}</div>
      </button>`
      )
      .join("");
  }

  function renderSupportThreadHtml() {
    if (!supportThread) {
      return `<div class="pt-empty" style="margin:auto;padding:32px;"><div class="pt-empty-title">Select a ticket</div><p class="pt-empty-sub">Pick a conversation to chat with the user.</p></div>`;
    }
    const closed = supportThread.status === "closed";
    return `
      <div class="admin-support-thread-head">
        <h3>${escapeHtml(supportThread.subject)}</h3>
        <div class="admin-support-user-email">${escapeHtml(supportThread.user_email || "")}</div>
        <div class="admin-muted">${escapeHtml(supportThread.user_name || "")} · ${supportThread.priority} · ${supportThread.status} · ${supportWhen(supportThread.created_at)}</div>
        ${!closed ? `<div style="margin-top:10px;"><button type="button" class="admin-btn admin-btn--warn" data-admin-support-close="${supportThread.id}">Close ticket</button></div>` : ""}
      </div>
      <div class="support-chat-messages" id="admin-support-messages">${renderSupportMessages(supportThread.messages)}</div>
      ${
        closed
          ? `<p class="support-ticket-meta support-chat-closed">Ticket closed.</p>`
          : `<form class="support-chat-compose" id="admin-support-reply-form">
          <textarea class="dfx-textarea" id="admin-support-reply-input" rows="2" placeholder="Reply to user…" required minlength="1"></textarea>
          <button type="submit" class="pt-btn pt-btn--primary" id="admin-support-reply-btn">Send</button>
        </form>`
      }`;
  }

  function renderSupportPanel() {
    setPanel(`
      <div class="admin-support-grid dfx-scope">
        <div class="admin-support-list" id="admin-support-list">${renderSupportListHtml()}</div>
        <div class="admin-support-thread" id="admin-support-thread">${renderSupportThreadHtml()}</div>
      </div>`);
    const box = document.getElementById("admin-support-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  async function loadSupportTickets() {
    const data = await window.AlphaFXApi.adminSupportTickets();
    supportTickets = data.items || [];
  }

  async function loadSupportThread(id, { silent = false } = {}) {
    if (!id) return;
    const data = await window.AlphaFXApi.adminSupportTicket(id);
    const prevLen = supportThread?.messages?.length || 0;
    supportThread = data;
    if (!silent) {
      renderSupportPanel();
      return;
    }
    const box = document.getElementById("admin-support-messages");
    if (box && prevLen !== (data.messages?.length || 0)) {
      box.innerHTML = renderSupportMessages(data.messages);
      box.scrollTop = box.scrollHeight;
    }
    const list = document.getElementById("admin-support-list");
    if (list) list.innerHTML = renderSupportListHtml();
  }

  async function selectSupportTicket(id) {
    supportSelectedId = id;
    supportThread = null;
    renderSupportPanel();
    const threadEl = document.getElementById("admin-support-thread");
    if (threadEl) threadEl.innerHTML = `<div style="padding:24px;color:var(--text-dim);">Loading…</div>`;
    await loadSupportThread(id);
  }

  async function renderSupport() {
    await loadSupportTickets();
    if (supportSelectedId && !supportTickets.some((t) => t.id === supportSelectedId)) {
      supportSelectedId = null;
      supportThread = null;
    }
    renderSupportPanel();
    if (supportSelectedId) await loadSupportThread(supportSelectedId, { silent: true });
    startSupportTimer();
  }

  function stopSupportTimer() {
    if (supportTimer) {
      clearInterval(supportTimer);
      supportTimer = null;
    }
  }

  function startSupportTimer() {
    stopSupportTimer();
    if (activeTab !== "support") return;
    supportTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        await loadSupportTickets();
        const list = document.getElementById("admin-support-list");
        if (list) list.innerHTML = renderSupportListHtml();
        if (supportSelectedId) await loadSupportThread(supportSelectedId, { silent: true });
        await loadStats();
      } catch (err) {
        console.error(err);
      }
    }, SUPPORT_POLL_MS);
  }

  async function renderLive() {
    const data = await window.AlphaFXApi.adminLiveTrading();
    const s = data.summary || {};
    const openRows = (data.open || []).map((p) => {
      return `<tr>
        <td>${p.user_name || "—"}<br><span class="admin-muted">${p.user_email || ""}</span></td>
        <td>#${p.account_number || p.account_id}</td>
        <td>${p.symbol}</td>
        <td class="${String(p.side).toLowerCase()}">${p.side}</td>
        <td>${p.volume}</td>
        <td>${p.entry}</td>
        ${pnlCell(p.id, p.pnl)}
        <td>${p.opened || "—"}</td>
        <td><button type="button" class="admin-close-btn" data-admin-close="${p.id}" title="Close with message">${closeIcon}</button></td>
      </tr>`;
    });
    const pendingRows = (data.pending || []).map((p) => {
      return `<tr>
        <td>${p.user_name || "—"}<br><span class="admin-muted">${p.user_email || ""}</span></td>
        <td>#${p.account_number || p.account_id}</td>
        <td>${p.symbol}</td>
        <td>${String(p.order_type || "LIMIT")}</td>
        <td class="${String(p.side).toLowerCase()}">${p.side}</td>
        <td>${p.volume}</td>
        <td>${p.price ?? p.entry}</td>
        <td>${p.opened || "—"}</td>
      </tr>`;
    });

    setPanel(`
      <div class="admin-live-summary">
        <span class="admin-chip">${s.active_traders ?? 0} traders with activity</span>
        <span class="admin-chip admin-chip--ok">${s.online_traders ?? 0} online now</span>
        <span class="admin-chip">${s.open_positions ?? 0} open positions</span>
        <span class="admin-chip">${s.pending_orders ?? 0} pending orders</span>
        <span class="admin-chip admin-chip--pnl">Total open P/L: <strong id="admin-total-open-pnl" style="color:${pnlColor(s.total_open_pnl)}">${formatPnl(s.total_open_pnl ?? 0)}</strong></span>
        <span class="admin-muted" style="margin-left:auto;font-size:12px;">Live P/L · refreshes every 8s</span>
      </div>
      <h3 class="admin-section-title">Open positions</h3>
      ${table(["User", "Account", "Symbol", "Side", "Vol", "Entry", "P/L", "Opened", ""], openRows)}
      <h3 class="admin-section-title" style="margin-top:20px;">Pending orders</h3>
      ${table(["User", "Account", "Symbol", "Type", "Side", "Vol", "Price", "Created"], pendingRows)}
    `);
    await setupLiveQuotes(data.open || []);
  }

  async function renderUsers() {
    const q = adminDeviceFilter.trim();
    const data = await window.AlphaFXApi.adminUsers(q ? { device_id: q } : {});
    const rows = data.items.map((u) => {
      const btn = u.is_blocked
        ? `<button class="admin-btn admin-btn--ok" data-unblock="${u.id}">Unblock</button>`
        : `<button class="admin-btn admin-btn--danger" data-block="${u.id}">Block</button>`;
      const strikeBtn =
        u.is_admin || (u.strike_count ?? 0) >= (u.strike_limit ?? 2)
          ? ""
          : `<button class="admin-btn admin-btn--warn" data-strike="${u.id}" data-strikes="${u.strike_count ?? 0}">Strike</button>`;
      const online = u.is_online ? `<span class="admin-dot admin-dot--ok"></span>Online` : `<span class="admin-dot"></span>Offline`;
      const strikeLabel =
        (u.strike_count ?? 0) > 0
          ? `<span style="color:${u.is_breached ? "#fca5a5" : "#fbbf24"};">${u.strike_count}/${u.strike_limit ?? 2}${u.is_breached ? " · Breached" : ""}</span>`
          : "0";
      const deviceCell = u.device_id
        ? `<code style="font-size:11px;color:var(--gold);">${escapeHtml(u.device_id)}</code>`
        : `<span class="admin-muted">—</span>`;
      return `<tr>
        <td>${u.full_name}<br><span class="admin-muted">${u.email}</span></td>
        <td>${deviceCell}<br><span class="admin-muted">${escapeHtml(u.ip_address || "")}</span></td>
        <td>${u.is_admin ? "Admin" : "Trader"}</td>
        <td>${strikeLabel}</td>
        <td>${u.account_count}</td>
        <td>${u.funded_count ?? 0}</td>
        <td>${u.open_positions ?? 0} / ${u.pending_orders ?? 0}</td>
        <td>${online}</td>
        <td>${u.is_blocked ? `<span style="color:#fca5a5;">Blocked</span><br><small>${u.blocked_reason || ""}</small>` : "Active"}</td>
        <td><div class="admin-actions">
          <button class="admin-btn admin-btn--gold" data-user-stats="${u.id}">Stats</button>
          ${strikeBtn}
          ${u.is_admin ? "" : btn}
        </div></td>
      </tr>`;
    });
    setPanel(`
      <div class="admin-field" style="margin-bottom:14px;">
        <label for="admin-device-search">Find by device ID</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input id="admin-device-search" class="admin-select" style="max-width:420px;flex:1;" placeholder="Paste device ID (min 3 chars)…" value="${escapeHtml(q)}">
          <button type="button" class="admin-btn admin-btn--gold" id="admin-device-search-btn">Search</button>
          ${q ? `<button type="button" class="admin-btn" id="admin-device-clear-btn">Clear</button>` : ""}
        </div>
      </div>
      ${table(["User", "Device / IP", "Role", "Strikes", "Accounts", "Funded", "Open/Pend", "Session", "Status", "Actions"], rows)}`);
  }

  async function renderUserDetail(userId) {
    userDetailId = userId;
    const data = await window.AlphaFXApi.adminUser(userId);
    const u = data.user;
    const stats = data.stats || {};
    const accounts = data.accounts || [];
    if (!userDetailAccountId && accounts.length) userDetailAccountId = accounts[0].id;

    const accountOptions = accounts
      .map(
        (a) =>
          `<option value="${a.id}"${a.id === userDetailAccountId ? " selected" : ""}>#${a.account_number} · ${a.program_label} · ${a.status}</option>`
      )
      .join("");

    let snapHtml = `<div class="admin-muted" style="padding:20px;">Select an account to view trades.</div>`;
    if (userDetailAccountId) {
      const snap = await window.AlphaFXApi.adminUserSnapshot(userId, userDetailAccountId);
      const openRows = (snap.open || []).map((r) => {
        return `<tr>
          <td>${r.id}</td><td>${r.symbol}</td><td>${r.side}</td><td>${r.volume}</td>
          <td>${r.entry}</td><td>${money(r.pnl)}</td>
          <td><button type="button" class="admin-close-btn" data-admin-close="${r.id}" title="Close">${closeIcon}</button></td>
        </tr>`;
      });
      const closedRows = (snap.closed || []).slice(0, 50).map((r) => {
        return `<tr>
          <td>${r.id}</td><td>${r.opened}</td><td>${r.closed}</td><td>${r.symbol}</td>
          <td>${r.side}</td><td>${r.volume}</td><td>${r.entry}</td><td>${r.exit ?? "—"}</td>
          <td>${money(r.pnl)}</td><td>${r.reason ?? "—"}</td>
        </tr>`;
      });
      snapHtml = `
        <div class="admin-detail-metrics">
          <span>Equity ${money(snap.account?.equity)}</span>
          <span>Balance ${money(snap.account?.balance)}</span>
          <span>Open P/L ${money(snap.metrics?.open_pnl)}</span>
          <span>${snap.counts?.open ?? 0} open · ${snap.counts?.pending ?? 0} pending · ${snap.counts?.closed ?? 0} closed</span>
        </div>
        <h4 class="admin-subtitle">Open positions</h4>
        ${table(["ID", "Symbol", "Side", "Vol", "Entry", "P/L", ""], openRows)}
        <h4 class="admin-subtitle" style="margin-top:16px;">Recent closed trades</h4>
        ${table(["ID", "Opened", "Closed", "Symbol", "Side", "Vol", "Entry", "Exit", "P/L", "Reason"], closedRows)}
      `;
    }

    const btn = u.is_blocked
      ? `<button class="admin-btn admin-btn--ok" data-unblock="${u.id}">Unblock user</button>`
      : `<button class="admin-btn admin-btn--danger" data-block="${u.id}">Block user</button>`;
    const strikeBtn =
      u.is_admin || (u.strike_count ?? 0) >= (u.strike_limit ?? 2)
        ? ""
        : `<button class="admin-btn admin-btn--warn" data-strike="${u.id}" data-strikes="${u.strike_count ?? 0}">Issue strike</button>`;
    const clearStrikeBtn =
      (u.strike_count ?? 0) > 0 ? `<button class="admin-btn" data-clear-strikes="${u.id}">Clear strikes</button>` : "";

    let strikesHtml = "";
    try {
      const strikeData = await window.AlphaFXApi.adminUserStrikes(userId);
      if (strikeData.items?.length) {
        strikesHtml = `<div class="admin-table-wrap" style="margin-top:12px;"><table class="admin-table"><thead><tr><th>Rule</th><th>Reason</th><th>Date</th></tr></thead><tbody>${strikeData.items
          .map(
            (s) => `<tr><td>${s.rule_label}</td><td>${s.reason}</td><td>${s.created_at ? new Date(s.created_at).toLocaleString() : "—"}</td></tr>`
          )
          .join("")}</tbody></table></div>`;
      } else {
        strikesHtml = `<p class="admin-muted" style="margin-top:8px;">No strikes on record.</p>`;
      }
    } catch {
      strikesHtml = `<p class="admin-muted" style="margin-top:8px;">Could not load strikes.</p>`;
    }

    setPanel(`
      <div class="admin-detail-head">
        <button type="button" class="admin-btn" data-admin-back>← Back to users</button>
        <div>
          <h2 class="admin-section-title">${u.full_name}</h2>
          <p class="admin-muted">${u.email} · ${u.is_blocked ? "Blocked" : "Active"} · ${u.is_online ? "Online" : "Offline"} · Strikes ${u.strike_count ?? 0}/${u.strike_limit ?? 2}${u.is_breached ? " · Breached" : ""}</p>
          ${u.device_id ? `<p class="admin-muted" style="margin-top:6px;">Device <code style="color:var(--gold);">${escapeHtml(u.device_id)}</code>${u.ip_address ? ` · IP ${escapeHtml(u.ip_address)}` : ""}${u.user_agent ? `<br><span style="font-size:11px;">${escapeHtml(u.user_agent)}</span>` : ""}</p>` : ""}
        </div>
        <div class="admin-actions">${strikeBtn}${clearStrikeBtn}${u.is_admin ? "" : btn}</div>
      </div>
      <div class="admin-detail-stats">
        <div class="admin-stat"><div class="admin-stat-label">Accounts</div><div class="admin-stat-value">${u.account_count}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">Funded</div><div class="admin-stat-value">${stats.funded_accounts ?? u.funded_count ?? 0}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">Open / Pending</div><div class="admin-stat-value">${stats.open_positions ?? 0} / ${stats.pending_orders ?? 0}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">Closed trades</div><div class="admin-stat-value">${stats.closed_trades ?? 0}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">Realised P/L</div><div class="admin-stat-value">${money(stats.realised_pnl ?? 0)}</div></div>
      </div>
      <h3 class="admin-section-title" style="margin-top:8px;">Strikes</h3>
      ${strikesHtml}
      <div class="admin-field" style="margin:16px 0;">
        <label for="admin-account-select">Account</label>
        <select id="admin-account-select" class="admin-select">${accountOptions || `<option value="">No accounts</option>`}</select>
      </div>
      <div id="admin-user-snap">${snapHtml}</div>
    `);
  }

  async function renderAccounts() {
    const data = await window.AlphaFXApi.adminAccounts();
    const rows = data.items.map(
      (a) => `<tr>
        <td>#${a.account_number}</td>
        <td>${a.user_name || a.user_email || a.user_id}</td>
        <td>${a.program_label} · ${a.account_size_label}</td>
        <td>${a.phase_label}</td>
        <td>${a.status}</td>
        <td>${money(a.equity)}</td>
        <td><button class="admin-btn admin-btn--gold" data-user-stats="${a.user_id}">User stats</button></td>
      </tr>`
    );
    setPanel(table(["Account", "User", "Plan", "Phase", "Status", "Equity", ""], rows));
  }

  async function renderOrders() {
    const data = await window.AlphaFXApi.adminOrders();
    const rows = data.items.map(
      (o) => `<tr>
        <td>#${o.id}</td>
        <td>${o.user_email || o.user_id}</td>
        <td>${o.program} · $${o.account_size}</td>
        <td>${money(o.amount)}</td>
        <td>${o.payment_method}</td>
        <td>${o.account_number || "—"}</td>
      </tr>`
    );
    setPanel(table(["Order", "User", "Plan", "Amount", "Method", "Account"], rows));
  }

  function stopLiveTimer() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }

  function stopAllTimers() {
    stopLiveTimer();
    stopSupportTimer();
  }

  function startLiveTimer() {
    stopLiveTimer();
    if (activeTab === "live") {
      liveTimer = setInterval(() => renderLive().catch(console.error), 8000);
    }
  }

  async function renderTab() {
    stopAllTimers();
    if (!userDetailId) setActiveTab(activeTab, { skipHash: true });
    setPanel(`<div style="padding:20px;color:var(--text-dim);">Loading…</div>`);
    if (activeTab === "live") {
      await renderLive();
      startLiveTimer();
    }
    if (activeTab === "users") {
      if (userDetailId) await renderUserDetail(userDetailId);
      else await renderUsers();
    }
    if (activeTab === "accounts") await renderAccounts();
    if (activeTab === "orders") await renderOrders();
    if (activeTab === "support") await renderSupport();
  }

  async function adminCloseTrade(tradeId) {
    const message = prompt("Close reason (shown to user as BY ADMIN: …):");
    if (!message || !message.trim()) return;
    try {
      const res = await window.AlphaFXApi.adminClosePosition(tradeId, message.trim());
      alert(res.message || "Position closed");
      await loadStats();
      if (userDetailId) await renderUserDetail(userDetailId);
      else if (activeTab === "live") await renderLive();
      else await renderTab();
    } catch (err) {
      alert(err.message || "Close failed");
    }
  }

  async function adminStrikeUser(userId, currentCount) {
    const limit = 2;
    if (currentCount >= limit) {
      alert(`User already has ${limit} strikes — account is breached.`);
      return;
    }
    const rule = prompt(
      "Rule violated (e.g. News Trading, Copy Trading, Hedging):",
      "News Trading"
    );
    if (!rule || !rule.trim()) return;
    const reason = prompt("Strike details (shown on user dashboard warning):");
    if (!reason || !reason.trim()) return;
    try {
      const res = await window.AlphaFXApi.adminStrikeUser(userId, rule.trim(), reason.trim());
      alert(res.message || "Strike issued");
      await loadStats();
      if (userDetailId) await renderUserDetail(userDetailId);
      else await renderTab();
    } catch (err) {
      alert(err.message || "Strike failed");
    }
  }

  async function adminClearStrikes(userId) {
    if (!confirm("Clear all strikes for this user? This does not restore breached accounts.")) return;
    try {
      const res = await window.AlphaFXApi.adminClearStrikes(userId);
      alert(res.message || "Strikes cleared");
      if (userDetailId) await renderUserDetail(userDetailId);
      else await renderTab();
    } catch (err) {
      alert(err.message || "Clear failed");
    }
  }

  async function handleAdminSubmit(e) {
    const form = e.target.closest("#admin-support-reply-form");
    if (!form) return;
    e.preventDefault();
    if (supportSending || !supportSelectedId) return;
    const input = document.getElementById("admin-support-reply-input");
    const text = (input?.value || "").trim();
    if (!text) return;
    supportSending = true;
    const btn = document.getElementById("admin-support-reply-btn");
    if (btn) btn.disabled = true;
    try {
      await window.AlphaFXApi.adminSupportReply(supportSelectedId, text);
      if (input) input.value = "";
      await loadSupportThread(supportSelectedId);
      await loadSupportTickets();
      renderSupportPanel();
    } catch (err) {
      alert(err.message || "Send failed");
    } finally {
      supportSending = false;
      if (btn) btn.disabled = false;
    }
  }

  async function handleAdminClick(e) {
    const tabBtn = e.target.closest("#admin-tabs .admin-tab");
    if (tabBtn) {
      supportSelectedId = null;
      supportThread = null;
      setActiveTab(tabBtn.dataset.tab || "live");
      renderTab().catch(console.error);
      return;
    }

    const supportRow = e.target.closest("[data-admin-support-id]");
    if (supportRow) {
      e.preventDefault();
      selectSupportTicket(Number(supportRow.dataset.adminSupportId)).catch(console.error);
      return;
    }

    const supportClose = e.target.closest("[data-admin-support-close]");
    if (supportClose) {
      e.preventDefault();
      if (!confirm("Close this support ticket?")) return;
      window.AlphaFXApi.adminSupportClose(Number(supportClose.dataset.adminSupportClose))
        .then(async () => {
          await loadSupportThread(supportSelectedId);
          await loadSupportTickets();
          await loadStats();
          renderSupportPanel();
        })
        .catch((err) => alert(err.message || "Close failed"));
      return;
    }

    const panel = e.target.closest("#admin-panel");
    if (!panel) return;

    if (e.target.closest("#admin-device-search-btn")) {
      e.preventDefault();
      adminDeviceFilter = document.getElementById("admin-device-search")?.value || "";
      await renderUsers();
      return;
    }

    if (e.target.closest("#admin-device-clear-btn")) {
      e.preventDefault();
      adminDeviceFilter = "";
      await renderUsers();
      return;
    }

    const closeBtn = e.target.closest("[data-admin-close]");
    if (closeBtn) {
      e.preventDefault();
      adminCloseTrade(Number(closeBtn.dataset.adminClose));
      return;
    }

    const statsBtn = e.target.closest("[data-user-stats]");
    if (statsBtn) {
      e.preventDefault();
      setActiveTab("users", { keepDetail: true });
      await renderUserDetail(Number(statsBtn.dataset.userStats));
      return;
    }

    const strikeBtn = e.target.closest("[data-strike]");
    if (strikeBtn) {
      e.preventDefault();
      await adminStrikeUser(Number(strikeBtn.dataset.strike), Number(strikeBtn.dataset.strikes || 0));
      return;
    }

    const clearStrikesBtn = e.target.closest("[data-clear-strikes]");
    if (clearStrikesBtn) {
      e.preventDefault();
      await adminClearStrikes(Number(clearStrikesBtn.dataset.clearStrikes));
      return;
    }

    if (e.target.closest("[data-admin-back]")) {
      e.preventDefault();
      userDetailId = null;
      userDetailAccountId = null;
      await renderUsers();
      return;
    }

    const blockBtn = e.target.closest("[data-block]");
    if (blockBtn) {
      e.preventDefault();
      const reason = prompt("Block reason (optional):") || "Blocked by admin";
      try {
        await window.AlphaFXApi.adminBlockUser(blockBtn.dataset.block, true, reason);
        await loadStats();
        if (userDetailId) await renderUserDetail(userDetailId);
        else await renderTab();
      } catch (err) {
        alert(err.message || "Block failed");
      }
      return;
    }

    const unblockBtn = e.target.closest("[data-unblock]");
    if (unblockBtn) {
      e.preventDefault();
      try {
        await window.AlphaFXApi.adminBlockUser(unblockBtn.dataset.unblock, false, null);
        await loadStats();
        if (userDetailId) await renderUserDetail(userDetailId);
        else await renderTab();
      } catch (err) {
        alert(err.message || "Unblock failed");
      }
    }
  }

  async function handleAdminChange(e) {
    if (e.target.id === "admin-device-search" && e.type === "keydown" && e.key === "Enter") {
      e.preventDefault();
      adminDeviceFilter = e.target.value || "";
      await renderUsers();
      return;
    }
    if (e.target.id === "admin-account-select" && userDetailId) {
      userDetailAccountId = Number(e.target.value) || null;
      await renderUserDetail(userDetailId);
    }
  }

  let adminEventsBound = false;
  let adminBooted = false;

  function bindAdminEvents() {
    if (adminEventsBound) return;
    adminEventsBound = true;
    document.addEventListener("click", handleAdminClick);
    document.addEventListener("submit", handleAdminSubmit);
    document.addEventListener("change", handleAdminChange);
    document.addEventListener("keydown", handleAdminChange);
  }

  async function bootAdmin() {
    if (adminBooted) return;
    if (!document.getElementById("admin-panel")) return;
    adminBooted = true;
    bindAdminEvents();
    activeTab = tabFromHash();
    setActiveTab(activeTab, { skipHash: true });
    try {
      await loadStats();
      await renderTab();
    } catch (err) {
      setPanel(`<div class="pt-card" style="padding:20px;color:var(--danger);">${err.message}</div>`);
    }
  }

  window.addEventListener("alphafx:layout-ready", () => {
    setTimeout(() => bootAdmin().catch(console.error), 0);
  });

  if (document.querySelector("[data-portal]")) {
    setTimeout(() => bootAdmin().catch(console.error), 0);
  }

  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    if (tab === activeTab && !userDetailId) return;
    activeTab = tab;
    userDetailId = null;
    userDetailAccountId = null;
    setActiveTab(tab, { skipHash: true });
    renderTab().catch(console.error);
  });

  window.addEventListener("beforeunload", stopAllTimers);
})();

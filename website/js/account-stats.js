/**
 * Account statistics — live equity / open P&L + trade history (Capify-style).
 */
(function () {
  if (document.body.dataset.page !== "account-stats") return;

  const money = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

  let account = null;
  let snapshot = null;
  let symbolMeta = {};
  let liveRaf = null;
  let accountId = null;
  let closeBusy = false;

  const closeIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;

  function toast(msg, type) {
    window.AlphaFXToast?.show?.(msg, type) || console.log(msg);
  }

  function fmtTradeDate(value, epochSec) {
    const d = epochSec ? new Date(epochSec * 1000) : new Date(String(value || "").replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return value || "—";
    const day = d.getUTCDate();
    const mon = MONTHS[d.getUTCMonth()] || "";
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${day} ${mon} · ${hh}:${mm}:${ss}`;
  }

  function fmtDuration(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
    const s = Math.floor(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
  }

  function sideChip(side) {
    const s = String(side || "").toUpperCase();
    const cls = s === "BUY" ? "pt-chip pt-chip--success" : "pt-chip pt-chip--danger";
    return `<span class="${cls}">${s || "—"}</span>`;
  }

  function pnlHtml(pnl) {
    if (pnl == null || pnl === "") return `<td class="is-num">—</td>`;
    const n = Number(pnl);
    const color = n > 0 ? "var(--success)" : n < 0 ? "var(--danger)" : "var(--text)";
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    return `<td class="is-num" style="text-align:right;font-weight:700;color:${color}">${sign}${money(Math.abs(n))}</td>`;
  }

  function livePnlFor(pos) {
    const tick = window.AlphaFXQuotes?.getLast(pos.symbol);
    if (tick) {
      return window.AlphaFXSimPnl.positionPnl(
        { symbol: pos.symbol, side: pos.side, volume: pos.volume, entry: pos.entry },
        tick,
        symbolMeta[pos.symbol]
      );
    }
    return Number(pos.pnl || 0);
  }

  function computeLive() {
    const base = snapshot?.metrics || {};
    const balance = base.balance ?? account?.balance ?? 0;
    const marginUsed = base.margin_used ?? 0;
    const open = snapshot?.open || [];

    if (!open.length) {
      const equity = base.equity ?? account?.equity ?? balance;
      return {
        balance,
        open_pnl: base.open_pnl ?? account?.open_pnl ?? 0,
        equity,
        margin_used: marginUsed,
        free_margin: Math.max(0, equity - marginUsed),
        pnlById: {},
      };
    }

    let openPnl = 0;
    const pnlById = {};
    for (const pos of open) {
      const pnl = livePnlFor(pos);
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

    if (live.pnlById) {
      for (const [id, v] of Object.entries(live.pnlById)) {
        const cell = document.querySelector(`[data-stat-pnl="${id}"]`);
        if (!cell) continue;
        const n = Number(v);
        cell.textContent = (n >= 0 ? "+" : "") + money(n);
        cell.style.color = n > 0 ? "var(--success)" : n < 0 ? "var(--danger)" : "var(--text)";
      }
    }

    const now = Math.floor(Date.now() / 1000);
    document.querySelectorAll("[data-stat-duration]").forEach((el) => {
      const opened = Number(el.dataset.statDuration);
      if (!opened) return;
      el.textContent = fmtDuration(now - opened);
    });
  }

  function refreshLive() {
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(() => {
      liveRaf = null;
      paintLive();
    });
  }

  function emptyState(msg) {
    return `<div style="padding:40px;text-align:center;color:var(--text-mute);font-size:12.5px;">${msg}</div>`;
  }

  function cardHead(title, sub, chip) {
    return `<div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div><h3 class="pt-section-title" style="font-size:15px;">${title}</h3><p class="pt-section-sub">${sub}</p></div>
      ${chip ? `<span class="pt-chip">${chip}</span>` : ""}
    </div>`;
  }

  function renderOpenTable(rows) {
    if (!rows.length) return emptyState("No open trades.");
    return `<div class="pt-table-wrap"><table class="pt-table" style="min-width:960px;">
      <thead><tr>
        <th>Opened</th><th class="is-num">Duration</th><th>Symbol</th><th>Side</th>
        <th class="is-num">Size</th><th class="is-num">Entry</th><th class="is-num">SL</th><th class="is-num">TP</th>
        <th class="is-num" style="text-align:right;">P&amp;L</th><th>Reason</th><th></th>
      </tr></thead>
      <tbody>${rows
        .map((r) => {
          const pnl = r.pnl ?? livePnlFor(r);
          const fmt = (v) => (v == null || v === "" ? "—" : v);
          return `<tr>
            <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.opened, r.opened_time)}</td>
            <td class="is-num" style="font-weight:600;" data-stat-duration="${r.opened_time || ""}">${r.opened_time ? fmtDuration(Math.floor(Date.now() / 1000) - r.opened_time) : "—"}</td>
            <td style="font-weight:700;">${r.symbol ?? "—"}</td>
            <td>${sideChip(r.side)}</td>
            <td class="is-num">${r.volume ?? "—"}</td>
            <td class="is-num">${r.entry ?? "—"}</td>
            <td class="is-num">${fmt(r.sl)}</td>
            <td class="is-num">${fmt(r.tp)}</td>
            <td class="is-num" data-stat-pnl="${r.id}" style="text-align:right;font-weight:700;color:${Number(pnl) >= 0 ? "var(--success)" : Number(pnl) < 0 ? "var(--danger)" : "var(--text)"};">${(Number(pnl) >= 0 ? "+" : "") + money(pnl)}</td>
            <td>${r.reason ?? "open"}</td>
            <td style="text-align:center;"><button type="button" class="stat-close-btn" data-stat-close="${r.id}" aria-label="Close position" title="Close position"${closeBusy ? " disabled" : ""}>${closeIcon}</button></td>
          </tr>`;
        })
        .join("")}</tbody></table></div>`;
  }

  function renderPendingTable(rows) {
    if (!rows.length) return emptyState("No pending limit or stop orders.");
    return `<div class="pt-table-wrap"><table class="pt-table" style="min-width:880px;">
      <thead><tr>
        <th>Created</th><th>Symbol</th><th>Side</th><th>Type</th>
        <th class="is-num">Size</th><th class="is-num">Price</th><th class="is-num">SL</th><th class="is-num">TP</th>
      </tr></thead>
      <tbody>${rows
        .map((r) => {
          const fmt = (v) => (v == null || v === "" ? "—" : v);
          return `<tr>
            <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.created)}</td>
            <td style="font-weight:700;">${r.symbol ?? "—"}</td>
            <td>${sideChip(r.side)}</td>
            <td>${String(r.order_type || "LIMIT").toUpperCase()}</td>
            <td class="is-num">${r.volume ?? "—"}</td>
            <td class="is-num">${r.price ?? "—"}</td>
            <td class="is-num">${fmt(r.sl)}</td>
            <td class="is-num">${fmt(r.tp)}</td>
          </tr>`;
        })
        .join("")}</tbody></table></div>`;
  }

  function renderClosedTable(rows) {
    if (!rows.length) return emptyState("No closed trades yet.");
    return `<div class="pt-table-wrap"><table class="pt-table" style="min-width:880px;">
      <thead><tr>
        <th>Opened</th><th>Closed</th><th class="is-num">Duration</th><th>Symbol</th><th>Side</th>
        <th class="is-num">Size</th><th class="is-num">Entry</th><th class="is-num">Exit</th>
        <th class="is-num" style="text-align:right;">P&amp;L</th><th>Reason</th>
      </tr></thead>
      <tbody>${rows
        .map((r) => {
          const dur =
            r.opened_time && r.closed_time ? fmtDuration(r.closed_time - r.opened_time) : "—";
          return `<tr>
            <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.opened, r.opened_time)}</td>
            <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.closed, r.closed_time)}</td>
            <td class="is-num" style="font-weight:600;">${dur}</td>
            <td style="font-weight:700;">${r.symbol ?? "—"}</td>
            <td>${sideChip(r.side)}</td>
            <td class="is-num">${r.volume ?? "—"}</td>
            <td class="is-num">${r.entry ?? "—"}</td>
            <td class="is-num">${r.exit ?? "—"}</td>
            ${pnlHtml(r.pnl)}
            <td>${r.reason ?? "—"}</td>
          </tr>`;
        })
        .join("")}</tbody></table></div>`;
  }

  function renderTradeSections(snap) {
    const open = snap?.open || [];
    const pending = snap?.pending || [];
    const closed = snap?.closed || [];
    const openCount = snap?.counts?.open ?? open.length;
    const pendingCount = snap?.counts?.pending ?? pending.length;
    const closedCount = snap?.counts?.closed ?? closed.length;

    const root = document.getElementById("stat-trades-root");
    if (!root) return;

    root.innerHTML = `
      <div class="pt-card pt-card--flush">
        ${cardHead("Open trades", "Currently active positions", `${openCount} active`)}
        ${renderOpenTable(open)}
      </div>
      <div class="pt-card pt-card--flush">
        ${cardHead("Pending orders", "Limit and stop orders waiting to fill", `${pendingCount} pending`)}
        ${renderPendingTable(pending)}
      </div>
      <div class="pt-card pt-card--flush">
        ${cardHead("Trade history", "All closed trades, sorted by time", `${closedCount} total`)}
        ${renderClosedTable(closed)}
      </div>`;
    paintLive();
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
      <div class="pt-card" style="padding:20px 24px;">
        <h2 class="pt-section-title">Trading activity</h2>
        <p class="pt-section-sub">${openCount} open · ${closedCount} closed · metrics update live with market prices</p>
        <p style="color:var(--text-dim);font-size:13px;margin:12px 0 0;">Daily loss used: ${a.daily_loss_used_pct}% · Overall loss used: ${a.overall_loss_used_pct}%</p>
      </div>
      <div id="stat-trades-root" style="display:flex;flex-direction:column;gap:16px;"></div>`;
    renderTradeSections(snap);
  }

  async function reloadSnapshot() {
    if (!accountId) return;
    snapshot = await window.AlphaFXApi.request(`/api/v1/trade/snapshot?account_id=${encodeURIComponent(accountId)}`);
    account = await window.AlphaFXApi.getAccount(accountId);
    renderTradeSections(snapshot);
    refreshLive();
  }

  async function closePosition(tradeId) {
    if (!accountId || closeBusy) return;
    closeBusy = true;
    document.querySelectorAll("[data-stat-close]").forEach((btn) => {
      btn.disabled = true;
    });
    try {
      await window.AlphaFXApi.request(`/api/v1/trade/positions/${tradeId}/close`, {
        method: "POST",
        body: JSON.stringify({ account_id: Number(accountId) }),
      });
      toast("Position closed", "success");
      await reloadSnapshot();
    } catch (err) {
      toast(err?.message || "Close failed", "error");
    } finally {
      closeBusy = false;
    }
  }

  function bindCloseActions(scope) {
    scope.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-stat-close]");
      if (!btn || closeBusy) return;
      closePosition(Number(btn.dataset.statClose));
    });
  }

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    accountId = params.get("id");
    const scope = document.querySelector(".dfx-scope[data-screen-label='Account Detail']") || document.querySelector(".pt-page.dfx-scope");
    if (!scope || !accountId) {
      if (scope) scope.innerHTML = `<div class="pt-card" style="padding:32px;margin:28px;">Select an account from <a href="accounts.html">My Accounts</a>.</div>`;
      return;
    }

    try {
      const [a, symData, snap] = await Promise.all([
        window.AlphaFXApi.getAccount(accountId),
        window.AlphaFXApi.getMarketSymbols?.() || window.AlphaFXApi.request("/api/v1/market/symbols"),
        window.AlphaFXApi.request(`/api/v1/trade/snapshot?account_id=${encodeURIComponent(accountId)}`),
      ]);
      account = a;
      snapshot = snap;
      Object.values(symData.groups || {}).flat().forEach((item) => {
        symbolMeta[item.symbol] = item;
      });
      render(scope, a, snap);
      bindCloseActions(scope);

      const symbols = [
        ...new Set([...(snap.open || []), ...(snap.pending || [])].map((p) => p.symbol)),
      ];
      const allSymbols = Object.values(symData.groups || {})
        .flat()
        .map((i) => i.symbol);
      window.AlphaFXQuotes.onTick(refreshLive);
      window.AlphaFXQuotes.connect(symbols.length ? [...new Set([...symbols, ...allSymbols])] : allSymbols);
      refreshLive();
      setInterval(reloadSnapshot, 15000);
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

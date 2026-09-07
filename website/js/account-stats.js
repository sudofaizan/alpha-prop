/**
 * Account statistics — Capify-exact layout with live equity / open P&L.
 */
(function () {
  if (document.body.dataset.page !== "account-stats") return;

  const money = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const pct = (n, d = 1) => `${Number(n).toFixed(d)}%`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let account = null;
  let snapshot = null;
  let symbolMeta = {};
  let liveRaf = null;
  let accountId = null;
  let closeBusy = false;
  let journalMonth = new Date().getMonth();
  let journalYear = new Date().getFullYear();
  let resetTimer = null;

  const closeIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;
  const statCloseIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;
  const passIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>`;

  function toast(msg, type) {
    window.AlphaFXToast?.show?.(msg, type) || console.log(msg);
  }

  function fmtTradeDate(value, epochSec) {
    const d = epochSec ? new Date(epochSec * 1000) : new Date(String(value || "").replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return value || "—";
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] || ""} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
  }

  function fmtShortDate(epochSec) {
    const d = new Date(epochSec * 1000);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] || ""}`;
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

  function statusIcon(ok) {
    const bg = ok ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)";
    const border = ok ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)";
    const color = ok ? "var(--success)" : "var(--danger)";
    const label = ok ? "Passed" : "Failed";
    return `<span role="img" aria-label="${label}" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${bg};border:1px solid ${border};color:${color};">${ok ? passIcon : closeIcon}</span>`;
  }

  function segBar(usedPct, limitPct, segments = 20) {
    const ratio = limitPct > 0 ? Math.min(1, usedPct / limitPct) : 0;
    const filled = Math.round(ratio * segments);
    return Array.from({ length: segments }, (_, i) => {
      const active = i < filled;
      const bg = active ? "linear-gradient(180deg, var(--gold), var(--gold-deep, #C99A2E))" : "rgba(255, 255, 255, 0.06)";
      return `<div style="flex:1 1 0%;height:12px;border-radius:2px;background:${bg};transition:background 240ms var(--ease-out-quart, cubic-bezier(0.25,1,0.5,1));"></div>`;
    }).join("");
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
      return { balance, open_pnl: base.open_pnl ?? account?.open_pnl ?? 0, equity, margin_used: marginUsed, free_margin: Math.max(0, equity - marginUsed), pnlById: {} };
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
    return { balance, open_pnl: openPnl, equity, margin_used: marginUsed, free_margin: Math.round((equity - marginUsed) * 100) / 100, pnlById };
  }

  function computeTradeStats(closed) {
    const rows = closed || [];
    const wins = rows.filter((r) => Number(r.pnl) > 0);
    const losses = rows.filter((r) => Number(r.pnl) < 0);
    const totalLots = rows.reduce((s, r) => s + Number(r.volume || 0), 0);
    const avgProfit = wins.length ? wins.reduce((s, r) => s + Number(r.pnl), 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, r) => s + Number(r.pnl), 0) / losses.length : 0;
    const grossProfit = wins.reduce((s, r) => s + Number(r.pnl), 0);
    const grossLoss = Math.abs(losses.reduce((s, r) => s + Number(r.pnl), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    const expectancy = rows.length ? rows.reduce((s, r) => s + Number(r.pnl || 0), 0) / rows.length : 0;
    const avgRrr = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : 0;
    const durations = rows.filter((r) => r.opened_time && r.closed_time).map((r) => r.closed_time - r.opened_time);
    const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const best = rows.length ? Math.max(...rows.map((r) => Number(r.pnl || 0))) : 0;
    const dailyReturns = Object.values(groupByDay(rows)).map((d) => d.pnl);
    const mean = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const variance = dailyReturns.length > 1 ? dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyReturns.length - 1) : 0;
    const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 0;
    return {
      avgProfit,
      avgLoss,
      count: rows.length,
      lots: totalLots,
      sharpe,
      avgRrr,
      expectancy,
      avgDur,
      best,
      wins: wins.length,
      losses: losses.length,
      profitFactor,
    };
  }

  function groupByDay(closed) {
    const map = {};
    for (const r of closed || []) {
      const ts = r.closed_time || (r.closed ? Date.parse(String(r.closed).replace(" ", "T") + "Z") / 1000 : null);
      if (!ts) continue;
      const d = new Date(ts * 1000);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      if (!map[key]) map[key] = { pnl: 0, trades: 0, lots: 0, day: d.getUTCDate(), month: d.getUTCMonth(), ts };
      map[key].pnl += Number(r.pnl || 0);
      map[key].trades += 1;
      map[key].lots += Number(r.volume || 0);
    }
    return map;
  }

  function profitableDays(closed) {
    return Object.values(groupByDay(closed)).filter((d) => d.pnl > 0).length;
  }

  function tradingDays(closed) {
    return Object.keys(groupByDay(closed)).length;
  }

  function dailySummaryRows(closed, limit = 14) {
    return Object.values(groupByDay(closed))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
      .map((d) => {
        const color = d.pnl >= 0 ? "var(--success)" : "var(--danger)";
        const sign = d.pnl >= 0 ? "+" : "-";
        return `<tr>
          <td style="color:var(--gold);font-weight:600;">${d.day} ${MONTHS[d.month]}</td>
          <td class="is-num">${d.trades}</td>
          <td class="is-num">${d.lots.toFixed(2)}</td>
          <td class="is-num" style="text-align:right;font-weight:700;color:${color};">${sign}${money(Math.abs(d.pnl))}</td>
        </tr>`;
      })
      .join("");
  }

  function equityPoints(starting, closed, currentEquity) {
    const sorted = [...(closed || [])].filter((r) => r.closed_time).sort((a, b) => a.closed_time - b.closed_time);
    const pts = [{ t: 0, v: starting }];
    let eq = starting;
    sorted.forEach((r, i) => {
      eq += Number(r.pnl || 0);
      pts.push({ t: i + 1, v: eq });
    });
    pts.push({ t: pts.length, v: currentEquity });
    return pts;
  }

  function equityCurveSvg(starting, closed, currentEquity, dailyFloor, maxFloor) {
    const W = 754;
    const H = 220;
    const padL = 54;
    const padR = 16;
    const padT = 18;
    const padB = 28;
    const pts = equityPoints(starting, closed, currentEquity);
    const values = pts.map((p) => p.v);
    const lines = [starting, dailyFloor, maxFloor].filter((v) => Number.isFinite(v));
    const minV = Math.min(...values, ...lines) * 0.998;
    const maxV = Math.max(...values, ...lines) * 1.002;
    const range = maxV - minV || 1;
    const xScale = (i) => padL + (i / Math.max(1, pts.length - 1)) * (W - padL - padR);
    const yScale = (v) => padT + ((maxV - v) / range) * (H - padT - padB);
    const path = pts.map((p, i) => `${i ? "L" : "M"}${xScale(i).toFixed(1)},${yScale(p.v).toFixed(1)}`).join(" ");
    const down = currentEquity < starting;
    const stroke = down ? "var(--danger)" : "var(--success)";
    const gradId = "eqGrad";
    const area = `${path} L${xScale(pts.length - 1).toFixed(1)},${yScale(minV).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(minV).toFixed(1)} Z`;
    const yTicks = [maxV, (maxV + minV) / 2, minV];
    const hLines = [
      { v: starting, color: "var(--gold)", dash: "2 4", label: "Start" },
      { v: dailyFloor, color: "var(--gold)", dash: "2 4", label: "Daily loss 4%" },
      { v: maxFloor, color: "var(--danger)", dash: "2 4", label: "Max loss 10%" },
    ];
    return `<div style="width:100%;">
      <div style="display:flex;flex-wrap:wrap;gap:14px;justify-content:flex-end;font-family:var(--font-body);font-size:10.5px;font-weight:600;color:var(--text-mute);margin-bottom:6px;">
        ${hLines.map((l) => `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;"><i style="display:inline-block;width:14px;height:2px;background:${l.color};border-radius:2px;"></i>${l.label}</span>`).join("")}
      </div>
      <svg width="100%" height="220" viewBox="0 0 ${W} ${H}" style="display:block;" preserveAspectRatio="none">
        <defs><linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity="0.26"></stop><stop offset="100%" stop-color="${stroke}" stop-opacity="0"></stop></linearGradient></defs>
        ${yTicks.map((v) => `<g><line x1="${padL}" x2="${W - padR}" y1="${yScale(v).toFixed(1)}" y2="${yScale(v).toFixed(1)}" stroke="var(--border)" stroke-dasharray="2 4" stroke-width="1" opacity="0.6"></line><text x="${padL - 8}" y="${yScale(v) + 4}" text-anchor="end" fill="var(--text-mute)" font-size="11" font-family="var(--font-num)" font-weight="500">${Math.round(v).toLocaleString()}</text></g>`).join("")}
        ${hLines.map((l) => `<line x1="${padL}" x2="${W - padR}" y1="${yScale(l.v).toFixed(1)}" y2="${yScale(l.v).toFixed(1)}" stroke="${l.color}" stroke-dasharray="${l.dash}" stroke-width="1" opacity="0.55"></line>`).join("")}
        <path d="${area}" fill="url(#${gradId})"></path>
        <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path>
      </svg>
    </div>`;
  }

  function calendarGrid(closed, month, year) {
    const byDay = {};
    for (const d of Object.values(groupByDay(closed))) {
      if (d.month === month && new Date(d.ts * 1000).getUTCFullYear() === year) {
        byDay[d.day] = d;
      }
    }
    const first = new Date(Date.UTC(year, month, 1));
    const startOffset = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(`<div style="min-height:52px;"></div>`);
    let monthly = 0;
    let tradingDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const data = byDay[day];
      if (data) {
        monthly += data.pnl;
        tradingDays += 1;
        const pos = data.pnl >= 0;
        const border = pos ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
        const bg = pos ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
        const color = pos ? "var(--success)" : "var(--danger)";
        const sign = data.pnl >= 0 ? "+" : "-";
        cells.push(`<div style="min-height:52px;border-radius:8px;border:1px solid ${border};background:${bg};padding:6px 8px;display:flex;flex-direction:column;gap:2px;">
          <span style="font-size:10px;font-weight:700;color:var(--text-mute);">${day}</span>
          <span class="pt-num" style="font-size:11px;font-weight:800;color:${color};">${sign}${money(Math.abs(data.pnl))}</span>
          <span style="font-size:9px;color:var(--text-mute);">${data.trades} trade${data.trades > 1 ? "s" : ""}</span>
        </div>`);
      } else {
        cells.push(`<div style="min-height:52px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);padding:6px 8px;"><span style="font-size:10px;font-weight:700;color:var(--text-mute);">${day}</span></div>`);
      }
    }
    const monthlyColor = monthly >= 0 ? "var(--success)" : "var(--danger)";
    const monthlySign = monthly >= 0 ? "+" : "-";
    return {
      html: `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">${DAY_NAMES.map((d) => `<div style="text-align:center;font-size:10.5px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:0.1em;padding:6px 0;">${d}</div>`).join("")}</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells.join("")}</div>`,
      monthly,
      monthlyColor,
      monthlySign,
      tradingDays,
      label: `${MONTHS_FULL[month]} ${year}`,
    };
  }

  function athensMidnightCountdown() {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    const h = Number(parts.hour);
    const m = Number(parts.minute);
    const s = Number(parts.second);
    const elapsed = h * 3600 + m * 60 + s;
    const remaining = 86400 - elapsed;
    const rh = String(Math.floor(remaining / 3600)).padStart(2, "0");
    const rm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
    const rs = String(remaining % 60).padStart(2, "0");
    const progress = (elapsed / 86400) * 100;
    return { text: `${rh}<span style="color:var(--text-mute);margin:0 2px;">:</span>${rm}<span style="color:var(--text-mute);margin:0 2px;">:</span>${rs}`, progress };
  }

  function pnlHtml(pnl) {
    if (pnl == null || pnl === "") return `<td class="is-num">—</td>`;
    const n = Number(pnl);
    const color = n > 0 ? "var(--success)" : n < 0 ? "var(--danger)" : "var(--text)";
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    return `<td class="is-num" style="text-align:right;font-weight:700;color:${color}">${sign}${money(Math.abs(n))}</td>`;
  }

  function renderOpenTable(rows) {
    if (!rows.length) return `<div style="padding:40px;text-align:center;color:var(--text-mute);font-size:12.5px;">No open trades.</div>`;
    return `<div class="pt-table-wrap"><table class="pt-table" style="min-width:960px;">
      <thead><tr><th>Opened</th><th class="is-num">Duration</th><th>Symbol</th><th>Side</th><th class="is-num">Size</th><th class="is-num">Entry</th><th class="is-num">SL</th><th class="is-num">TP</th><th class="is-num" style="text-align:right;">P&amp;L</th><th>Reason</th><th></th></tr></thead>
      <tbody>${rows.map((r) => {
        const pnl = r.pnl ?? livePnlFor(r);
        const fmt = (v) => (v == null || v === "" ? "—" : v);
        return `<tr>
          <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.opened, r.opened_time)}</td>
          <td class="is-num" style="font-weight:600;" data-stat-duration="${r.opened_time || ""}">${r.opened_time ? fmtDuration(Math.floor(Date.now() / 1000) - r.opened_time) : "—"}</td>
          <td style="font-weight:700;">${r.symbol ?? "—"}</td><td>${sideChip(r.side)}</td>
          <td class="is-num">${r.volume ?? "—"}</td><td class="is-num">${r.entry ?? "—"}</td>
          <td class="is-num">${fmt(r.sl)}</td><td class="is-num">${fmt(r.tp)}</td>
          <td class="is-num" data-stat-pnl="${r.id}" style="text-align:right;font-weight:700;color:${Number(pnl) >= 0 ? "var(--success)" : Number(pnl) < 0 ? "var(--danger)" : "var(--text)"};">${(Number(pnl) >= 0 ? "+" : "") + money(pnl)}</td>
          <td>${r.reason ?? "open"}</td>
          <td style="text-align:center;"><button type="button" class="stat-close-btn" data-stat-close="${r.id}" aria-label="Close position" title="Close position"${closeBusy ? " disabled" : ""}>${statCloseIcon}</button></td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function renderClosedTable(rows) {
    if (!rows.length) return `<div style="padding:40px;text-align:center;color:var(--text-mute);font-size:12.5px;">No closed trades yet.</div>`;
    return `<div class="pt-table-wrap"><table class="pt-table" style="min-width:880px;">
      <thead><tr><th>Opened</th><th>Closed</th><th class="is-num">Duration</th><th>Symbol</th><th>Side</th><th class="is-num">Size</th><th class="is-num">Entry</th><th class="is-num">Exit</th><th class="is-num" style="text-align:right;">P&amp;L</th><th>Reason</th></tr></thead>
      <tbody>${rows.map((r) => {
        const dur = r.opened_time && r.closed_time ? fmtDuration(r.closed_time - r.opened_time) : "—";
        return `<tr>
          <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.opened, r.opened_time)}</td>
          <td class="is-num" style="color:var(--text-mute);white-space:nowrap;">${fmtTradeDate(r.closed, r.closed_time)}</td>
          <td class="is-num" style="font-weight:600;">${dur}</td>
          <td style="font-weight:700;">${r.symbol ?? "—"}</td><td>${sideChip(r.side)}</td>
          <td class="is-num">${r.volume ?? "—"}</td><td class="is-num">${r.entry ?? "—"}</td><td class="is-num">${r.exit ?? "—"}</td>
          ${pnlHtml(r.pnl)}<td>${r.reason ?? "—"}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  function ruleCard(title, limitPct, body, remaining, usedPct, limitPctFull, floorLabel, madeLabel) {
    return `<div class="dfx-rule-card">
      <div class="dfx-rule-head"><h3 class="dfx-rule-title">${title}</h3><span class="pt-chip" style="flex-shrink:0;">${pct(limitPct, 0)}</span></div>
      <p class="dfx-rule-body" style="margin-bottom:10px;">${body}</p>
      <div class="dfx-stat-big" style="margin:0 0 12px;"><div class="dfx-stat-big-value is-text">${money(remaining)}</div><div class="dfx-stat-big-caption">remaining</div></div>
      <div style="display:flex;gap:2px;margin-bottom:10px;">${segBar(usedPct, limitPctFull)}</div>
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span class="pt-num pt-dim" style="font-size:11.5px;">Used ${pct(usedPct, 2)}</span>
        <span class="pt-num pt-dim" style="font-size:11.5px;">${floorLabel}</span>
      </div>
      <div style="margin-top:6px;"><span class="pt-num pt-dim" style="font-size:11.5px;">${madeLabel}</span></div>
    </div>`;
  }

  function render(scope, a, snap) {
    const closed = snap?.closed || [];
    const open = snap?.open || [];
    const stats = computeTradeStats(closed);
    const start = Number(a.starting_balance || a.account_size || 0);
    const live = computeLive();
    const equity = live.equity;
    const totalPnl = equity - start;
    const eqPct = start ? ((equity - start) / start) * 100 : 0;
    const eqTrendClass = eqPct >= 0 ? "is-up" : "is-down";
    const eqTrendSign = eqPct >= 0 ? "▲" : "▼";
    const openPnlClass = live.open_pnl >= 0 ? "is-success" : live.open_pnl < 0 ? "is-danger" : "";
    const winRate = a.win_rate || (stats.count ? (stats.wins / stats.count) * 100 : 0);
    const targetAmt = start * (a.profit_target_pct / 100);
    const targetToGo = Math.max(0, targetAmt - totalPnl);
    const dailyAllowance = start * (a.max_daily_loss_pct / 100);
    const maxAllowance = start * (a.max_overall_loss_pct / 100);
    const dailyRemaining = Math.max(0, dailyAllowance - Math.max(0, start - equity));
    const maxRemaining = Math.max(0, maxAllowance - Math.max(0, start - equity));
    const dailyFloor = start - dailyAllowance;
    const maxFloor = start - maxAllowance;
    const highWater = Math.max(start, equity);
    const profDays = profitableDays(closed);
    const tDays = tradingDays(closed);
    const ringOffset = 314.159 * (1 - Math.min(1, profDays / 3));
    const cal = calendarGrid(closed, journalMonth, journalYear);
    const started = a.created_at ? new Date(a.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—";
    const shortSize = a.account_size_label.replace("$", "");
    const reset = athensMidnightCountdown();
    const dailyLossAmt = Math.max(0, Math.min(dailyAllowance, start - equity));
    const maxLossAmt = Math.max(0, start - equity);
    const profitMadePct = a.profit_target_pct ? Math.max(-100, (totalPnl / targetAmt) * 100) : 0;

    scope.innerHTML = `
      <header class="pt-header">
        <div class="pt-header-body">
          <span class="pt-header-tag"><span class="pt-chip-dot" style="background:var(--gold);"></span>Account<span style="color:var(--text-mute);margin:0 4px;font-weight:600;">·</span><span class="pt-num" style="letter-spacing:0;">#${a.account_number}</span></span>
          <h1 class="pt-header-title">${money(start)}<span style="color:var(--text-mute);font-weight:500;"> · </span>${shortSize}</h1>
          <p class="pt-header-sub">${a.phase_label} · started <strong style="color:var(--text);">${started}</strong> · <strong style="color:var(--text);" id="stat-trading-days">${tDays}</strong> trading days logged</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <span class="pt-chip pt-chip--warn"><span class="pt-chip-dot"></span>${a.phase_label}</span>
            <span class="pt-chip">${a.status.toUpperCase()}</span>
          </div>
        </div>
        <div class="pt-header-actions">
          <a class="pt-btn pt-btn--primary" href="trade.html"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>Trade now</a>
          <button type="button" class="pt-btn pt-btn--ghost" id="stat-refresh-btn">Refresh</button>
        </div>
      </header>

      <div class="pt-grid-stats pt-stagger">
        <div class="pt-stat-card pt-stat-card--gold"><div class="pt-stat-label">Equity</div><div class="pt-stat-value is-gold" id="stat-equity">${money(equity)}</div><div class="pt-stat-trend ${eqTrendClass}" id="stat-eq-trend">${eqTrendSign} ${pct(Math.abs(eqPct), 2)}<span class="pt-mute" style="margin-left:6px;font-weight:500;">vs starting</span></div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Balance</div><div class="pt-stat-value" id="stat-balance">${money(live.balance)}</div><div class="pt-stat-foot">Starting ${money(start)}</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Open P&amp;L</div><div class="pt-stat-value ${openPnlClass}" id="stat-open-pnl">${(live.open_pnl >= 0 ? "+" : "") + money(live.open_pnl)}</div><div class="pt-stat-foot" id="stat-open-count">${open.length} open trade${open.length === 1 ? "" : "s"}</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Win rate</div><div class="pt-stat-value ${winRate >= 50 ? "is-success" : ""}">${pct(winRate, 1)}</div><div class="pt-stat-foot">${stats.wins}W · ${stats.losses}L</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Profit factor</div><div class="pt-stat-value">${stats.profitFactor.toFixed(2)}</div><div class="pt-stat-foot">Expectancy ${money(stats.expectancy)}</div></div>
        <div class="pt-stat-card"><div class="pt-stat-label">Profit target</div><div class="pt-stat-value">${pct(a.profit_target_progress, 1)}</div><div class="pt-stat-foot">${money(targetToGo)} to go</div></div>
      </div>

      <div class="pt-split-2-1 pt-stagger">
        <div class="pt-card">
          <div class="pt-card-head"><div><h2 class="pt-section-title">Equity curve</h2><p class="pt-section-sub">Live snapshot of equity vs. starting balance</p></div><span class="pt-chip pt-chip--gold"><span class="pt-chip-dot"></span>Live</span></div>
          <div style="border-radius:12px;overflow:hidden;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);min-height:220px;padding:4px;" id="stat-equity-curve">${equityCurveSvg(start, closed, equity, dailyFloor, maxFloor)}</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;padding:12px 4px 4px;font-size:12px;color:var(--text-dim);">
            <span>Balance <strong class="pt-num" id="stat-curve-balance">${money(live.balance)}</strong></span>
            <span>Equity <strong class="pt-num" id="stat-curve-equity">${money(equity)}</strong></span>
            <span>Open P&amp;L <strong class="pt-num" id="stat-curve-pnl">${(live.open_pnl >= 0 ? "+" : "") + money(live.open_pnl)}</strong></span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="pt-card" style="padding:16px 18px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;">
              <div><h3 class="pt-section-title" style="font-size:15px;">Daily reset</h3><p class="pt-section-sub">Broker midnight rolls the daily floor</p></div>
            </div>
            <div class="dfx-subcard" style="margin-top:0;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
                <div style="display:flex;flex-direction:column;gap:4px;min-width:0;">
                  <span class="dfx-subcard-label" style="margin-bottom:0;">Daily limit resets in</span>
                  <span style="font-size:11.5px;color:var(--text-dim);">Floor <span class="pt-num pt-gold" style="font-weight:700;">${money(dailyFloor)}</span> · Allowance <span class="pt-num" style="color:var(--text);">${money(dailyAllowance)} (${pct(a.max_daily_loss_pct, 0)})</span></span>
                </div>
                <div style="display:flex;align-items:center;gap:14px;">
                  <span class="pt-num" id="stat-reset-timer" style="font-size:28px;font-weight:900;letter-spacing:0.02em;color:var(--gold);line-height:1;">${reset.text}</span>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                    <span style="font-size:9px;color:var(--text-mute);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Broker</span>
                    <span style="font-size:11px;font-weight:700;color:var(--text-dim);">Athens</span>
                    <span class="pt-num" style="font-size:10px;color:var(--text-mute);">00:00</span>
                  </div>
                </div>
              </div>
              <div style="margin-top:10px;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;"><div id="stat-reset-bar" style="height:100%;width:${reset.progress.toFixed(2)}%;background:linear-gradient(90deg,var(--gold-deep,#C99A2E),var(--gold));transition:width 1s linear;"></div></div>
            </div>
          </div>
          <div class="pt-card" style="padding:16px 18px 18px;display:flex;flex-direction:column;justify-content:space-between;">
            <div><h3 class="pt-section-title" style="font-size:15px;">Profitable days</h3></div>
            <div style="display:flex;align-items:center;justify-content:center;margin:8px 0;">
              <div style="position:relative;width:110px;height:110px;">
                <svg width="110" height="110" style="transform:rotate(-90deg);"><circle cx="55" cy="55" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10"></circle><circle cx="55" cy="55" r="50" fill="none" stroke="#f59e0b" stroke-width="10" stroke-linecap="round" stroke-dasharray="314.159" stroke-dashoffset="${ringOffset.toFixed(3)}" style="transition:stroke-dashoffset .9s var(--ease-out-quart,cubic-bezier(0.25,1,0.5,1));"></circle></svg>
                <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div class="pt-num" style="font-size:26px;font-weight:900;color:var(--text);letter-spacing:-0.02em;line-height:1;">${profDays}</div><div style="font-size:10px;font-weight:800;color:var(--text-mute);text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">days</div></div>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);">
              <div class="pt-mute" style="font-size:11.5px;">Required <strong class="pt-num" style="color:var(--text);">3</strong> days</div>
              <span class="pt-chip ${profDays >= 3 ? "pt-chip--success" : "pt-chip--warn"}"><span class="pt-chip-dot"></span>${profDays >= 3 ? "On target" : "Below target"}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 class="pt-section-title" style="margin-bottom:12px;">Risk rules</h2>
        <p class="pt-section-sub" style="margin-top:0;margin-bottom:16px;">Live limits enforced by the risk engine — bars show used / remaining headroom</p>
        <div class="dfx-masonry">
          ${ruleCard("Daily drawdown", a.max_daily_loss_pct, `vs midnight HW ${money(highWater)}`, dailyRemaining, a.daily_loss_used_pct, a.max_daily_loss_pct, `Floor ${money(dailyFloor)}`, `Used ${pct(a.daily_loss_used_pct, 2)}`)}
          ${ruleCard("Max drawdown", a.max_overall_loss_pct, `Hard stop on overall loss`, maxRemaining, a.overall_loss_used_pct, a.max_overall_loss_pct, `Floor ${money(maxFloor)}`, `Used ${pct(a.overall_loss_used_pct, 2)}`)}
          ${ruleCard("Profit target", a.profit_target_pct, `Reach ${money(targetAmt)} profit to clear this phase.`, targetToGo, Math.max(0, a.profit_target_progress), a.profit_target_pct || 100, `${money(targetToGo)} to go`, `Made ${pct(profitMadePct, 2)}`)}
        </div>
      </div>

      <div class="dfx-rule-card">
        <div class="dfx-rule-head"><h3 class="dfx-rule-title">Objectives</h3><span class="pt-chip pt-chip--gold" style="flex-shrink:0;">Rule engine</span></div>
        <div class="pt-card pt-card--flush">
          <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);"><h3 class="pt-section-title" style="font-size:15px;">Objectives</h3><p class="pt-section-sub">Live rule engine state · pass / fail per objective</p></div>
          <div class="pt-table-wrap"><table class="pt-table"><thead><tr><th>Trading objective</th><th class="is-num">Result</th><th style="text-align:center;">Status</th></tr></thead><tbody>
            <tr><td style="color:var(--gold);font-weight:600;">Minimum Profitable Days: 3</td><td class="is-num">${profDays}</td><td style="text-align:center;">${statusIcon(profDays >= 3)}</td></tr>
            <tr><td style="color:var(--gold);font-weight:600;">Maximum Trading Days: Unlimited</td><td class="is-num">∞</td><td style="text-align:center;">${statusIcon(true)}</td></tr>
            <tr><td style="color:var(--gold);font-weight:600;">Max Daily Loss: ${money(dailyAllowance)}</td><td class="is-num">${money(dailyLossAmt)} (${pct(a.daily_loss_used_pct, 0)})</td><td style="text-align:center;">${statusIcon(a.daily_loss_used_pct < a.max_daily_loss_pct)}</td></tr>
            <tr><td style="color:var(--gold);font-weight:600;">Max Loss: ${money(maxAllowance)}</td><td class="is-num">${totalPnl >= 0 ? money(totalPnl) : "-" + money(Math.abs(totalPnl))} (${pct(a.overall_loss_used_pct, 2)})</td><td style="text-align:center;">${statusIcon(a.overall_loss_used_pct < a.max_overall_loss_pct)}</td></tr>
            <tr><td style="color:var(--gold);font-weight:600;">Profit Target: ${money(targetAmt)}</td><td class="is-num">${totalPnl >= 0 ? money(totalPnl) : "-" + money(Math.abs(totalPnl))} (${pct(profitMadePct, 2)})</td><td style="text-align:center;">${statusIcon(totalPnl >= targetAmt)}</td></tr>
          </tbody></table></div>
        </div>
      </div>

      <div>
        <h2 class="pt-section-title">Statistics</h2>
        <p class="pt-section-sub" style="margin-top:0;margin-bottom:16px;">Closed-trade aggregates across this account</p>
        <div class="pt-grid-stats pt-stagger" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          <div class="pt-stat-card"><div class="pt-stat-label">Avg profit</div><div class="pt-stat-value is-success" style="font-size:20px;">${money(stats.avgProfit)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Avg loss</div><div class="pt-stat-value is-danger" style="font-size:20px;">${money(stats.avgLoss)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">No. of trades</div><div class="pt-stat-value" style="font-size:20px;">${stats.count}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Lots</div><div class="pt-stat-value" style="font-size:20px;">${stats.lots.toFixed(2)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Sharpe ratio</div><div class="pt-stat-value" style="font-size:20px;">${stats.sharpe.toFixed(2)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Avg RRR</div><div class="pt-stat-value" style="font-size:20px;">${stats.avgRrr.toFixed(2)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Expectancy</div><div class="pt-stat-value ${stats.expectancy >= 0 ? "is-success" : "is-danger"}" style="font-size:20px;">${money(stats.expectancy)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Avg trade time</div><div class="pt-stat-value" style="font-size:20px;">${fmtDuration(stats.avgDur)}</div></div>
          <div class="pt-stat-card"><div class="pt-stat-label">Best trade</div><div class="pt-stat-value is-success" style="font-size:20px;">${money(stats.best)}</div></div>
        </div>
      </div>

      <div class="pt-split-2-1 pt-stagger">
        <div class="pt-card pt-card--flush">
          <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);"><h3 class="pt-section-title" style="font-size:15px;">Daily summary</h3><p class="pt-section-sub">Last 14 trading days, newest first</p></div>
          <div class="pt-table-wrap"><table class="pt-table" style="min-width:400px;"><thead><tr><th>Date</th><th class="is-num">Trades</th><th class="is-num">Lots</th><th class="is-num" style="text-align:right;">Result</th></tr></thead><tbody>${dailySummaryRows(closed) || `<tr><td colspan="4" style="text-align:center;color:var(--text-mute);padding:24px;">No trading days yet.</td></tr>`}</tbody></table></div>
        </div>
        <div class="pt-card pt-card--flush" id="stat-open-trades-card">
          <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div><h3 class="pt-section-title" style="font-size:15px;">Open trades</h3><p class="pt-section-sub">Currently active positions</p></div>
            <span class="pt-chip" id="stat-open-chip">${open.length} active</span>
          </div>
          <div id="stat-open-wrap">${renderOpenTable(open)}</div>
        </div>
      </div>

      <div class="pt-card pt-card--flush">
        <div style="padding:18px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <div><h2 class="pt-section-title">Trading journal</h2><p class="pt-section-sub">Daily realised P&amp;L over the last 30 days</p></div>
          <div style="flex:1 1 0%;"></div>
          <div class="dfx-subtabs" style="margin:0;"><button type="button" class="dfx-subtab is-active" data-journal-tab="daily">Daily P&amp;L</button><button type="button" class="dfx-subtab" data-journal-tab="closed">Closed trades</button></div>
        </div>
        <div id="stat-journal-daily">
          <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <button type="button" class="pt-btn pt-btn--ghost" id="stat-journal-today" style="padding:6px 12px;font-size:12px;">Today</button>
            <button type="button" class="pt-btn pt-btn--ghost pt-btn--icon" id="stat-journal-prev" aria-label="Previous month"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
            <span id="stat-journal-label" style="font-size:14px;font-weight:800;font-family:var(--font-display);min-width:140px;text-align:center;color:var(--text);">${cal.label}</span>
            <button type="button" class="pt-btn pt-btn--ghost pt-btn--icon" id="stat-journal-next" aria-label="Next month"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
            <div style="margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
              <span style="font-size:11.5px;color:var(--text-mute);">Monthly</span>
              <span class="pt-num" id="stat-journal-monthly" style="font-size:14px;font-weight:800;color:${cal.monthlyColor};">${cal.monthlySign}${money(Math.abs(cal.monthly))}</span>
              <span class="pt-chip" id="stat-journal-days">Trading days: ${cal.tradingDays}</span>
            </div>
          </div>
          <div style="padding:14px 20px 20px;" id="stat-journal-grid">${cal.html}</div>
        </div>
        <div id="stat-journal-closed" style="display:none;">${renderClosedTable(closed)}</div>
      </div>

      <div class="pt-card pt-card--flush">
        <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);"><h3 class="pt-section-title" style="font-size:15px;">Trade history</h3><p class="pt-section-sub">All closed trades, sorted by time</p></div>
        ${renderClosedTable(closed)}
      </div>`;

    bindInteractions(scope);
    startResetTimer();
    paintLive();
  }

  function bindInteractions(scope) {
    scope.querySelector("#stat-refresh-btn")?.addEventListener("click", () => reloadSnapshot());
    scope.querySelectorAll("[data-journal-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        scope.querySelectorAll("[data-journal-tab]").forEach((b) => b.classList.toggle("is-active", b === btn));
        const tab = btn.dataset.journalTab;
        scope.querySelector("#stat-journal-daily").style.display = tab === "daily" ? "" : "none";
        scope.querySelector("#stat-journal-closed").style.display = tab === "closed" ? "" : "none";
      });
    });
    scope.querySelector("#stat-journal-prev")?.addEventListener("click", () => {
      journalMonth -= 1;
      if (journalMonth < 0) { journalMonth = 11; journalYear -= 1; }
      updateJournal(scope);
    });
    scope.querySelector("#stat-journal-next")?.addEventListener("click", () => {
      journalMonth += 1;
      if (journalMonth > 11) { journalMonth = 0; journalYear += 1; }
      updateJournal(scope);
    });
    scope.querySelector("#stat-journal-today")?.addEventListener("click", () => {
      const now = new Date();
      journalMonth = now.getMonth();
      journalYear = now.getFullYear();
      updateJournal(scope);
    });
    scope.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-stat-close]");
      if (!btn || closeBusy) return;
      closePosition(Number(btn.dataset.statClose));
    });
  }

  function updateJournal(scope) {
    const cal = calendarGrid(snapshot?.closed || [], journalMonth, journalYear);
    scope.querySelector("#stat-journal-label").textContent = cal.label;
    scope.querySelector("#stat-journal-monthly").textContent = `${cal.monthlySign}${money(Math.abs(cal.monthly))}`;
    scope.querySelector("#stat-journal-monthly").style.color = cal.monthlyColor;
    scope.querySelector("#stat-journal-days").textContent = `Trading days: ${cal.tradingDays}`;
    scope.querySelector("#stat-journal-grid").innerHTML = cal.html;
  }

  function startResetTimer() {
    if (resetTimer) clearInterval(resetTimer);
    resetTimer = setInterval(() => {
      const reset = athensMidnightCountdown();
      const el = document.getElementById("stat-reset-timer");
      const bar = document.getElementById("stat-reset-bar");
      if (el) el.innerHTML = reset.text;
      if (bar) bar.style.width = `${reset.progress.toFixed(2)}%`;
    }, 1000);
  }

  function paintLive() {
    if (!account) return;
    const live = computeLive();
    const start = Number(account.starting_balance || account.account_size || 0);
    const eqPct = start ? ((live.equity - start) / start) * 100 : 0;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("stat-equity", money(live.equity));
    set("stat-balance", money(live.balance));
    set("stat-curve-balance", money(live.balance));
    set("stat-curve-equity", money(live.equity));
    const pnlEl = document.getElementById("stat-open-pnl");
    if (pnlEl) {
      pnlEl.textContent = (live.open_pnl >= 0 ? "+" : "") + money(live.open_pnl);
      pnlEl.classList.toggle("is-success", live.open_pnl > 0);
      pnlEl.classList.toggle("is-danger", live.open_pnl < 0);
    }
    set("stat-curve-pnl", (live.open_pnl >= 0 ? "+" : "") + money(live.open_pnl));
    const trend = document.getElementById("stat-eq-trend");
    if (trend) {
      trend.className = `pt-stat-trend ${eqPct >= 0 ? "is-up" : "is-down"}`;
      trend.innerHTML = `${eqPct >= 0 ? "▲" : "▼"} ${pct(Math.abs(eqPct), 2)}<span class="pt-mute" style="margin-left:6px;font-weight:500;">vs starting</span>`;
    }
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
    liveRaf = requestAnimationFrame(() => { liveRaf = null; paintLive(); });
  }

  async function reloadSnapshot() {
    if (!accountId) return;
    snapshot = await window.AlphaFXApi.request(`/api/v1/trade/snapshot?account_id=${encodeURIComponent(accountId)}`);
    account = await window.AlphaFXApi.getAccount(accountId);
    const scope = document.querySelector(".pt-page.dfx-scope") || document.querySelector(".dfx-scope[data-screen-label='Account Detail']");
    if (scope) render(scope, account, snapshot);
    refreshLive();
  }

  async function closePosition(tradeId) {
    if (!accountId || closeBusy) return;
    closeBusy = true;
    document.querySelectorAll("[data-stat-close]").forEach((btn) => { btn.disabled = true; });
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

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    accountId = params.get("id");
    const scope = document.querySelector(".pt-page.dfx-scope") || document.querySelector(".dfx-scope[data-screen-label='Account Detail']");
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
      Object.values(symData.groups || {}).flat().forEach((item) => { symbolMeta[item.symbol] = item; });
      render(scope, a, snap);

      const symbols = [...new Set([...(snap.open || []), ...(snap.pending || [])].map((p) => p.symbol))];
      const allSymbols = Object.values(symData.groups || {}).flat().map((i) => i.symbol);
      window.AlphaFXQuotes.onTick(refreshLive);
      window.AlphaFXQuotes.connect(symbols.length ? [...new Set([...symbols, ...allSymbols])] : allSymbols);
      refreshLive();
      setInterval(reloadSnapshot, 15000);
    } catch (err) {
      scope.innerHTML = `<div class="pt-card" style="padding:32px;margin:28px;color:var(--danger);">${err.message}</div>`;
    }
  }

  window.addEventListener("alphafx:layout-ready", boot);
  window.addEventListener("alphafx:user", boot);
})();

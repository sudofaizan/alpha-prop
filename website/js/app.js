/**
 * AlphaFX Challenges UI — plan / size / phase switching
 */
(function () {
  const state = {
    program: "two-step",
    size: 2500,
    phaseIndex: 0,
  };

  const els = {
    programTabs: document.getElementById("program-tabs"),
    sizeTabs: document.getElementById("size-tabs"),
    globalRules: document.getElementById("global-rules"),
    planTitle: document.getElementById("plan-title"),
    planTagline: document.getElementById("plan-tagline"),
    planBadge: document.getElementById("plan-badge"),
    phaseTabs: document.getElementById("phase-tabs"),
    metricsBody: document.getElementById("metrics-body"),
    phaseNote: document.getElementById("phase-note"),
    programExtras: document.getElementById("program-extras"),
    ctaPrice: document.getElementById("cta-price"),
    ctaProgram: document.getElementById("cta-program"),
  };

  function renderProgramTabs() {
    if (!els.programTabs) return;
    els.programTabs.innerHTML = Object.values(ALPHAFX_PLANS.programs)
      .map(
        (p) =>
          `<button class="tab-btn${p.id === state.program ? " active" : ""}" data-program="${p.id}">${p.name}</button>`
      )
      .join("");
  }

  function renderSizeTabs() {
    if (!els.sizeTabs) return;
    els.sizeTabs.innerHTML = ALPHAFX_PLANS.accountSizes
      .map(
        (s) =>
          `<button class="size-btn${s === state.size ? " active" : ""}" data-size="${s}">${fmtMoney(s)}</button>`
      )
      .join("");
  }

  function renderGlobalRules() {
    if (!els.globalRules) return;
    const program = getProgram(state.program);
    const split =
      program.profitSplit ||
      ALPHAFX_PLANS.globalRules.find((r) => r.label.includes("Profit split"))?.value ||
      "80%";

    els.globalRules.innerHTML = ALPHAFX_PLANS.globalRules.map((rule) => {
      let value = rule.value;
      if (rule.label.includes("Profit split")) value = split;
      const cls = rule.highlight ? " gold" : "";
      return `
        <li>
          <span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>
          <span class="rule-label">${rule.label}</span>
          <span class="rule-value${cls}">${value}</span>
        </li>`;
    }).join("");

    if (els.programExtras && program.extras) {
      els.programExtras.innerHTML = program.extras
        .map(
          (e) =>
            `<li><span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span><span class="rule-label">${e}</span><span class="rule-value danger">Program</span></li>`
        )
        .join("");
    }
  }

  function renderPhaseTabs(program) {
    if (!els.phaseTabs) return;
    els.phaseTabs.innerHTML = program.phases
      .map(
        (ph, i) =>
          `<button class="phase-tab${i === state.phaseIndex ? " active" : ""}" data-phase="${i}">${ph.name}</button>`
      )
      .join("");
  }

  function renderMetrics(phase) {
    if (!els.metricsBody) return;
    const rows = [];

    if (phase.profitTargetPct != null) {
      rows.push({
        label: "Profit target",
        value: `${phase.profitTargetPct}% (${fmtMoney(pctOf(state.size, phase.profitTargetPct))})`,
        highlight: true,
      });
    } else {
      rows.push({ label: "Profit target", value: "None — stay within limits" });
    }

    rows.push(
      { label: "Max overall loss", value: `${phase.maxOverallLossPct}%`, highlight: true },
      { label: "Max daily loss", value: `${phase.maxDailyLossPct}%`, highlight: true },
      { label: "Leverage", value: `Up to ${phase.leverage}` },
      { label: "Drawdown type", value: phase.drawdownType }
    );

    if (phase.timeLimitDays) {
      rows.push({ label: "Time limit", value: `${phase.timeLimitDays} days`, highlight: true });
    }
    if (phase.minTradingDays) {
      rows.push({ label: "Min trading days", value: `${phase.minTradingDays} days` });
    }

    els.metricsBody.innerHTML = rows
      .map(
        (r) =>
          `<tr><td>${r.label}</td><td class="${r.highlight ? "highlight" : ""}">${r.value}</td></tr>`
      )
      .join("");

    if (els.phaseNote) {
      els.phaseNote.textContent = phase.notes || "";
      els.phaseNote.style.display = phase.notes ? "block" : "none";
    }
  }

  function renderPlanDetail() {
    const program = getProgram(state.program);
    if (!program) return;

    if (state.phaseIndex >= program.phases.length) state.phaseIndex = 0;

    const phase = program.phases[state.phaseIndex];
    const price = ALPHAFX_PLANS.pricing[state.size];

    if (els.planTitle) els.planTitle.textContent = `${fmtMoney(state.size)} ${program.name}`;
    if (els.planTagline) els.planTagline.textContent = program.tagline;
    if (els.planBadge) {
      els.planBadge.textContent = program.badge || "";
      els.planBadge.style.display = program.badge ? "inline-block" : "none";
    }

    renderPhaseTabs(program);
    renderMetrics(phase);

    if (els.ctaPrice) els.ctaPrice.textContent = `$${price}`;
    if (els.ctaProgram) {
      els.ctaProgram.textContent = `${fmtMoney(state.size)} · ${program.name}`;
    }
  }

  function render() {
    renderProgramTabs();
    renderSizeTabs();
    renderGlobalRules();
    renderPlanDetail();
  }

  function bindEvents() {
    els.programTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-program]");
      if (!btn) return;
      state.program = btn.dataset.program;
      state.phaseIndex = 0;
      render();
    });

    els.sizeTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-size]");
      if (!btn) return;
      state.size = parseInt(btn.dataset.size, 10);
      render();
    });

    els.phaseTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-phase]");
      if (!btn) return;
      state.phaseIndex = parseInt(btn.dataset.phase, 10);
      renderPlanDetail();
    });

    document.getElementById("buy-btn")?.addEventListener("click", () => {
      const program = getProgram(state.program);
      alert(
        `AlphaFX — Coming soon\n\n${fmtMoney(state.size)} ${program.name}\n$${ALPHAFX_PLANS.pricing[state.size]}\n\nCheckout not wired yet.`
      );
    });
  }

  const dateEl = document.getElementById("topbar-date");
  if (dateEl) {
    dateEl.textContent = new Date()
      .toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
      .toUpperCase();
  }

  if (document.body.dataset.page === "challenges") {
    render();
    bindEvents();
  }
})();

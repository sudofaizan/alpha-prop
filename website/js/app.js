/**
 * AlphaFX Challenges UI
 */
(function () {
  const state = {
    program: "two-step",
    size: 2500,
    phaseIndex: 0,
    couponApplied: false,
  };

  const els = {
    programTabs: document.getElementById("program-tabs"),
    sizeTabs: document.getElementById("size-tabs") || document.getElementById("header-center"),
    planIncludes: document.getElementById("plan-includes"),
    planPill: document.getElementById("plan-pill"),
    planTitle: document.getElementById("plan-title"),
    planTagline: document.getElementById("plan-tagline"),
    phaseTabs: document.getElementById("phase-tabs"),
    metricsBody: document.getElementById("metrics-body"),
    challengePrice: document.getElementById("challenge-price"),
    couponInput: document.getElementById("coupon-input"),
    referralInput: document.getElementById("referral-input"),
  };

  function renderProgramTabs() {
    if (!els.programTabs) return;
    els.programTabs.innerHTML = Object.values(ALPHAFX_PLANS.programs)
      .map(
        (p) =>
          `<button type="button" class="tab-btn${p.id === state.program ? " active" : ""}" data-program="${p.id}">${p.name}</button>`
      )
      .join("");
  }

  function renderSizeTabs() {
    const container = document.getElementById("size-tabs") || document.getElementById("header-center");
    if (!container) return;
    container.innerHTML = ALPHAFX_PLANS.accountSizes
      .map(
        (s) =>
          `<button type="button" class="size-btn${s === state.size ? " active" : ""}" data-size="${s}">${fmtMoney(s)}</button>`
      )
      .join("");
    els.sizeTabs = container;
  }

  window.renderChallengeSizeTabs = renderSizeTabs;

  function renderPlanIncludes() {
    if (!els.planIncludes) return;
    els.planIncludes.innerHTML = ALPHAFX_PLANS.planIncludes
      .map((item) => {
        const label = item.sub
          ? `${item.text} <span class="rule-sub">${item.sub}</span>`
          : item.text;
        return `
          <li>
            <span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>
            <span class="include-text${item.highlight ? " gold" : ""}">${label}</span>
          </li>`;
      })
      .join("");
  }

  function renderPhaseTabs(program) {
    if (!els.phaseTabs) return;
    els.phaseTabs.innerHTML = program.phases
      .map(
        (ph, i) =>
          `<button type="button" class="phase-tab${i === state.phaseIndex ? " active" : ""}" data-phase="${i}">${ph.name}</button>`
      )
      .join("");
  }

  function metricRow(label, valueHtml) {
    return `<tr><td>${label}</td><td>${valueHtml}</td></tr>`;
  }

  function renderMetrics(phase) {
    if (!els.metricsBody) return;
    const rows = [];

    if (phase.profitTargetPct != null) {
      const dollars = pctOf(state.size, phase.profitTargetPct);
      rows.push(
        metricRow(
          "Profit target",
          `<span class="metric-val">${phase.profitTargetPct}%</span><span class="metric-badge">$${dollars}</span>`
        )
      );
    }

    rows.push(
      metricRow("Max overall loss", `<span class="metric-val">${phase.maxOverallLossPct}%</span>`),
      metricRow("Max daily loss", `<span class="metric-val">${phase.maxDailyLossPct}%</span>`),
      metricRow("Leverage", `<span class="metric-val">Up to ${phase.leverage}</span>`)
    );

    if (phase.profitSplit) {
      rows.push(metricRow("Profit split", `<span class="metric-val gold">${phase.profitSplit}</span>`));
    }

    rows.push(metricRow("Drawdown type", `<span class="metric-val">${phase.drawdownType}</span>`));

    if (phase.profitableDays) {
      rows.push(metricRow("Profitable days", `<span class="metric-val">min ${phase.profitableDays}</span>`));
    }

    els.metricsBody.innerHTML = rows.join("");
  }

  function updatePrice() {
    const price = getPrice(state.size, state.couponApplied);
    if (els.challengePrice) {
      els.challengePrice.textContent = `$${price.toFixed(2)}`;
    }
  }

  function renderPlanDetail() {
    const program = getProgram(state.program);
    if (!program) return;

    if (state.phaseIndex >= program.phases.length) state.phaseIndex = 0;
    const phase = program.phases[state.phaseIndex];

    if (els.planPill) {
      els.planPill.textContent = `${program.slug} · ${fmtMoney(state.size)}`;
    }
    if (els.planTitle) {
      els.planTitle.textContent = `${fmtMoney(state.size)} ${program.name}`;
    }
    if (els.planTagline) els.planTagline.textContent = program.tagline;

    renderPhaseTabs(program);
    renderMetrics(phase);
    updatePrice();
  }

  function render() {
    renderProgramTabs();
    renderSizeTabs();
    renderPlanIncludes();
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
      renderPlanDetail();
      renderSizeTabs();
    });

    els.phaseTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-phase]");
      if (!btn) return;
      state.phaseIndex = parseInt(btn.dataset.phase, 10);
      renderPlanDetail();
    });

    document.getElementById("coupon-apply")?.addEventListener("click", () => {
      const code = (els.couponInput?.value || "").trim().toUpperCase();
      if (code === ALPHAFX_PLANS.promoCode || code === "ALPHA30") {
        state.couponApplied = true;
        updatePrice();
      } else if (code) {
        alert("Invalid coupon code");
      }
    });

    document.getElementById("referral-apply")?.addEventListener("click", () => {
      const ref = (els.referralInput?.value || "").trim();
      if (ref) alert("Referral applied (demo)");
    });

    document.getElementById("copy-promo")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(ALPHAFX_PLANS.promoCode);
    });

    document.getElementById("pay-btn")?.addEventListener("click", () => {
      const terms = document.getElementById("terms-check");
      const refund = document.getElementById("refund-check");
      if (!terms?.checked || !refund?.checked) {
        alert("Please accept the Terms and Refund Policy.");
        return;
      }
      const program = getProgram(state.program);
      alert(
        `AlphaFX — Coming soon\n\n${fmtMoney(state.size)} ${program.name}\n${els.challengePrice?.textContent}\n\nPayment not wired yet.`
      );
    });

    document.getElementById("promo-buy")?.addEventListener("click", () => {
      if (els.couponInput) els.couponInput.value = ALPHAFX_PLANS.promoCode;
      state.couponApplied = true;
      updatePrice();
      document.getElementById("pay-btn")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  const dateEl = document.getElementById("page-date");
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
    state.couponApplied = true;
    updatePrice();
  }
})();

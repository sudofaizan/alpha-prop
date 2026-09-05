/**
 * Capiffy-style Challenges — loads catalog from API, mock Pay now creates account
 */
(function () {
  if (document.body.dataset.page !== "challenges") return;

  const PROGRAM_ORDER = ["one-step", "two-step", "three-step", "instant"];
  let PLANS = null;

  const state = {
    program: "two-step",
    size: 2500,
    phaseIndex: 0,
    couponApplied: false,
  };

  let root;
  let els = {};

  function fmtMoney(n) {
    if (n >= 1000) {
      const k = n / 1000;
      return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
    }
    return `$${n}`;
  }

  function fmtMoneyFull(n) {
    return `$${Number(n).toLocaleString("en-US")}`;
  }

  function pctOf(balance, pct) {
    return Math.round(balance * (pct / 100));
  }

  function getProgram(id) {
    return PLANS?.programs?.[id];
  }

  function getSizes(programId) {
    return programId === "instant" ? PLANS.instantSizes : PLANS.evalSizes;
  }

  function getBasePrice(size, programId) {
    if (programId === "instant") return PLANS.instantPricing[size] ?? PLANS.instantPricing[2500];
    if (programId === "three-step") return PLANS.threeStepPricing[size] ?? PLANS.threeStepPricing[2500];
    return PLANS.evalPricing[size] ?? PLANS.evalPricing[2500];
  }

  function getPrice(size, programId, discounted) {
    const base = getBasePrice(size, programId);
    if (discounted) return Math.round(base * (1 - PLANS.promoDiscount) * 100) / 100;
    return base;
  }

  function showMostChosen(programId, size) {
    return programId === "instant" && size === 1500;
  }

  function cacheElements() {
    root = document.querySelector(".dfx-scope[data-screen-label='Buy challenge']");
    if (!root) return false;
    els = {
      typeTabs: root.querySelector(".pg-typetabs"),
      typeIndicator: root.querySelector(".pg-typetabs-indicator"),
      sizeStrip: root.querySelector(".pg-sizestrip"),
      benefitsList: root.querySelector(".pg-benefits-list"),
      planTag: root.querySelector(".pg-plan-tag"),
      planChosen: root.querySelector(".pg-plan-chosen"),
      planName: root.querySelector(".pg-plan-name"),
      planSub: root.querySelector(".pg-plan-sub"),
      phaseTabs: root.querySelector(".hp-pm-phasetabs"),
      planRules: root.querySelector(".pg-plan-rules"),
      couponInput: root.querySelector(".hp-pm-code-input"),
      couponApply: root.querySelectorAll(".hp-pm-code-apply")[0],
      referralInput: root.querySelectorAll(".hp-pm-code-input")[1],
      referralApply: root.querySelectorAll(".hp-pm-code-apply")[1],
      termsChecks: root.querySelectorAll(".hp-pm-terms input[type='checkbox']"),
      payPrice: root.querySelector(".hp-pm-pay-price"),
      payBtn: root.querySelector(".hp-pm-cta"),
    };
    return true;
  }

  function programIndex() {
    return PROGRAM_ORDER.indexOf(state.program);
  }

  function setActiveButtons(buttons, activeIndex, activeClass) {
    buttons.forEach((btn, i) => {
      const on = i === activeIndex;
      btn.classList.toggle(activeClass || "is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function renderTypeIndicator() {
    if (!els.typeIndicator) return;
    els.typeIndicator.style.transform = `translateX(${programIndex() * 100}%)`;
  }

  function renderSizeStrip() {
    if (!els.sizeStrip) return;
    const sizes = getSizes(state.program);
    if (!sizes.includes(state.size)) state.size = sizes[0];
    els.sizeStrip.innerHTML = sizes
      .map(
        (s) =>
          `<button type="button" class="pg-sizedot${s === state.size ? " is-active" : ""}" data-size="${s}">${fmtMoney(s)}</button>`
      )
      .join("");
  }

  function benefitItem(item, delay) {
    return `<li style="animation-delay:${delay}ms;"><span class="pg-benefits-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M2 8l4 4 8-8"></path></svg></span><span><span class="pg-benefits-hi">${item.hi}</span>${item.rest ? ` <span class="pg-benefits-rest">${item.rest}</span>` : ""}</span></li>`;
  }

  function renderIncludes() {
    if (!els.benefitsList) return;
    const items = PLANS.includes[state.program] || [];
    els.benefitsList.innerHTML = items.map((item, i) => benefitItem(item, i * 45)).join("");
  }

  function ruleRow(label, valueHtml, gold) {
    return `<div class="pg-plan-row"><dt>${label}</dt><dd${gold ? ' class="is-gold"' : ""}>${valueHtml}</dd></div>`;
  }

  function renderRules(phase) {
    if (!els.planRules) return;
    const rows = [];
    if (phase.profitTargetPct != null) {
      rows.push(ruleRow("Profit target", `${phase.profitTargetPct}%<span class="pg-target-amt">${fmtMoneyFull(pctOf(state.size, phase.profitTargetPct))}</span>`, true));
    }
    rows.push(ruleRow("Max overall loss", `${phase.maxOverallLossPct}%`, false));
    rows.push(ruleRow("Max daily loss", `${phase.maxDailyLossPct}%`, false));
    rows.push(ruleRow("Leverage", `Up to ${phase.leverage}`, false));
    if (phase.profitSplit) rows.push(ruleRow("Profit split", `<span class="is-gold">${phase.profitSplit}</span>`, true));
    rows.push(ruleRow("Drawdown type", phase.drawdownType, false));
    if (phase.profitableDays) rows.push(ruleRow("Profitable days", `min ${phase.profitableDays}`, false));
    if (phase.consistencyLimit) rows.push(ruleRow("Consistency limit", phase.consistencyLimit, false));
    els.planRules.innerHTML = rows.join("");
  }

  function renderPhaseTabs(program) {
    if (!els.phaseTabs) return;
    els.phaseTabs.innerHTML = program.phases
      .map(
        (ph, i) =>
          `<button type="button" class="hp-pm-phase${i === state.phaseIndex ? " is-active" : ""}" data-phase="${i}">${ph.name}</button>`
      )
      .join("");
  }

  function renderPlanCard() {
    const program = getProgram(state.program);
    if (!program) return;
    if (state.phaseIndex >= program.phases.length) state.phaseIndex = 0;
    const phase = program.phases[state.phaseIndex];
    if (els.planTag) els.planTag.textContent = `${program.slug} · ${fmtMoney(state.size)}`;
    if (els.planChosen) els.planChosen.style.display = showMostChosen(state.program, state.size) ? "" : "none";
    if (els.planName) els.planName.textContent = `${fmtMoney(state.size)} ${program.name}`;
    if (els.planSub) els.planSub.textContent = program.tagline;
    renderPhaseTabs(program);
    renderRules(phase);
    updatePrice();
  }

  function updatePrice() {
    if (els.payPrice) els.payPrice.textContent = `$${getPrice(state.size, state.program, state.couponApplied).toFixed(2)}`;
  }

  function updatePayButton() {
    if (!els.payBtn) return;
    const termsOk = [...els.termsChecks].every((c) => c.checked);
    els.payBtn.disabled = !termsOk;
  }

  function updateApplyButtons() {
    if (els.couponApply && els.couponInput) els.couponApply.disabled = !(els.couponInput.value || "").trim();
    if (els.referralApply && els.referralInput) els.referralApply.disabled = !(els.referralInput.value || "").trim();
  }

  function renderAll() {
    setActiveButtons([...(els.typeTabs?.querySelectorAll(".pg-typetab") || [])], programIndex());
    renderTypeIndicator();
    renderSizeStrip();
    renderIncludes();
    renderPlanCard();
    updateApplyButtons();
    updatePayButton();
  }

  function bindEvents() {
    els.typeTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest(".pg-typetab");
      if (!btn) return;
      state.program = PROGRAM_ORDER[[...els.typeTabs.querySelectorAll(".pg-typetab")].indexOf(btn)];
      state.phaseIndex = 0;
      renderAll();
    });
    els.sizeStrip?.addEventListener("click", (e) => {
      const btn = e.target.closest(".pg-sizedot");
      if (!btn) return;
      state.size = parseInt(btn.dataset.size, 10);
      renderSizeStrip();
      renderPlanCard();
    });
    els.phaseTabs?.addEventListener("click", (e) => {
      const btn = e.target.closest(".hp-pm-phase");
      if (!btn) return;
      state.phaseIndex = parseInt(btn.dataset.phase, 10);
      renderPlanCard();
    });
    els.couponInput?.addEventListener("input", updateApplyButtons);
    els.referralInput?.addEventListener("input", updateApplyButtons);
    els.couponApply?.addEventListener("click", () => {
      const code = (els.couponInput?.value || "").trim().toUpperCase();
      if ([PLANS.promoCode, "ALPHA38", "CAP38"].includes(code)) {
        state.couponApplied = true;
        updatePrice();
      } else if (code) alert("Invalid coupon code");
    });
    els.referralApply?.addEventListener("click", () => {
      if ((els.referralInput?.value || "").trim()) alert("Referral saved (demo)");
    });
    els.termsChecks.forEach((cb) => cb.addEventListener("change", updatePayButton));
    els.payBtn?.addEventListener("click", async () => {
      els.payBtn.disabled = true;
      try {
        const result = await window.AlphaFXApi.checkoutPay({
          program: state.program,
          account_size: state.size,
          coupon_code: state.couponApplied ? (els.couponInput?.value || PLANS.promoCode).trim() : null,
          referral_code: (els.referralInput?.value || "").trim() || null,
          terms_accepted: true,
          refund_accepted: true,
        });
        window.location.href = `accounts.html?purchased=${result.account_number}`;
      } catch (err) {
        alert(err.message || "Payment failed");
        updatePayButton();
      }
    });
  }

  async function init() {
    try {
      PLANS = await window.AlphaFXApi.getPlans();
      window.ALPHAFX_PLANS = PLANS;
    } catch {
      alert("Could not load plans. Is the API running?");
      return;
    }
    if (!cacheElements()) return;
    renderAll();
    bindEvents();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

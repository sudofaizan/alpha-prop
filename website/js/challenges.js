/**
 * Capiffy-style Challenges — loads catalog from API, routes to checkout page
 */
(function () {
  if (document.body.dataset.page !== "challenges") return;

  const P = window.AlphaFXPlansPricing;
  let PLANS = null;

  const state = {
    program: "two-step",
    size: 2500,
    phaseIndex: 0,
    couponApplied: false,
  };

  let root;
  let els = {};

  function getProgram(id) {
    return PLANS?.programs?.[id];
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
    return P.PROGRAM_ORDER.indexOf(state.program);
  }

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const program = P.normalizeProgramId(params.get("program"));
    const size = parseInt(params.get("size"), 10);
    const coupon = (params.get("coupon") || "").trim();

    if (program) state.program = program;
    if (Number.isFinite(size) && size > 0) state.size = size;

    const sizes = P.getSizes(PLANS, state.program);
    if (!sizes.includes(state.size)) state.size = sizes[0];

    if (coupon && els.couponInput) {
      els.couponInput.value = coupon;
      if (P.isValidCoupon(PLANS, coupon)) state.couponApplied = true;
    }
  }

  function checkoutUrl() {
    const url = new URL("checkout.html", window.location.href);
    url.searchParams.set("program", state.program);
    url.searchParams.set("size", String(state.size));
    const coupon = state.couponApplied
      ? (els.couponInput?.value || PLANS.promoCode).trim()
      : (els.couponInput?.value || "").trim();
    if (coupon && P.isValidCoupon(PLANS, coupon)) url.searchParams.set("coupon", coupon.toUpperCase());
    const referral = (els.referralInput?.value || "").trim();
    if (referral) url.searchParams.set("referral", referral);
    return url.pathname + url.search;
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
    const sizes = P.getSizes(PLANS, state.program);
    if (!sizes.includes(state.size)) state.size = sizes[0];
    els.sizeStrip.innerHTML = sizes
      .map(
        (s) =>
          `<button type="button" class="pg-sizedot${s === state.size ? " is-active" : ""}" data-size="${s}">${P.fmtMoney(s)}</button>`
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
      rows.push(ruleRow("Profit target", `${phase.profitTargetPct}%<span class="pg-target-amt">${P.fmtMoneyFull(P.pctOf(state.size, phase.profitTargetPct))}</span>`, true));
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
    if (els.planTag) els.planTag.textContent = `${program.slug} · ${P.fmtMoney(state.size)}`;
    if (els.planChosen) els.planChosen.style.display = showMostChosen(state.program, state.size) ? "" : "none";
    if (els.planName) els.planName.textContent = `${P.fmtMoney(state.size)} ${program.name}`;
    if (els.planSub) els.planSub.textContent = program.tagline;
    renderPhaseTabs(program);
    renderRules(phase);
    updatePrice();
  }

  function updatePrice() {
    if (els.payPrice) els.payPrice.textContent = `$${P.getPrice(PLANS, state.size, state.program, state.couponApplied).toFixed(2)}`;
  }

  function updatePayButton() {
    if (!els.payBtn) return;
    const checks = root?.querySelectorAll(".hp-pm-terms input[type='checkbox']") || els.termsChecks;
    const termsOk = [...checks].every((c) => c.checked);
    els.payBtn.disabled = !termsOk;
    els.payBtn.setAttribute("aria-disabled", termsOk ? "false" : "true");
    els.payBtn.classList.toggle("is-ready", termsOk);
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
      state.program = P.PROGRAM_ORDER[[...els.typeTabs.querySelectorAll(".pg-typetab")].indexOf(btn)];
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
      if (P.isValidCoupon(PLANS, code)) {
        state.couponApplied = true;
        updatePrice();
      } else if (code) alert("Invalid coupon code");
    });
    els.referralApply?.addEventListener("click", () => {
      if ((els.referralInput?.value || "").trim()) alert("Referral saved (demo)");
    });
    root.querySelectorAll('.hp-pm-terms-row input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", updatePayButton);
    });
    els.payBtn?.addEventListener("click", () => {
      window.location.href = checkoutUrl();
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
    readUrlParams();
    if (els.payBtn) {
      els.payBtn.innerHTML =
        'Continue to payment<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"></path></svg>';
    }
    renderAll();
    bindEvents();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

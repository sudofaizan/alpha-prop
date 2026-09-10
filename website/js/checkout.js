/**
 * Checkout / payment page — order review + mock payment.
 */
(function () {
  if (document.body.dataset.page !== "checkout") return;

  const P = window.AlphaFXPlansPricing;
  let PLANS = null;

  const state = {
    program: "two-step",
    size: 2500,
    couponApplied: false,
    couponCode: "",
    referralCode: "",
    paymentMethod: "card",
  };

  const els = {};

  function cacheElements() {
    Object.assign(els, {
      main: document.getElementById("checkout-main"),
      success: document.getElementById("checkout-success"),
      successMsg: document.getElementById("checkout-success-msg"),
      successTrade: document.getElementById("checkout-success-trade"),
      successAccounts: document.getElementById("checkout-success-accounts"),
      backLink: document.getElementById("checkout-back-link"),
      planSub: document.getElementById("checkout-plan-sub"),
      summaryLines: document.getElementById("checkout-summary-lines"),
      basePrice: document.getElementById("checkout-base-price"),
      totalPrice: document.getElementById("checkout-total-price"),
      payPrice: document.getElementById("checkout-pay-price"),
      couponInput: document.getElementById("checkout-coupon"),
      couponApply: document.getElementById("checkout-coupon-apply"),
      referralInput: document.getElementById("checkout-referral"),
      referralApply: document.getElementById("checkout-referral-apply"),
      terms: document.getElementById("checkout-terms"),
      refund: document.getElementById("checkout-refund"),
      payBtn: document.getElementById("checkout-pay-btn"),
      error: document.getElementById("checkout-error"),
      methods: [...document.querySelectorAll(".checkout-method")],
    });
  }

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const program = P.normalizeProgramId(params.get("program"));
    const size = parseInt(params.get("size"), 10);
    const coupon = (params.get("coupon") || "").trim();
    const referral = (params.get("referral") || "").trim();

    if (program) state.program = program;
    if (Number.isFinite(size) && size > 0) state.size = size;

    const sizes = P.getSizes(PLANS, state.program);
    if (!sizes.includes(state.size)) state.size = sizes[0];

    if (coupon) {
      els.couponInput.value = coupon;
      if (P.isValidCoupon(PLANS, coupon)) {
        state.couponApplied = true;
        state.couponCode = coupon.toUpperCase();
      }
    }
    if (referral) {
      els.referralInput.value = referral;
      state.referralCode = referral;
    }

    if (els.backLink) {
      const back = new URL("index.html", window.location.href);
      back.searchParams.set("program", state.program);
      back.searchParams.set("size", String(state.size));
      if (state.couponCode) back.searchParams.set("coupon", state.couponCode);
      els.backLink.href = back.pathname + back.search;
    }
  }

  function summaryRow(label, value, gold) {
    return `<div class="checkout-summary-row"><dt>${label}</dt><dd${gold ? ' class="is-gold"' : ""}>${value}</dd></div>`;
  }

  function renderSummary() {
    const program = PLANS.programs[state.program];
    if (!program) return;

    const phase = program.phases[0];
    const base = P.getBasePrice(PLANS, state.size, state.program);
    const total = P.getPrice(PLANS, state.size, state.program, state.couponApplied);

    els.planSub.textContent = `${program.name} · ${P.fmtMoney(state.size)} simulated account`;

    const lines = [
      summaryRow("Program", program.name),
      summaryRow("Account size", P.fmtMoneyFull(state.size)),
      summaryRow("Phase", phase.name),
    ];
    if (phase.profitTargetPct != null) {
      lines.push(summaryRow("Profit target", `${phase.profitTargetPct}% (${P.fmtMoneyFull(P.pctOf(state.size, phase.profitTargetPct))})`, true));
    }
    lines.push(summaryRow("Max daily loss", `${phase.maxDailyLossPct}%`));
    lines.push(summaryRow("Max overall loss", `${phase.maxOverallLossPct}%`));
    lines.push(summaryRow("Payment method", state.paymentMethod === "crypto" ? "Crypto" : "Card"));

    if (state.couponApplied) {
      lines.push(summaryRow("Discount", `${Math.round(PLANS.promoDiscount * 100)}% off (${state.couponCode})`, true));
    }

    els.summaryLines.innerHTML = lines.join("");

    const priceText = `$${total.toFixed(2)}`;
    els.totalPrice.textContent = priceText;
    els.payPrice.textContent = priceText;

    if (state.couponApplied && base > total) {
      els.basePrice.hidden = false;
      els.basePrice.textContent = `$${base.toFixed(2)}`;
    } else {
      els.basePrice.hidden = true;
    }
  }

  function updatePayButton() {
    const ready = els.terms.checked && els.refund.checked;
    els.payBtn.disabled = !ready;
    els.payBtn.setAttribute("aria-disabled", ready ? "false" : "true");
    els.payBtn.classList.toggle("is-ready", ready);
  }

  function updateApplyButtons() {
    els.couponApply.disabled = !(els.couponInput.value || "").trim();
    els.referralApply.disabled = !(els.referralInput.value || "").trim();
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.classList.add("is-visible");
  }

  function clearError() {
    els.error.textContent = "";
    els.error.classList.remove("is-visible");
  }

  function showSuccess(result) {
    els.main.hidden = true;
    els.success.hidden = false;
    els.successMsg.textContent = `Account #${result.account_number} is ready. You paid $${Number(result.amount).toFixed(2)}.`;
    const accountsUrl = `accounts.html?purchased=${encodeURIComponent(result.account_number)}`;
    els.successAccounts.href = accountsUrl;
    els.successTrade.href = "trade.html";
    window.history.replaceState({}, "", accountsUrl);
  }

  function bindEvents() {
    els.methods.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.paymentMethod = btn.dataset.method || "card";
        els.methods.forEach((b) => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-checked", active ? "true" : "false");
        });
        renderSummary();
      });
    });

    els.couponInput.addEventListener("input", updateApplyButtons);
    els.referralInput.addEventListener("input", updateApplyButtons);

    els.couponApply.addEventListener("click", () => {
      const code = (els.couponInput.value || "").trim();
      if (P.isValidCoupon(PLANS, code)) {
        state.couponApplied = true;
        state.couponCode = code.toUpperCase();
        clearError();
        renderSummary();
      } else if (code) {
        state.couponApplied = false;
        state.couponCode = "";
        showError("Invalid coupon code");
        renderSummary();
      }
    });

    els.referralApply.addEventListener("click", () => {
      state.referralCode = (els.referralInput.value || "").trim();
      if (state.referralCode) window.AlphaFXToast?.show?.("Referral code saved", "success");
    });

    els.terms.addEventListener("change", updatePayButton);
    els.refund.addEventListener("change", updatePayButton);

    els.payBtn.addEventListener("click", async () => {
      clearError();
      els.payBtn.disabled = true;
      els.payBtn.textContent = "Processing…";
      const body = {
        program: state.program,
        account_size: state.size,
        coupon_code: state.couponApplied ? state.couponCode || els.couponInput.value.trim() : null,
        referral_code: state.referralCode || null,
        terms_accepted: true,
        refund_accepted: true,
      };
      try {
        if (state.paymentMethod === "crypto") {
          const session = await window.AlphaFXApi.createCryptoSession(body);
          window.location.href = `payment.html?session=${encodeURIComponent(session.session_id)}`;
          return;
        }
        const result = await window.AlphaFXApi.checkoutPay(body);
        window.AlphaFXToast?.show?.(result.message || "Payment successful", "success");
        showSuccess(result);
      } catch (err) {
        showError(err.message || "Payment failed. Please try again.");
        updatePayButton();
        els.payBtn.innerHTML =
          'Complete purchase<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"></path></svg>';
      }
    });
  }

  async function init() {
    cacheElements();
    try {
      PLANS = await window.AlphaFXApi.getPlans();
    } catch {
      showError("Could not load plans. Is the API running?");
      return;
    }

    readUrlParams();
    bindEvents();
    updateApplyButtons();
    updatePayButton();
    renderSummary();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

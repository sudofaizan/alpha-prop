/**
 * Shared plan catalog helpers — used by challenges + checkout pages.
 */
(function () {
  const PROGRAM_ORDER = ["one-step", "two-step", "three-step", "instant"];

  const PROGRAM_ALIASES = {
    "one-step": "one-step",
    one_step: "one-step",
    ONE_PHASE: "one-step",
    "ONE-STEP": "one-step",
    onestep: "one-step",
    "two-step": "two-step",
    two_step: "two-step",
    TWO_PHASE: "two-step",
    "TWO-STEP": "two-step",
    twostep: "two-step",
    "three-step": "three-step",
    three_step: "three-step",
    THREE_PHASE: "three-step",
    "THREE-STEP": "three-step",
    threestep: "three-step",
    instant: "instant",
    INSTANT: "instant",
  };

  function normalizeProgramId(raw) {
    if (!raw) return null;
    const key = String(raw).trim();
    return PROGRAM_ALIASES[key] || (PROGRAM_ORDER.includes(key) ? key : null);
  }

  function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1000) {
      const k = v / 1000;
      return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
    }
    return `$${v}`;
  }

  function fmtMoneyFull(n) {
    return `$${Number(n).toLocaleString("en-US")}`;
  }

  function getSizes(plans, programId) {
    return programId === "instant" ? plans.instantSizes : plans.evalSizes;
  }

  function getBasePrice(plans, size, programId) {
    if (programId === "instant") return plans.instantPricing[size] ?? plans.instantPricing[2500];
    if (programId === "three-step") return plans.threeStepPricing[size] ?? plans.threeStepPricing[2500];
    return plans.evalPricing[size] ?? plans.evalPricing[2500];
  }

  function getPrice(plans, size, programId, discounted) {
    const base = getBasePrice(plans, size, programId);
    if (discounted) return Math.round(base * (1 - plans.promoDiscount) * 100) / 100;
    return base;
  }

  function isValidCoupon(plans, code) {
    const c = String(code || "").trim().toUpperCase();
    return [plans.promoCode, "ALPHA38", "CAP38"].includes(c);
  }

  function pctOf(balance, pct) {
    return Math.round(balance * (pct / 100));
  }

  window.AlphaFXPlansPricing = {
    PROGRAM_ORDER,
    normalizeProgramId,
    fmtMoney,
    fmtMoneyFull,
    getSizes,
    getBasePrice,
    getPrice,
    isValidCoupon,
    pctOf,
  };
})();

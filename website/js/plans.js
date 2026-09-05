/**
 * AlphaFX Challenge Plans — Capiffy-aligned data
 */
const ALPHAFX_PLANS = {
  evalSizes: [2500, 5000, 10000, 25000, 50000, 100000],
  instantSizes: [1500, 2500, 5000, 10000, 25000],

  evalPricing: {
    2500: 33,
    5000: 55,
    10000: 99,
    25000: 199,
    50000: 349,
    100000: 549,
  },

  instantPricing: {
    1500: 24,
    2500: 33,
    5000: 55,
    10000: 99,
    25000: 199,
  },

  threeStepPricing: {
    2500: 28,
    5000: 48,
    10000: 89,
    25000: 179,
    50000: 319,
    100000: 499,
  },

  promoDiscount: 0.38,
  promoCode: "ALPHA38",

  includes: {
    "one-step": [
      { hi: "80% profit split", rest: "on funded payouts" },
      { hi: "Trailing", rest: "drawdown" },
      { hi: "On-demand", rest: "crypto payouts, no cycle" },
      { hi: "$50 minimum", rest: "withdrawal" },
      { hi: "Profitable days", rest: "min 3 required" },
      { hi: "Max floating loss", rest: "1.5% of balance · once funded" },
      { hi: "Trading through News", rest: "Not allowed" },
      { hi: "Weekend holding", rest: "Not allowed" },
      { hi: "No time limit", rest: "on the evaluation" },
      { hi: "Swap-free", rest: "no overnight swap, every instrument" },
    ],
    "two-step": [
      { hi: "80% profit split", rest: "on funded payouts" },
      { hi: "Static", rest: "drawdown" },
      { hi: "14-day payout cycle", rest: "crypto payouts" },
      { hi: "$50 minimum", rest: "withdrawal" },
      { hi: "Profitable days", rest: "min 3 required" },
      { hi: "Max floating loss", rest: "1.5% of balance · once funded" },
      { hi: "Trading through News", rest: "Not allowed" },
      { hi: "Weekend holding", rest: "Not allowed" },
      { hi: "No time limit", rest: "on the evaluation" },
      { hi: "Swap-free", rest: "no overnight swap, every instrument" },
    ],
    "three-step": [
      { hi: "80% profit split", rest: "on funded payouts" },
      { hi: "Static", rest: "drawdown" },
      { hi: "On-demand", rest: "crypto payouts, no cycle" },
      { hi: "$50 minimum", rest: "withdrawal" },
      { hi: "Profitable days", rest: "min 3 required" },
      { hi: "Max floating loss", rest: "1.5% of balance · once funded" },
      { hi: "Trading through News", rest: "Not allowed" },
      { hi: "Weekend holding", rest: "Not allowed" },
      { hi: "No time limit", rest: "on the evaluation" },
      { hi: "Swap-free", rest: "no overnight swap, every instrument" },
    ],
    instant: [
      { hi: "80% profit split", rest: "on funded payouts" },
      { hi: "Trailing", rest: "drawdown" },
      { hi: "On-demand", rest: "crypto payouts, no cycle" },
      { hi: "$50 minimum", rest: "withdrawal" },
      { hi: "Consistency rule", rest: "20% from best day" },
      { hi: "Max floating loss", rest: "1.5% of balance" },
      { hi: "Min 2-minute hold", rest: "per trade" },
      { hi: "Trading through News", rest: "Not allowed" },
      { hi: "Weekend holding", rest: "Not allowed" },
      { hi: "Swap-free", rest: "no overnight swap, every instrument" },
    ],
  },

  programs: {
    "one-step": {
      id: "one-step",
      name: "One-step",
      slug: "ONE-STEP",
      tagline: "Single evaluation phase. Hit the target — get funded.",
      phases: [
        {
          name: "Phase 1",
          profitTargetPct: 10,
          maxDailyLossPct: 3,
          maxOverallLossPct: 7,
          leverage: "1:100",
          drawdownType: "Trailing",
          profitableDays: 3,
        },
        {
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 3,
          maxOverallLossPct: 7,
          leverage: "1:100",
          drawdownType: "Trailing",
          profitSplit: "80%",
          profitableDays: 3,
        },
      ],
    },

    "two-step": {
      id: "two-step",
      name: "Two-step",
      slug: "TWO-STEP",
      tagline: "Two evaluation phases. A balanced route to funded.",
      phases: [
        {
          name: "Phase 1",
          profitTargetPct: 5,
          maxDailyLossPct: 4,
          maxOverallLossPct: 10,
          leverage: "1:100",
          drawdownType: "Static",
          profitableDays: 3,
        },
        {
          name: "Phase 2",
          profitTargetPct: 8,
          maxDailyLossPct: 4,
          maxOverallLossPct: 10,
          leverage: "1:100",
          drawdownType: "Static",
          profitableDays: 3,
        },
        {
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 4,
          maxOverallLossPct: 10,
          leverage: "1:100",
          drawdownType: "Static",
          profitSplit: "80%",
          profitableDays: 3,
        },
      ],
    },

    "three-step": {
      id: "three-step",
      name: "Three-step",
      slug: "THREE-STEP",
      tagline: "Three-phase route for cautious risk takers.",
      phases: [
        {
          name: "Phase 1",
          profitTargetPct: 5,
          maxDailyLossPct: 5,
          maxOverallLossPct: 5,
          leverage: "1:100",
          drawdownType: "Static",
          profitableDays: 3,
        },
        {
          name: "Phase 2",
          profitTargetPct: 5,
          maxDailyLossPct: 5,
          maxOverallLossPct: 5,
          leverage: "1:100",
          drawdownType: "Static",
          profitableDays: 3,
        },
        {
          name: "Phase 3",
          profitTargetPct: 4,
          maxDailyLossPct: 4,
          maxOverallLossPct: 4,
          leverage: "1:100",
          drawdownType: "Static",
          profitableDays: 3,
        },
        {
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 4,
          maxOverallLossPct: 8,
          leverage: "1:100",
          drawdownType: "Static",
          profitSplit: "80%",
          profitableDays: 3,
        },
      ],
    },

    instant: {
      id: "instant",
      name: "Instant",
      slug: "INSTANT",
      tagline: "Skip the eval. Get funded from day one.",
      phases: [
        {
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 3,
          maxOverallLossPct: 5,
          leverage: "1:100",
          drawdownType: "Trailing",
          profitSplit: "80%",
          consistencyLimit: "20% from best day",
        },
      ],
    },
  },
};

function fmtMoney(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${n}`;
}

function fmtMoneyFull(n) {
  return `$${n.toLocaleString("en-US")}`;
}

function pctOf(balance, pct) {
  return Math.round(balance * (pct / 100));
}

function getProgram(id) {
  return ALPHAFX_PLANS.programs[id];
}

function getSizes(programId) {
  return programId === "instant" ? ALPHAFX_PLANS.instantSizes : ALPHAFX_PLANS.evalSizes;
}

function getBasePrice(size, programId) {
  if (programId === "instant") return ALPHAFX_PLANS.instantPricing[size] ?? ALPHAFX_PLANS.instantPricing[2500];
  if (programId === "three-step") return ALPHAFX_PLANS.threeStepPricing[size] ?? ALPHAFX_PLANS.threeStepPricing[2500];
  return ALPHAFX_PLANS.evalPricing[size] ?? ALPHAFX_PLANS.evalPricing[2500];
}

function getPrice(size, programId, discounted) {
  const base = getBasePrice(size, programId);
  if (discounted) return Math.round(base * (1 - ALPHAFX_PLANS.promoDiscount) * 100) / 100;
  return base;
}

function showMostChosen(programId, size) {
  return programId === "instant" && size === 1500;
}

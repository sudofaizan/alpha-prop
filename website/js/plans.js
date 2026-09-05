/**
 * AlphaFX Challenge Plans — strict rules designed for ~90% eval failure rate.
 * Static drawdown, consistency caps, news/weekend bans, floating loss limits.
 */
const ALPHAFX_PLANS = {
  accountSizes: [2500, 5000, 10000, 25000, 50000, 100000],

  pricing: {
    2500: 39,
    5000: 69,
    10000: 129,
    25000: 279,
    50000: 449,
    100000: 699,
  },

  /** Shared restrictions across all programs */
  globalRules: [
    { label: "Profit split (funded)", value: "80%", highlight: true },
    { label: "Drawdown type", value: "Static — based on starting balance" },
    { label: "Payout cycle", value: "14 days · crypto / bank" },
    { label: "Minimum withdrawal", value: "$50" },
    { label: "Profitable days required", value: "Min 5 days · 0.4% each" },
    { label: "Max floating loss (funded)", value: "1.5% of balance" },
    { label: "Consistency rule", value: "Best day ≤ 30% of total profit" },
    { label: "News trading", value: "Not allowed · ±10 min high impact" },
    { label: "Weekend holding", value: "Not allowed · close Fri 20:00 UTC" },
    { label: "Inactivity breach", value: "Fail after 10 days with no trades" },
    { label: "Max risk per trade", value: "2% of account balance" },
    { label: "EAs / bots", value: "Not allowed unless pre-approved" },
    { label: "Hedging / copy trading", value: "Prohibited across accounts" },
    { label: "Swap", value: "Swap-free on all instruments" },
  ],

  programs: {
    "one-step": {
      id: "one-step",
      name: "One-step",
      tagline: "Single evaluation. Highest bar, fastest funded path.",
      badge: "HARDEST",
      phases: [
        {
          id: "phase1",
          name: "Evaluation",
          profitTargetPct: 10,
          maxDailyLossPct: 4,
          maxOverallLossPct: 8,
          leverage: "1:50",
          drawdownType: "Static",
          timeLimitDays: 45,
          minTradingDays: 5,
          notes: "Hit 10% without breaching daily or overall limits. Timer starts on first trade.",
        },
        {
          id: "funded",
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 3,
          maxOverallLossPct: 6,
          leverage: "1:50",
          drawdownType: "Static",
          timeLimitDays: null,
          minTradingDays: 5,
          notes: "Live funded account. Soft breach = instant termination.",
        },
      ],
      extras: [
        "Single 10% profit target — no second chance phase",
        "Tightest overall loss at 8% during eval",
        "45-day hard deadline from first trade",
      ],
    },

    "two-step": {
      id: "two-step",
      name: "Two-step",
      tagline: "Two evaluation phases. Balanced route — still brutal.",
      badge: "POPULAR",
      phases: [
        {
          id: "phase1",
          name: "Phase 1",
          profitTargetPct: 6,
          maxDailyLossPct: 4,
          maxOverallLossPct: 10,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: 60,
          minTradingDays: 5,
          notes: "Prove consistency before Phase 2 unlock.",
        },
        {
          id: "phase2",
          name: "Phase 2",
          profitTargetPct: 5,
          maxDailyLossPct: 3,
          maxOverallLossPct: 8,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: 60,
          minTradingDays: 5,
          notes: "Lower target but tighter daily loss. Phase resets profit counter.",
        },
        {
          id: "funded",
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 3,
          maxOverallLossPct: 6,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: null,
          minTradingDays: 5,
          notes: "80% profit split. Max floating loss 1.5% enforced live.",
        },
      ],
      extras: [
        "Must pass both phases sequentially — fail either = restart",
        "Phase 2 daily loss drops to 3%",
        "Combined eval targets: 11% total profit required",
      ],
    },

    "three-step": {
      id: "three-step",
      name: "Three-step",
      tagline: "Three gates. Lowest per-phase target, highest attrition.",
      badge: "EXTREME",
      phases: [
        {
          id: "phase1",
          name: "Phase 1",
          profitTargetPct: 5,
          maxDailyLossPct: 4,
          maxOverallLossPct: 10,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: 45,
          minTradingDays: 4,
          notes: "Warm-up phase. One bad day can end the run.",
        },
        {
          id: "phase2",
          name: "Phase 2",
          profitTargetPct: 5,
          maxDailyLossPct: 3,
          maxOverallLossPct: 8,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: 45,
          minTradingDays: 4,
          notes: "Profit counter resets. Overall loss tightens.",
        },
        {
          id: "phase3",
          name: "Phase 3",
          profitTargetPct: 4,
          maxDailyLossPct: 3,
          maxOverallLossPct: 6,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: 45,
          minTradingDays: 4,
          notes: "Final gate. 6% max loss — no room for drawdown.",
        },
        {
          id: "funded",
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 2.5,
          maxOverallLossPct: 5,
          leverage: "1:100",
          drawdownType: "Static",
          timeLimitDays: null,
          minTradingDays: 5,
          notes: "75% profit split. Strictest funded rules.",
        },
      ],
      extras: [
        "Three separate profit targets — 14% cumulative",
        "Funded daily loss capped at 2.5%",
        "75% profit split (lower than other programs)",
      ],
    },

    instant: {
      id: "instant",
      name: "Instant",
      tagline: "Skip evaluation. Pay premium. Survive the funded rules.",
      badge: "INSTANT",
      phases: [
        {
          id: "funded",
          name: "Funded",
          profitTargetPct: null,
          maxDailyLossPct: 3,
          maxOverallLossPct: 5,
          leverage: "1:30",
          drawdownType: "Static",
          timeLimitDays: null,
          minTradingDays: 5,
          notes: "No eval — straight to live. 70% split. Leverage capped at 1:30.",
        },
      ],
      extras: [
        "No evaluation phase — immediate funded access",
        "70% profit split (lowest tier)",
        "5% max overall loss from day one",
        "2× challenge fee · no free retry",
      ],
      profitSplit: "70%",
    },
  },
};

/** Format currency */
function fmtMoney(n) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `$${n}`;
}

/** Calculate dollar amount from pct */
function pctOf(balance, pct) {
  return Math.round(balance * (pct / 100));
}

/** Get program by id */
function getProgram(id) {
  return ALPHAFX_PLANS.programs[id];
}

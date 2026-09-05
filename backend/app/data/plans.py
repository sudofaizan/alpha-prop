"""Challenge catalog — single source of truth for API + checkout."""

PROMO_CODE = "ALPHA38"
PROMO_DISCOUNT = 0.38

EVAL_SIZES = [2500, 5000, 10000, 25000, 50000, 100000]
INSTANT_SIZES = [1500, 2500, 5000, 10000, 25000]

EVAL_PRICING = {2500: 33, 5000: 55, 10000: 99, 25000: 199, 50000: 349, 100000: 549}
INSTANT_PRICING = {1500: 24, 2500: 33, 5000: 55, 10000: 99, 25000: 199}
THREE_STEP_PRICING = {2500: 28, 5000: 48, 10000: 89, 25000: 179, 50000: 319, 100000: 499}

INCLUDES = {
    "one-step": [
        {"hi": "80% profit split", "rest": "on funded payouts"},
        {"hi": "Trailing", "rest": "drawdown"},
        {"hi": "On-demand", "rest": "crypto payouts, no cycle"},
        {"hi": "$50 minimum", "rest": "withdrawal"},
        {"hi": "Profitable days", "rest": "min 3 required"},
        {"hi": "Max floating loss", "rest": "1.5% of balance · once funded"},
        {"hi": "Trading through News", "rest": "Not allowed"},
        {"hi": "Weekend holding", "rest": "Not allowed"},
        {"hi": "No time limit", "rest": "on the evaluation"},
        {"hi": "Swap-free", "rest": "no overnight swap, every instrument"},
    ],
    "two-step": [
        {"hi": "80% profit split", "rest": "on funded payouts"},
        {"hi": "Static", "rest": "drawdown"},
        {"hi": "14-day payout cycle", "rest": "crypto payouts"},
        {"hi": "$50 minimum", "rest": "withdrawal"},
        {"hi": "Profitable days", "rest": "min 3 required"},
        {"hi": "Max floating loss", "rest": "1.5% of balance · once funded"},
        {"hi": "Trading through News", "rest": "Not allowed"},
        {"hi": "Weekend holding", "rest": "Not allowed"},
        {"hi": "No time limit", "rest": "on the evaluation"},
        {"hi": "Swap-free", "rest": "no overnight swap, every instrument"},
    ],
    "three-step": [
        {"hi": "80% profit split", "rest": "on funded payouts"},
        {"hi": "Static", "rest": "drawdown"},
        {"hi": "On-demand", "rest": "crypto payouts, no cycle"},
        {"hi": "$50 minimum", "rest": "withdrawal"},
        {"hi": "Profitable days", "rest": "min 3 required"},
        {"hi": "Max floating loss", "rest": "1.5% of balance · once funded"},
        {"hi": "Trading through News", "rest": "Not allowed"},
        {"hi": "Weekend holding", "rest": "Not allowed"},
        {"hi": "No time limit", "rest": "on the evaluation"},
        {"hi": "Swap-free", "rest": "no overnight swap, every instrument"},
    ],
    "instant": [
        {"hi": "80% profit split", "rest": "on funded payouts"},
        {"hi": "Trailing", "rest": "drawdown"},
        {"hi": "On-demand", "rest": "crypto payouts, no cycle"},
        {"hi": "$50 minimum", "rest": "withdrawal"},
        {"hi": "Consistency rule", "rest": "20% from best day"},
        {"hi": "Max floating loss", "rest": "1.5% of balance"},
        {"hi": "Min 2-minute hold", "rest": "per trade"},
        {"hi": "Trading through News", "rest": "Not allowed"},
        {"hi": "Weekend holding", "rest": "Not allowed"},
        {"hi": "Swap-free", "rest": "no overnight swap, every instrument"},
    ],
}

PROGRAMS = {
    "one-step": {
        "id": "one-step",
        "name": "One-step",
        "slug": "ONE-STEP",
        "tagline": "Single evaluation phase. Hit the target — get funded.",
        "phases": [
            {"name": "Phase 1", "profitTargetPct": 10, "maxDailyLossPct": 3, "maxOverallLossPct": 7, "leverage": "1:100", "drawdownType": "Trailing", "profitableDays": 3},
            {"name": "Funded", "profitTargetPct": None, "maxDailyLossPct": 3, "maxOverallLossPct": 7, "leverage": "1:100", "drawdownType": "Trailing", "profitSplit": "80%", "profitableDays": 3},
        ],
    },
    "two-step": {
        "id": "two-step",
        "name": "Two-step",
        "slug": "TWO-STEP",
        "tagline": "Two evaluation phases. A balanced route to funded.",
        "phases": [
            {"name": "Phase 1", "profitTargetPct": 5, "maxDailyLossPct": 4, "maxOverallLossPct": 10, "leverage": "1:100", "drawdownType": "Static", "profitableDays": 3},
            {"name": "Phase 2", "profitTargetPct": 8, "maxDailyLossPct": 4, "maxOverallLossPct": 10, "leverage": "1:100", "drawdownType": "Static", "profitableDays": 3},
            {"name": "Funded", "profitTargetPct": None, "maxDailyLossPct": 4, "maxOverallLossPct": 10, "leverage": "1:100", "drawdownType": "Static", "profitSplit": "80%", "profitableDays": 3},
        ],
    },
    "three-step": {
        "id": "three-step",
        "name": "Three-step",
        "slug": "THREE-STEP",
        "tagline": "Three-phase route for cautious risk takers.",
        "phases": [
            {"name": "Phase 1", "profitTargetPct": 5, "maxDailyLossPct": 5, "maxOverallLossPct": 5, "leverage": "1:100", "drawdownType": "Static", "profitableDays": 3},
            {"name": "Phase 2", "profitTargetPct": 5, "maxDailyLossPct": 5, "maxOverallLossPct": 5, "leverage": "1:100", "drawdownType": "Static", "profitableDays": 3},
            {"name": "Phase 3", "profitTargetPct": 4, "maxDailyLossPct": 4, "maxOverallLossPct": 4, "leverage": "1:100", "drawdownType": "Static", "profitableDays": 3},
            {"name": "Funded", "profitTargetPct": None, "maxDailyLossPct": 4, "maxOverallLossPct": 8, "leverage": "1:100", "drawdownType": "Static", "profitSplit": "80%", "profitableDays": 3},
        ],
    },
    "instant": {
        "id": "instant",
        "name": "Instant",
        "slug": "INSTANT",
        "tagline": "Skip the eval. Get funded from day one.",
        "phases": [
            {"name": "Funded", "profitTargetPct": None, "maxDailyLossPct": 3, "maxOverallLossPct": 5, "leverage": "1:100", "drawdownType": "Trailing", "profitSplit": "80%", "consistencyLimit": "20% from best day"},
        ],
    },
}


def get_sizes(program_id: str) -> list[int]:
    return INSTANT_SIZES if program_id == "instant" else EVAL_SIZES


def get_base_price(size: int, program_id: str) -> float:
    if program_id == "instant":
        return float(INSTANT_PRICING.get(size, INSTANT_PRICING[2500]))
    if program_id == "three-step":
        return float(THREE_STEP_PRICING.get(size, THREE_STEP_PRICING[2500]))
    return float(EVAL_PRICING.get(size, EVAL_PRICING[2500]))


def get_price(size: int, program_id: str, coupon_code: str | None = None) -> float:
    base = get_base_price(size, program_id)
    if coupon_code and coupon_code.upper() in (PROMO_CODE, "CAP38"):
        return round(base * (1 - PROMO_DISCOUNT), 2)
    return base


def program_label(program_id: str) -> str:
    names = {"one-step": "1-Phase", "two-step": "2-Phase", "three-step": "3-Phase", "instant": "Instant"}
    return names.get(program_id, program_id)


def initial_phase(program_id: str) -> str:
    return "Funded" if program_id == "instant" else "Phase 1"


def initial_phase_number(program_id: str) -> int:
    return 0 if program_id != "instant" else 0


def get_catalog() -> dict:
    return {
        "evalSizes": EVAL_SIZES,
        "instantSizes": INSTANT_SIZES,
        "evalPricing": EVAL_PRICING,
        "instantPricing": INSTANT_PRICING,
        "threeStepPricing": THREE_STEP_PRICING,
        "promoCode": PROMO_CODE,
        "promoDiscount": PROMO_DISCOUNT,
        "includes": INCLUDES,
        "programs": PROGRAMS,
    }

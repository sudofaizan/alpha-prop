"""Standard chart timeframes (MT5-compatible)."""

TIMEFRAMES: dict[str, dict[str, int | str]] = {
    "M1": {"label": "1m", "step": 60},
    "M5": {"label": "5m", "step": 300},
    "M15": {"label": "15m", "step": 900},
    "M30": {"label": "30m", "step": 1800},
    "H1": {"label": "1H", "step": 3600},
    "H4": {"label": "4H", "step": 14400},
    "D1": {"label": "1D", "step": 86400},
    "W1": {"label": "1W", "step": 604800},
    "MN1": {"label": "1M", "step": 2592000},
}

DEFAULT_TIMEFRAME = "M1"


def normalize_timeframe(value: str | None) -> str | None:
    if not value:
        return None
    tf = value.strip().upper()
    aliases = {
        "1": "M1",
        "5": "M5",
        "15": "M15",
        "30": "M30",
        "60": "H1",
        "240": "H4",
        "1440": "D1",
        "10080": "W1",
        "43200": "MN1",
    }
    tf = aliases.get(tf, tf)
    return tf if tf in TIMEFRAMES else None


def step_seconds(timeframe: str) -> int:
    tf = normalize_timeframe(timeframe) or DEFAULT_TIMEFRAME
    return int(TIMEFRAMES[tf]["step"])


def list_timeframes() -> list[dict[str, str | int]]:
    return [{"id": k, "label": v["label"], "step": v["step"]} for k, v in TIMEFRAMES.items()]

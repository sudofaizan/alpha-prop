"""Fetch cached MT5 OHLC bars from the tick hub HTTP API."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from app.config import settings
from app.data.timeframes import normalize_timeframe, step_seconds

log = logging.getLogger(__name__)


def _bucket_time(ts: int, timeframe: str) -> int:
    if timeframe == "MN1":
        d = datetime.fromtimestamp(ts, tz=timezone.utc)
        return int(datetime(d.year, d.month, 1, tzinfo=timezone.utc).timestamp())
    if timeframe == "W1":
        d = datetime.fromtimestamp(ts, tz=timezone.utc)
        weekday = d.weekday()
        start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        return int((start.timestamp()) - weekday * 86400)
    step = step_seconds(timeframe)
    return (ts // step) * step


def aggregate_bars(bars: list[dict], timeframe: str) -> list[dict]:
    """Build OHLC bars for `timeframe` from finer-grained bars (usually M1)."""
    tf = normalize_timeframe(timeframe) or "M1"
    if not bars:
        return []
    buckets: dict[int, dict] = {}
    for bar in sorted(bars, key=lambda b: int(b["time"])):
        t = _bucket_time(int(bar["time"]), tf)
        o, h, l, c = float(bar["open"]), float(bar["high"]), float(bar["low"]), float(bar["close"])
        if t not in buckets:
            buckets[t] = {"time": t, "open": o, "high": h, "low": l, "close": c}
        else:
            b = buckets[t]
            b["high"] = max(b["high"], h)
            b["low"] = min(b["low"], l)
            b["close"] = c
    return [buckets[t] for t in sorted(buckets)]


def _fetch_from_hub(symbol: str, timeframe: str, limit: int) -> tuple[list[dict], str] | None:
    base = (settings.tick_hub_http or "").strip()
    if not base:
        return None

    params = urllib.parse.urlencode(
        {
            "symbol": symbol.upper(),
            "timeframe": timeframe.upper(),
            "limit": str(limit),
        }
    )
    url = f"{base.rstrip('/')}/bars?{params}"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        log.debug("Bar cache fetch failed for %s %s: %s", symbol, timeframe, exc)
        return None

    bars = data.get("bars") or []
    source = data.get("source") or "none"
    if len(bars) < 2 or source != "mt5":
        return None
    return bars, "mt5"


def fetch_bars(symbol: str, timeframe: str = "M1", limit: int = 300) -> tuple[list[dict], str] | None:
    """
    Return (bars, source) from tick hub.
    source is 'mt5' for native or M1-aggregated bars.
    """
    tf = normalize_timeframe(timeframe) or "M1"
    native = _fetch_from_hub(symbol, tf, limit)
    if native:
        return native

    if tf == "M1":
        return None

    # Build higher TF from cached M1 when native bars not published yet
    step = step_seconds(tf)
    m1_needed = min(500, max(limit * max(1, step // 60), 60))
    m1 = _fetch_from_hub(symbol, "M1", m1_needed)
    if not m1:
        return None

    m1_bars, _ = m1
    agg = aggregate_bars(m1_bars, tf)
    if len(agg) < 2:
        return None
    return agg[-limit:], "mt5"

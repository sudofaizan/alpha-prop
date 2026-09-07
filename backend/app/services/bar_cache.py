"""Fetch cached MT5 OHLC bars from the tick hub HTTP API."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from app.config import settings

log = logging.getLogger(__name__)


def fetch_bars(symbol: str, timeframe: str = "M1", limit: int = 300) -> tuple[list[dict], str] | None:
    """
    Return (bars, source) from tick hub, or None if unavailable.
    bars: [{time, open, high, low, close}, ...]
    """
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
        log.debug("Bar cache fetch failed for %s: %s", symbol, exc)
        return None

    bars = data.get("bars") or []
    source = data.get("source") or "none"
    if len(bars) < 2 or source != "mt5":
        return None
    return bars, "mt5"

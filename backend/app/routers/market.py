import random
import time

from fastapi import APIRouter, Query

from app.data.symbols import SYMBOL_GROUPS, resolve_symbol
from app.services.bar_cache import fetch_bars

router = APIRouter(prefix="/market", tags=["market"])

_VOL = {
    "EURUSD": 0.0004,
    "GBPUSD": 0.0005,
    "USDJPY": 0.03,
    "XAUUSD": 1.5,
    "BTCUSD": 40.0,
}


@router.get("/symbols")
def list_symbols():
    return {"groups": SYMBOL_GROUPS}


def _round_bars(bars: list[dict], digits: int) -> list[dict]:
    out = []
    for b in bars:
        out.append(
            {
                "time": int(b["time"]),
                "open": round(float(b["open"]), digits),
                "high": round(float(b["high"]), digits),
                "low": round(float(b["low"]), digits),
                "close": round(float(b["close"]), digits),
            }
        )
    return out


def _synthetic_bars(sym: str, digits: int, limit: int, anchor: float) -> list[dict]:
    """Fallback random-walk bars when MT5 history is not available."""
    now = int(time.time())
    step = 60
    vol = _VOL.get(sym, 0.001)
    end_price = float(anchor)

    closes = [end_price]
    for _ in range(limit - 1):
        closes.append(closes[-1] + random.uniform(-vol, vol))
    closes.reverse()

    bars = []
    for i in range(limit):
        t = now - (limit - i) * step
        c = closes[i]
        o = c + random.uniform(-vol * 0.4, vol * 0.4)
        h = max(o, c) + abs(random.uniform(0, vol * 0.5))
        l = min(o, c) - abs(random.uniform(0, vol * 0.5))
        bars.append(
            {
                "time": t,
                "open": round(o, digits),
                "high": round(h, digits),
                "low": round(l, digits),
                "close": round(c, digits),
            }
        )

    if bars:
        bars[-1]["close"] = round(end_price, digits)
        bars[-1]["high"] = round(max(bars[-1]["high"], end_price), digits)
        bars[-1]["low"] = round(min(bars[-1]["low"], end_price), digits)

    current_bucket = (now // step) * step
    spread = vol * 0.2
    p = round(end_price, digits)
    hi = round(end_price + spread, digits)
    lo = round(max(end_price - spread, 0.0001), digits)
    if not bars or bars[-1]["time"] < current_bucket:
        bars.append({"time": current_bucket, "open": p, "high": hi, "low": lo, "close": p})
    elif bars[-1]["time"] == current_bucket:
        b = bars[-1]
        b["high"] = round(max(b["high"], hi), digits)
        b["low"] = round(min(b["low"], lo), digits)
        b["close"] = p

    return bars


@router.get("/history")
def market_history(
    symbol: str,
    timeframe: str = "M1",
    limit: int = Query(default=300, le=500),
    anchor: float | None = Query(default=None, description="Live mid — used for synthetic fallback only"),
):
    """
    OHLC bar history. Prefer real MT5 bars from tick hub (AlphaFXBridge EA).
    Falls back to synthetic bars anchored to live price when MT5 cache is empty.
    """
    meta = resolve_symbol(symbol)
    if not meta:
        return {"symbol": symbol.upper(), "timeframe": timeframe, "source": "none", "bars": []}

    sym = meta["symbol"]
    digits = meta["digits"]
    tf = timeframe.upper()

    cached = fetch_bars(sym, tf, limit)
    if cached:
        bars, source = cached
        bars = _round_bars(bars[-limit:], digits)
        return {"symbol": sym, "timeframe": tf, "source": source, "bars": bars}

    if anchor is None or anchor <= 0:
        return {"symbol": sym, "timeframe": tf, "source": "none", "bars": []}

    bars = _synthetic_bars(sym, digits, limit, float(anchor))
    return {"symbol": sym, "timeframe": tf, "source": "synthetic", "anchor": float(anchor), "bars": bars}

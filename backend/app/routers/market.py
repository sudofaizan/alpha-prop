import random
import time

from fastapi import APIRouter, Query

from app.data.symbols import SYMBOL_GROUPS, resolve_symbol

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


@router.get("/history")
def market_history(
    symbol: str,
    timeframe: str = "M1",
    limit: int = Query(default=300, le=500),
    anchor: float | None = Query(default=None, description="Live mid price — bars end near this value"),
):
    """Synthetic OHLC ending at live anchor; includes current minute candle."""
    meta = resolve_symbol(symbol)
    if not meta:
        return {"symbol": symbol.upper(), "timeframe": timeframe, "bars": []}

    sym = meta["symbol"]
    if anchor is None or anchor <= 0:
        return {"symbol": sym, "timeframe": timeframe, "bars": []}

    digits = meta["digits"]
    now = int(time.time())
    step = 60 if timeframe.upper() in ("M1", "1") else 300
    vol = _VOL.get(sym, 0.001)
    end_price = float(anchor)

    # Random walk ending at anchor (oldest → newest)
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

    # Force last historical bar to anchor
    if bars:
        bars[-1]["close"] = round(end_price, digits)
        bars[-1]["high"] = round(max(bars[-1]["high"], end_price), digits)
        bars[-1]["low"] = round(min(bars[-1]["low"], end_price), digits)

    # Current in-progress minute candle (seed with bid/ask spread around anchor)
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

    return {"symbol": sym, "timeframe": timeframe, "anchor": end_price, "bars": bars}

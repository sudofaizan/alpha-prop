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
    """OHLC bootstrap anchored to live price until MT5 bar history is wired."""
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
    price = end_price
    bars = []
    for i in range(limit):
        t = now - (limit - i) * step
        c = price
        o = price + random.uniform(-vol, vol)
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
        price = o + random.uniform(-vol, vol)

    return {"symbol": sym, "timeframe": timeframe, "anchor": end_price, "bars": bars}

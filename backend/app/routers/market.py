import random
import time

from fastapi import APIRouter

from app.data.symbols import SYMBOL_GROUPS, resolve_symbol

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/symbols")
def list_symbols():
    return {"groups": SYMBOL_GROUPS}


@router.get("/history")
def market_history(symbol: str, timeframe: str = "M1", limit: int = 300):
    """OHLC bootstrap for charts — mock bars until MT5 Manager history is wired."""
    meta = resolve_symbol(symbol)
    if not meta:
        return {"symbol": symbol.upper(), "timeframe": timeframe, "bars": []}

    sym = meta["symbol"]
    now = int(time.time())
    step = 60 if timeframe.upper() in ("M1", "1") else 300
    base = {"EURUSD": 1.085, "GBPUSD": 1.265, "USDJPY": 149.5, "XAUUSD": 2650.0, "BTCUSD": 80000.0}.get(sym, 100.0)
    price = base
    bars = []
    for i in range(limit, 0, -1):
        t = now - i * step
        o = price
        c = price + random.uniform(-0.0005, 0.0005)
        if sym == "XAUUSD":
            c = price + random.uniform(-2, 2)
        if sym == "BTCUSD":
            c = price + random.uniform(-50, 50)
        h = max(o, c) + abs(random.uniform(0, 0.0003))
        l = min(o, c) - abs(random.uniform(0, 0.0003))
        bars.append({"time": t, "open": round(o, meta["digits"]), "high": round(h, meta["digits"]), "low": round(l, meta["digits"]), "close": round(c, meta["digits"])})
        price = c

    return {"symbol": sym, "timeframe": timeframe, "bars": bars}

"""Watchlist symbol catalog — matches Capiffy trade terminal groups."""

SYMBOL_GROUPS = {
    "FOREX": [
        {"symbol": "EURUSD", "name": "Euro vs US Dollar", "digits": 5, "tick_size": 0.00001, "contract_size": 100000, "leverage": 100},
        {"symbol": "GBPUSD", "name": "British Pound vs US Dollar", "digits": 5, "tick_size": 0.00001, "contract_size": 100000, "leverage": 100},
        {"symbol": "USDJPY", "name": "US Dollar vs Japanese Yen", "digits": 3, "tick_size": 0.001, "contract_size": 100000, "leverage": 100},
    ],
    "COMMODITIES": [
        {"symbol": "XAUUSD", "name": "Gold vs US Dollar", "digits": 2, "tick_size": 0.01, "contract_size": 100, "leverage": 100},
    ],
    "CRYPTO": [
        {"symbol": "BTCUSD", "name": "Bitcoin vs US Dollar", "digits": 3, "tick_size": 0.001, "contract_size": 1, "leverage": 10},
    ],
}


def all_symbols() -> list[str]:
    out: list[str] = []
    for items in SYMBOL_GROUPS.values():
        for item in items:
            out.append(item["symbol"])
    return out


def resolve_symbol(symbol: str) -> dict | None:
    sym = symbol.upper()
    for items in SYMBOL_GROUPS.values():
        for item in items:
            if item["symbol"] == sym:
                return item
    return None

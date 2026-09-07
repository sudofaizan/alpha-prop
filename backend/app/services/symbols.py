"""Symbol normalization for MT5 broker suffixes (e.g. EURUSD.C → EURUSD)."""

import re

_BROKER_SUFFIX = re.compile(r"\.(C|M|I|PRO)$", re.I)


def normalize_symbol(symbol: str) -> str:
    s = str(symbol or "").upper().strip()
    return _BROKER_SUFFIX.sub("", s)

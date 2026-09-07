"""Simulated trading engine — challenge accounts trade against live prices, stored in DB."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.data.symbols import resolve_symbol
from app.models import ChallengeAccount, SimTrade
from app.services.tick_upstream import tick_upstream

MIN_VOLUME = 0.01
MAX_VOLUME = 50.0
TRADABLE_STATUSES = {"active", "funded"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fmt_dt(dt: datetime | None) -> str:
    if not dt:
        return "—"
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _round_price(symbol: str, price: float) -> float:
    meta = resolve_symbol(symbol)
    digits = int(meta.get("digits", 5)) if meta else 5
    return round(price, digits)


def _quote_prices(symbol: str) -> tuple[float, float]:
    tick = tick_upstream.last_quote(symbol)
    if not tick:
        raise HTTPException(status_code=503, detail=f"No live price for {symbol.upper()} — wait for quotes")
    return float(tick["bid"]), float(tick["ask"])


def _entry_price(symbol: str, side: str) -> float:
    bid, ask = _quote_prices(symbol)
    side = side.upper()
    return ask if side == "BUY" else bid


def _exit_price(symbol: str, side: str) -> float:
    bid, ask = _quote_prices(symbol)
    side = side.upper()
    return bid if side == "BUY" else ask


def _margin_required(symbol: str, volume: float, price: float) -> float:
    meta = resolve_symbol(symbol) or {}
    contract = float(meta.get("contract_size", 100000))
    leverage = float(meta.get("leverage", 100))
    notional = contract * volume * price
    if symbol.upper() == "USDJPY":
        notional = contract * volume
    return round(notional / leverage, 2)


def calc_unrealized_pnl(trade: SimTrade, mark_price: float | None = None) -> float:
    exit_px = mark_price if mark_price is not None else _exit_price(trade.symbol, trade.side)
    return calc_pnl(trade.symbol, trade.side, trade.volume, trade.entry_price, exit_px)


def calc_pnl(symbol: str, side: str, volume: float, entry: float, exit_px: float) -> float:
    sym = symbol.upper()
    side = side.upper()
    meta = resolve_symbol(sym) or {}
    contract = float(meta.get("contract_size", 100000))
    diff = exit_px - entry
    if side == "SELL":
        diff = -diff
    if sym == "USDJPY":
        pnl = (diff * contract * volume) / exit_px
    else:
        pnl = diff * contract * volume
    return round(pnl, 2)


def _require_account(db: Session, user_id: int, account_id: int) -> ChallengeAccount:
    account = (
        db.query(ChallengeAccount)
        .filter(ChallengeAccount.id == account_id, ChallengeAccount.user_id == user_id)
        .one_or_none()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.status not in TRADABLE_STATUSES:
        raise HTTPException(status_code=403, detail=f"Account is {account.status} — trading disabled")
    return account


def refresh_account_metrics(db: Session, account: ChallengeAccount) -> ChallengeAccount:
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "open")
        .all()
    )
    open_pnl = 0.0
    margin_used = 0.0
    for trade in open_trades:
        try:
            open_pnl += calc_unrealized_pnl(trade)
        except HTTPException:
            open_pnl += float(trade.pnl or 0.0)
        margin_used += float(trade.margin_used or 0.0)

    account.open_pnl = round(open_pnl, 2)
    account.equity = round(account.balance + account.open_pnl, 2)
    db.add(account)
    db.flush()
    return account


def trade_row(trade: SimTrade, *, live_pnl: float | None = None) -> dict:
    pnl = live_pnl if live_pnl is not None else trade.pnl
    return {
        "id": trade.id,
        "symbol": trade.symbol,
        "side": trade.side,
        "volume": trade.volume,
        "entry": _round_price(trade.symbol, trade.entry_price),
        "exit": _round_price(trade.symbol, trade.exit_price) if trade.exit_price is not None else None,
        "opened": _fmt_dt(trade.opened_at),
        "closed": _fmt_dt(trade.closed_at),
        "pnl": pnl,
        "reason": trade.close_reason or ("open" if trade.status == "open" else "—"),
        "sl": trade.stop_loss,
        "tp": trade.take_profit,
        "margin_used": trade.margin_used,
    }


def snapshot_for_account(db: Session, account: ChallengeAccount) -> dict:
    account = refresh_account_metrics(db, account)
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "open")
        .order_by(SimTrade.opened_at.desc())
        .all()
    )
    closed_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "closed")
        .order_by(SimTrade.closed_at.desc())
        .limit(100)
        .all()
    )

    open_rows = []
    for trade in open_trades:
        try:
            live = calc_unrealized_pnl(trade)
        except HTTPException:
            live = 0.0
        open_rows.append(trade_row(trade, live_pnl=live))

    closed_rows = [trade_row(t) for t in closed_trades]
    margin_used = sum(float(t.margin_used or 0) for t in open_trades)

    return {
        "mode": "simulated",
        "trading_enabled": account.status in TRADABLE_STATUSES,
        "open": open_rows,
        "pending": [],
        "closed": closed_rows,
        "counts": {
            "open": len(open_rows),
            "pending": 0,
            "closed": len(closed_rows),
        },
        "metrics": {
            "balance": round(account.balance, 2),
            "equity": round(account.equity, 2),
            "open_pnl": round(account.open_pnl, 2),
            "margin_used": round(margin_used, 2),
            "free_margin": round(max(0.0, account.equity - margin_used), 2),
        },
    }


def open_market_order(
    db: Session,
    user_id: int,
    account_id: int,
    symbol: str,
    side: str,
    volume: float,
    stop_loss: float | None = None,
    take_profit: float | None = None,
) -> SimTrade:
    account = _require_account(db, user_id, account_id)
    sym = symbol.upper()
    meta = resolve_symbol(sym)
    if not meta:
        raise HTTPException(status_code=400, detail=f"Symbol {sym} not supported")

    side_norm = side.upper()
    if side_norm not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="side must be buy or sell")
    if volume < MIN_VOLUME or volume > MAX_VOLUME:
        raise HTTPException(status_code=400, detail=f"volume must be between {MIN_VOLUME} and {MAX_VOLUME}")

    entry = _entry_price(sym, side_norm)
    margin = _margin_required(sym, volume, entry)
    account = refresh_account_metrics(db, account)
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "open")
        .all()
    )
    margin_used = sum(float(t.margin_used or 0) for t in open_trades)
    free_margin = account.equity - margin_used
    if margin > free_margin:
        raise HTTPException(status_code=400, detail="Insufficient free margin")

    trade = SimTrade(
        account_id=account.id,
        symbol=sym,
        side=side_norm,
        volume=round(volume, 2),
        entry_price=entry,
        stop_loss=stop_loss,
        take_profit=take_profit,
        margin_used=margin,
        status="open",
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    refresh_account_metrics(db, account)
    db.commit()
    return trade


def close_position(
    db: Session,
    user_id: int,
    account_id: int,
    trade_id: int,
    reason: str = "manual",
) -> SimTrade:
    account = _require_account(db, user_id, account_id)
    trade = (
        db.query(SimTrade)
        .filter(SimTrade.id == trade_id, SimTrade.account_id == account.id, SimTrade.status == "open")
        .one_or_none()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Open position not found")

    exit_px = _exit_price(trade.symbol, trade.side)
    pnl = calc_pnl(trade.symbol, trade.side, trade.volume, trade.entry_price, exit_px)

    trade.exit_price = exit_px
    trade.pnl = pnl
    trade.status = "closed"
    trade.close_reason = reason
    trade.closed_at = _utcnow()

    account.balance = round(account.balance + pnl, 2)
    db.add(trade)
    db.add(account)
    db.commit()
    db.refresh(trade)

    refresh_account_metrics(db, account)
    _update_trade_stats(db, account)
    db.commit()
    return trade


def _update_trade_stats(db: Session, account: ChallengeAccount) -> None:
    closed = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "closed")
        .all()
    )
    wins = sum(1 for t in closed if (t.pnl or 0) > 0)
    account.total_trades = len(closed)
    account.win_rate = round((wins / len(closed)) * 100, 2) if closed else 0.0
    db.add(account)

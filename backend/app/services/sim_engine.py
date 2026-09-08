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


def _reserved_margin(db: Session, account_id: int) -> float:
    trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account_id, SimTrade.status.in_(("open", "pending")))
        .all()
    )
    return sum(float(t.margin_used or 0) for t in trades)


def _validate_stops(side: str, entry: float, symbol: str, stop_loss: float | None, take_profit: float | None) -> None:
    side = side.upper()
    if stop_loss is not None:
        sl = float(stop_loss)
        if side == "BUY" and sl >= entry:
            raise HTTPException(status_code=400, detail="Stop loss for BUY must be below entry")
        if side == "SELL" and sl <= entry:
            raise HTTPException(status_code=400, detail="Stop loss for SELL must be above entry")
    if take_profit is not None:
        tp = float(take_profit)
        if side == "BUY" and tp <= entry:
            raise HTTPException(status_code=400, detail="Take profit for BUY must be above entry")
        if side == "SELL" and tp >= entry:
            raise HTTPException(status_code=400, detail="Take profit for SELL must be below entry")


def refresh_account_metrics(db: Session, account: ChallengeAccount) -> ChallengeAccount:
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "open")
        .all()
    )
    open_pnl = 0.0
    for trade in open_trades:
        try:
            open_pnl += calc_unrealized_pnl(trade)
        except HTTPException:
            open_pnl += float(trade.pnl or 0.0)

    account.open_pnl = round(open_pnl, 2)
    account.equity = round(account.balance + account.open_pnl, 2)
    db.add(account)
    db.flush()
    return account


def _display_close_reason(trade: SimTrade) -> str:
    if trade.status != "closed":
        return trade.close_reason or ("open" if trade.status == "open" else "—")
    if (trade.close_reason or "") == "admin" and trade.admin_close_message:
        return f"BY ADMIN: {trade.admin_close_message.strip()}"
    labels = {"manual": "manual", "sl": "stop loss", "tp": "take profit", "cancelled": "cancelled"}
    return labels.get(trade.close_reason or "", trade.close_reason or "—")


def trade_row(trade: SimTrade, *, live_pnl: float | None = None) -> dict:
    pnl = live_pnl if live_pnl is not None else trade.pnl
    opened_time = None
    if trade.opened_at:
        opened_time = int(trade.opened_at.timestamp())
    closed_time = None
    if trade.closed_at:
        closed_time = int(trade.closed_at.timestamp())
    return {
        "id": trade.id,
        "symbol": trade.symbol,
        "side": trade.side,
        "volume": trade.volume,
        "entry": _round_price(trade.symbol, trade.entry_price),
        "exit": _round_price(trade.symbol, trade.exit_price) if trade.exit_price is not None else None,
        "opened": _fmt_dt(trade.opened_at),
        "opened_time": opened_time,
        "closed": _fmt_dt(trade.closed_at),
        "closed_time": closed_time,
        "pnl": pnl,
        "reason": _display_close_reason(trade),
        "sl": trade.stop_loss,
        "tp": trade.take_profit,
        "margin_used": trade.margin_used,
        "order_type": trade.order_type or "market",
    }


def pending_row(trade: SimTrade) -> dict:
    opened_time = int(trade.opened_at.timestamp()) if trade.opened_at else None
    return {
        "id": trade.id,
        "symbol": trade.symbol,
        "side": trade.side,
        "volume": trade.volume,
        "price": _round_price(trade.symbol, trade.entry_price),
        "order_type": (trade.order_type or "limit").upper(),
        "sl": trade.stop_loss,
        "tp": trade.take_profit,
        "created": _fmt_dt(trade.opened_at),
        "opened_time": opened_time,
        "margin_used": trade.margin_used,
    }


def _pending_should_fill(trade: SimTrade, bid: float, ask: float) -> bool:
    ot = (trade.order_type or "limit").lower()
    price = float(trade.entry_price)
    side = trade.side.upper()
    if ot == "limit":
        return (side == "BUY" and ask <= price) or (side == "SELL" and bid >= price)
    if ot == "stop":
        return (side == "BUY" and ask >= price) or (side == "SELL" and bid <= price)
    return False


def process_pending_fills(db: Session, account_id: int) -> list[dict]:
    account = db.query(ChallengeAccount).filter(ChallengeAccount.id == account_id).one_or_none()
    if not account:
        return []

    filled: list[dict] = []
    pending = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account_id, SimTrade.status == "pending")
        .all()
    )
    for trade in pending:
        try:
            bid, ask = _quote_prices(trade.symbol)
        except HTTPException:
            continue
        if not _pending_should_fill(trade, bid, ask):
            continue
        fill_px = _round_price(trade.symbol, float(trade.entry_price))
        trade.entry_price = fill_px
        trade.status = "open"
        trade.opened_at = _utcnow()
        db.add(trade)
        filled.append(
            {
                "id": trade.id,
                "symbol": trade.symbol,
                "side": trade.side,
                "order_type": trade.order_type,
                "price": fill_px,
            }
        )

    if filled:
        db.commit()
        refresh_account_metrics(db, account)
        db.commit()
    return filled


def _detect_stop_hit(trade: SimTrade, bid: float, ask: float) -> str | None:
    sl = trade.stop_loss
    tp = trade.take_profit
    side = trade.side.upper()
    if side == "BUY":
        if sl is not None and bid <= float(sl):
            return "sl"
        if tp is not None and bid >= float(tp):
            return "tp"
    else:
        if sl is not None and ask >= float(sl):
            return "sl"
        if tp is not None and ask <= float(tp):
            return "tp"
    return None


def process_stop_hits(db: Session, account_id: int) -> list[dict]:
    """Close open trades whose SL or TP has been touched by live price."""
    account = db.query(ChallengeAccount).filter(ChallengeAccount.id == account_id).one_or_none()
    if not account:
        return []

    closed_events: list[dict] = []
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account_id, SimTrade.status == "open")
        .all()
    )
    for trade in open_trades:
        if trade.stop_loss is None and trade.take_profit is None:
            continue
        try:
            bid, ask = _quote_prices(trade.symbol)
        except HTTPException:
            continue
        hit = _detect_stop_hit(trade, bid, ask)
        if not hit:
            continue

        exit_px = float(trade.stop_loss if hit == "sl" else trade.take_profit)
        pnl = calc_pnl(trade.symbol, trade.side, trade.volume, trade.entry_price, exit_px)
        trade.exit_price = exit_px
        trade.pnl = pnl
        trade.status = "closed"
        trade.close_reason = hit
        trade.closed_at = _utcnow()
        account.balance = round(account.balance + pnl, 2)
        db.add(trade)
        db.add(account)
        closed_events.append(
            {
                "id": trade.id,
                "symbol": trade.symbol,
                "reason": hit,
                "pnl": pnl,
                "exit": _round_price(trade.symbol, exit_px),
            }
        )

    if closed_events:
        db.commit()
        refresh_account_metrics(db, account)
        _update_trade_stats(db, account)
        db.commit()
    return closed_events


def snapshot_for_account(db: Session, account: ChallengeAccount) -> dict:
    pending_fills = process_pending_fills(db, account.id)
    hits = process_stop_hits(db, account.id)
    db.refresh(account)
    account = refresh_account_metrics(db, account)
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "open")
        .order_by(SimTrade.opened_at.desc())
        .all()
    )
    pending_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "pending")
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

    pending_rows = [pending_row(t) for t in pending_trades]
    closed_rows = [trade_row(t) for t in closed_trades]
    margin_used = _reserved_margin(db, account.id)

    return {
        "mode": "simulated",
        "trading_enabled": account.status in TRADABLE_STATUSES,
        "open": open_rows,
        "pending": pending_rows,
        "closed": closed_rows,
        "stop_hits": hits,
        "pending_fills": pending_fills,
        "counts": {
            "open": len(open_rows),
            "pending": len(pending_rows),
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


def place_order(
    db: Session,
    user_id: int,
    account_id: int,
    symbol: str,
    side: str,
    volume: float,
    order_type: str = "market",
    price: float | None = None,
    stop_loss: float | None = None,
    take_profit: float | None = None,
) -> SimTrade:
    ot = (order_type or "market").lower()
    if ot == "market":
        return open_market_order(db, user_id, account_id, symbol, side, volume, stop_loss, take_profit)
    if ot not in ("limit", "stop"):
        raise HTTPException(status_code=400, detail="order_type must be market, limit, or stop")
    if price is None:
        raise HTTPException(status_code=400, detail="price is required for limit and stop orders")
    return place_pending_order(db, user_id, account_id, symbol, side, volume, ot, float(price), stop_loss, take_profit)


def place_pending_order(
    db: Session,
    user_id: int,
    account_id: int,
    symbol: str,
    side: str,
    volume: float,
    order_type: str,
    trigger_price: float,
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

    trigger = _round_price(sym, trigger_price)
    _validate_stops(side_norm, trigger, sym, stop_loss, take_profit)

    margin = _margin_required(sym, volume, trigger)
    account = refresh_account_metrics(db, account)
    free_margin = account.equity - _reserved_margin(db, account.id)
    if margin > free_margin:
        raise HTTPException(status_code=400, detail="Insufficient free margin")

    trade = SimTrade(
        account_id=account.id,
        symbol=sym,
        side=side_norm,
        volume=round(volume, 2),
        entry_price=trigger,
        stop_loss=_round_price(sym, stop_loss) if stop_loss is not None else None,
        take_profit=_round_price(sym, take_profit) if take_profit is not None else None,
        margin_used=margin,
        order_type=order_type.lower(),
        status="pending",
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def cancel_pending_order(db: Session, user_id: int, account_id: int, trade_id: int) -> SimTrade:
    account = _require_account(db, user_id, account_id)
    trade = (
        db.query(SimTrade)
        .filter(SimTrade.id == trade_id, SimTrade.account_id == account.id, SimTrade.status == "pending")
        .one_or_none()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Pending order not found")
    trade.status = "cancelled"
    trade.close_reason = "cancelled"
    trade.closed_at = _utcnow()
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def update_pending_order(
    db: Session,
    user_id: int,
    account_id: int,
    trade_id: int,
    price: float | None = None,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    *,
    set_stop_loss: bool = False,
    set_take_profit: bool = False,
    set_price: bool = True,
) -> SimTrade:
    account = _require_account(db, user_id, account_id)
    trade = (
        db.query(SimTrade)
        .filter(SimTrade.id == trade_id, SimTrade.account_id == account.id, SimTrade.status == "pending")
        .one_or_none()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Pending order not found")

    side_norm = trade.side.upper()
    trigger = _round_price(trade.symbol, float(price if set_price and price is not None else trade.entry_price))
    sl = trade.stop_loss
    tp = trade.take_profit
    if set_stop_loss:
        sl = _round_price(trade.symbol, stop_loss) if stop_loss is not None else None
    if set_take_profit:
        tp = _round_price(trade.symbol, take_profit) if take_profit is not None else None
    _validate_stops(side_norm, trigger, trade.symbol, sl, tp)

    margin = _margin_required(trade.symbol, trade.volume, trigger)
    account = refresh_account_metrics(db, account)
    released = float(trade.margin_used or 0)
    free_margin = account.equity - _reserved_margin(db, account.id) + released
    if margin > free_margin:
        raise HTTPException(status_code=400, detail="Insufficient free margin")

    trade.entry_price = trigger
    trade.margin_used = margin
    if set_stop_loss:
        trade.stop_loss = sl
    if set_take_profit:
        trade.take_profit = tp
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


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
    _validate_stops(side_norm, entry, sym, stop_loss, take_profit)
    margin = _margin_required(sym, volume, entry)
    account = refresh_account_metrics(db, account)
    free_margin = account.equity - _reserved_margin(db, account.id)
    if margin > free_margin:
        raise HTTPException(status_code=400, detail="Insufficient free margin")

    trade = SimTrade(
        account_id=account.id,
        symbol=sym,
        side=side_norm,
        volume=round(volume, 2),
        entry_price=entry,
        stop_loss=_round_price(sym, stop_loss) if stop_loss is not None else None,
        take_profit=_round_price(sym, take_profit) if take_profit is not None else None,
        margin_used=margin,
        order_type="market",
        status="open",
        opened_at=_utcnow(),
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    refresh_account_metrics(db, account)
    db.commit()
    return trade


def close_position(
    db: Session,
    account_id: int,
    trade_id: int,
    reason: str = "manual",
    exit_price: float | None = None,
    *,
    user_id: int | None = None,
    admin_message: str | None = None,
) -> SimTrade:
    if user_id is not None:
        account = _require_account(db, user_id, account_id)
    else:
        account = db.query(ChallengeAccount).filter(ChallengeAccount.id == account_id).one_or_none()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")

    trade = (
        db.query(SimTrade)
        .filter(SimTrade.id == trade_id, SimTrade.account_id == account.id, SimTrade.status == "open")
        .one_or_none()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Open position not found")

    if exit_price is not None:
        exit_px = float(exit_price)
    elif reason == "sl" and trade.stop_loss is not None:
        exit_px = float(trade.stop_loss)
    elif reason == "tp" and trade.take_profit is not None:
        exit_px = float(trade.take_profit)
    else:
        exit_px = _exit_price(trade.symbol, trade.side)
    pnl = calc_pnl(trade.symbol, trade.side, trade.volume, trade.entry_price, exit_px)

    trade.exit_price = exit_px
    trade.pnl = pnl
    trade.status = "closed"
    if admin_message:
        trade.close_reason = "admin"
        trade.admin_close_message = admin_message.strip()[:500]
    else:
        trade.close_reason = reason
        trade.admin_close_message = None
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


def admin_close_position(db: Session, trade_id: int, message: str) -> tuple[SimTrade, ChallengeAccount]:
    trade = (
        db.query(SimTrade)
        .filter(SimTrade.id == trade_id, SimTrade.status == "open")
        .one_or_none()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Open position not found")
    account = db.query(ChallengeAccount).filter(ChallengeAccount.id == trade.account_id).one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    closed = close_position(
        db,
        account.id,
        trade_id,
        reason="admin",
        admin_message=message,
    )
    return closed, account


def update_position_stops(
    db: Session,
    user_id: int,
    account_id: int,
    trade_id: int,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    *,
    set_stop_loss: bool = True,
    set_take_profit: bool = True,
) -> SimTrade:
    account = _require_account(db, user_id, account_id)
    trade = (
        db.query(SimTrade)
        .filter(SimTrade.id == trade_id, SimTrade.account_id == account.id, SimTrade.status == "open")
        .one_or_none()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Open position not found")

    entry = float(trade.entry_price)
    side = trade.side.upper()

    if set_stop_loss:
        if stop_loss is not None:
            sl = float(stop_loss)
            if side == "BUY" and sl >= entry:
                raise HTTPException(status_code=400, detail="Stop loss for BUY must be below entry")
            if side == "SELL" and sl <= entry:
                raise HTTPException(status_code=400, detail="Stop loss for SELL must be above entry")
            trade.stop_loss = _round_price(trade.symbol, sl)
        else:
            trade.stop_loss = None

    if set_take_profit:
        if take_profit is not None:
            tp = float(take_profit)
            if side == "BUY" and tp <= entry:
                raise HTTPException(status_code=400, detail="Take profit for BUY must be above entry")
            if side == "SELL" and tp >= entry:
                raise HTTPException(status_code=400, detail="Take profit for SELL must be below entry")
            trade.take_profit = _round_price(trade.symbol, tp)
        else:
            trade.take_profit = None

    db.add(trade)
    db.commit()
    db.refresh(trade)
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

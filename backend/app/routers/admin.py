from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies_admin import get_admin_user
from app.models import ChallengeAccount, Order, SimTrade, User, UserSession
from app.schemas import AdminClosePositionRequest, AdminUserOut, AddStrikeRequest, BlockUserRequest, MessageResponse, StrikeOut
from app.services import sim_engine
from app.services.accounts import account_to_summary
from app.services.notifications import create_notification
from app.services.strikes import RULE_PRESETS, add_strike, clear_strikes, list_strikes, strike_count
from app.models.user_strike import STRIKE_LIMIT

router = APIRouter(prefix="/admin", tags=["admin"])

ONLINE_WINDOW = timedelta(minutes=10)


def _is_online(db: Session, user_id: int) -> bool:
    session = db.query(UserSession).filter(UserSession.user_id == user_id).one_or_none()
    if not session or not session.last_seen_at:
        return False
    seen = session.last_seen_at
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - seen <= ONLINE_WINDOW


def _user_trading_counts(db: Session, user_id: int) -> dict:
    account_ids = [a.id for a in db.query(ChallengeAccount.id).filter(ChallengeAccount.user_id == user_id).all()]
    if not account_ids:
        return {"open_positions": 0, "pending_orders": 0, "funded_accounts": 0}
    open_positions = (
        db.query(SimTrade).filter(SimTrade.account_id.in_(account_ids), SimTrade.status == "open").count()
    )
    pending_orders = (
        db.query(SimTrade).filter(SimTrade.account_id.in_(account_ids), SimTrade.status == "pending").count()
    )
    funded_accounts = (
        db.query(ChallengeAccount)
        .filter(ChallengeAccount.user_id == user_id, ChallengeAccount.status == "funded")
        .count()
    )
    return {
        "open_positions": open_positions,
        "pending_orders": pending_orders,
        "funded_accounts": funded_accounts,
    }


def _admin_user_row(db: Session, user: User) -> dict:
    account_count = db.query(ChallengeAccount).filter(ChallengeAccount.user_id == user.id).count()
    order_count = db.query(Order).filter(Order.user_id == user.id).count()
    trading = _user_trading_counts(db, user.id)
    strikes = strike_count(db, user.id)
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "is_admin": user.is_admin,
        "is_blocked": user.is_blocked,
        "blocked_reason": user.blocked_reason,
        "strike_count": strikes,
        "strike_limit": STRIKE_LIMIT,
        "is_breached": strikes >= STRIKE_LIMIT,
        "account_count": account_count,
        "order_count": order_count,
        "funded_count": trading["funded_accounts"],
        "open_positions": trading["open_positions"],
        "pending_orders": trading["pending_orders"],
        "is_online": _is_online(db, user.id),
        "created_at": user.created_at.isoformat() if user.created_at else "",
    }


def _position_row(trade: SimTrade, *, live_pnl: float | None = None) -> dict:
    account = trade.account
    user = account.user if account else None
    pnl = live_pnl
    if pnl is None:
        try:
            pnl = sim_engine.calc_unrealized_pnl(trade)
        except Exception:
            pnl = 0.0
    return {
        "id": trade.id,
        "account_id": trade.account_id,
        "account_number": account.account_number if account else None,
        "user_id": account.user_id if account else None,
        "user_email": user.email if user else None,
        "user_name": user.full_name if user else None,
        "symbol": trade.symbol,
        "side": trade.side,
        "volume": trade.volume,
        "entry": trade.entry_price,
        "sl": trade.stop_loss,
        "tp": trade.take_profit,
        "pnl": round(float(pnl), 2),
        "opened": trade.opened_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if trade.opened_at else "—",
        "opened_time": int(trade.opened_at.timestamp()) if trade.opened_at else None,
        "margin_used": trade.margin_used,
    }


def _pending_admin_row(trade: SimTrade) -> dict:
    row = _position_row(trade)
    row["price"] = trade.entry_price
    row["order_type"] = (trade.order_type or "limit").upper()
    return row


@router.get("/users")
def list_users(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return {"items": [_admin_user_row(db, u) for u in users]}


@router.get("/users/{user_id}")
def get_user_detail(user_id: int, _admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "User not found"})

    accounts = (
        db.query(ChallengeAccount)
        .filter(ChallengeAccount.user_id == user.id)
        .order_by(ChallengeAccount.created_at.desc())
        .all()
    )
    trading = _user_trading_counts(db, user.id)
    closed_count = 0
    total_pnl = 0.0
    if accounts:
        account_ids = [a.id for a in accounts]
        closed_count = (
            db.query(SimTrade).filter(SimTrade.account_id.in_(account_ids), SimTrade.status == "closed").count()
        )
        for t in db.query(SimTrade).filter(SimTrade.account_id.in_(account_ids), SimTrade.status == "closed").all():
            total_pnl += float(t.pnl or 0)

    return {
        "user": _admin_user_row(db, user),
        "accounts": [account_to_summary(a).model_dump() for a in accounts],
        "stats": {
            **trading,
            "closed_trades": closed_count,
            "realised_pnl": round(total_pnl, 2),
        },
    }


@router.get("/users/{user_id}/snapshot")
def get_user_snapshot(
    user_id: int,
    account_id: int = Query(...),
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    account = (
        db.query(ChallengeAccount)
        .filter(ChallengeAccount.id == account_id, ChallengeAccount.user_id == user_id)
        .one_or_none()
    )
    if not account:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Account not found"})
    snap = sim_engine.snapshot_for_account(db, account)
    snap["account"] = account_to_summary(account).model_dump()
    return snap


@router.patch("/users/{user_id}/block", response_model=AdminUserOut)
def block_user(
    user_id: int,
    payload: BlockUserRequest,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "User not found"})
    if user.id == admin.id and payload.blocked:
        raise HTTPException(status_code=400, detail={"code": "INVALID", "message": "You cannot block yourself"})

    user.is_blocked = payload.blocked
    user.blocked_reason = payload.reason.strip() if payload.blocked and payload.reason else None
    db.commit()
    db.refresh(user)

    if payload.blocked:
        from app.services.auth import logout_user

        logout_user(db, user)

    row = _admin_user_row(db, user)
    return AdminUserOut(**{k: row[k] for k in AdminUserOut.model_fields})


@router.post("/users/{user_id}/strike", response_model=MessageResponse)
def issue_strike(
    user_id: int,
    payload: AddStrikeRequest,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "User not found"})
    if user.is_admin:
        raise HTTPException(status_code=400, detail={"code": "INVALID", "message": "Cannot strike admin users"})
    try:
        strike, breached = add_strike(
            db,
            user,
            rule_label=payload.rule_label,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "INVALID", "message": str(exc)}) from exc

    count = strike_count(db, user.id)
    if breached:
        return MessageResponse(message=f"Strike {count}/{STRIKE_LIMIT} issued — user accounts breached")
    return MessageResponse(message=f"Strike {count}/{STRIKE_LIMIT} issued — {strike.rule_label}")


@router.delete("/users/{user_id}/strikes", response_model=MessageResponse)
def remove_strikes(
    user_id: int,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "User not found"})
    removed = clear_strikes(db, user)
    return MessageResponse(message=f"Cleared {removed} strike(s)")


@router.get("/users/{user_id}/strikes")
def get_user_strikes(user_id: int, _admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "User not found"})
    items = list_strikes(db, user.id)
    return {
        "strike_count": len(items),
        "strike_limit": STRIKE_LIMIT,
        "rule_presets": RULE_PRESETS,
        "items": [
            StrikeOut(
                id=s.id,
                rule_label=s.rule_label,
                reason=s.reason,
                created_at=s.created_at.isoformat() if s.created_at else "",
            ).model_dump()
            for s in items
        ],
    }


@router.get("/trading/live")
def live_trading(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.status == "open")
        .options(joinedload(SimTrade.account).joinedload(ChallengeAccount.user))
        .order_by(SimTrade.opened_at.desc())
        .all()
    )
    pending = (
        db.query(SimTrade)
        .filter(SimTrade.status == "pending")
        .options(joinedload(SimTrade.account).joinedload(ChallengeAccount.user))
        .order_by(SimTrade.opened_at.desc())
        .all()
    )

    active_user_ids = set()
    for t in open_trades + pending:
        if t.account and t.account.user_id:
            active_user_ids.add(t.account.user_id)

    online_traders = sum(1 for uid in active_user_ids if _is_online(db, uid))

    open_rows = []
    total_open_pnl = 0.0
    for trade in open_trades:
        try:
            pnl = sim_engine.calc_unrealized_pnl(trade)
        except Exception:
            pnl = 0.0
        total_open_pnl += pnl
        open_rows.append(_position_row(trade, live_pnl=pnl))

    return {
        "summary": {
            "open_positions": len(open_trades),
            "pending_orders": len(pending),
            "active_traders": len(active_user_ids),
            "online_traders": online_traders,
            "total_open_pnl": round(total_open_pnl, 2),
        },
        "open": open_rows,
        "pending": [_pending_admin_row(t) for t in pending],
    }


@router.post("/positions/{trade_id}/close", response_model=MessageResponse)
def admin_close_position(
    trade_id: int,
    body: AdminClosePositionRequest,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    trade, account = sim_engine.admin_close_position(db, trade_id, body.message)
    user = db.query(User).filter(User.id == account.user_id).one_or_none()
    if user:
        create_notification(
            db,
            user.id,
            category="system",
            title="Position closed by admin",
            body=f"Your {trade.side} {trade.volume} {trade.symbol} position was closed. BY ADMIN: {body.message.strip()}",
        )
    return MessageResponse(message=f"Closed position #{trade.id} · P/L ${trade.pnl:.2f}")


@router.get("/accounts")
def admin_accounts(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    rows = db.query(ChallengeAccount).options(joinedload(ChallengeAccount.user)).order_by(ChallengeAccount.created_at.desc()).all()
    return {
        "items": [
            {
                **account_to_summary(a).model_dump(),
                "user_id": a.user_id,
                "user_email": a.user.email if a.user else None,
                "user_name": a.user.full_name if a.user else None,
            }
            for a in rows
        ]
    }


@router.get("/orders")
def admin_orders(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    rows = db.query(Order).options(joinedload(Order.user), joinedload(Order.account)).order_by(Order.created_at.desc()).all()
    return {
        "items": [
            {
                "id": o.id,
                "user_id": o.user_id,
                "user_email": o.user.email if o.user else None,
                "program": o.program,
                "account_size": o.account_size,
                "amount": o.amount,
                "status": o.status,
                "payment_method": o.payment_method,
                "coupon_code": o.coupon_code,
                "created_at": o.created_at.isoformat() if o.created_at else "",
                "account_number": o.account.account_number if o.account else None,
            }
            for o in rows
        ]
    }


@router.get("/stats")
def admin_stats(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    open_count = db.query(SimTrade).filter(SimTrade.status == "open").count()
    pending_count = db.query(SimTrade).filter(SimTrade.status == "pending").count()
    active_accounts = (
        db.query(ChallengeAccount.id)
        .join(SimTrade, SimTrade.account_id == ChallengeAccount.id)
        .filter(SimTrade.status.in_(("open", "pending")))
        .distinct()
        .count()
    )
    return {
        "users": db.query(User).count(),
        "blocked_users": db.query(User).filter(User.is_blocked.is_(True)).count(),
        "accounts": db.query(ChallengeAccount).count(),
        "funded_accounts": db.query(ChallengeAccount).filter(ChallengeAccount.status == "funded").count(),
        "orders": db.query(Order).count(),
        "revenue": round(sum(o.amount for o in db.query(Order).filter(Order.status == "paid").all()), 2),
        "open_positions": open_count,
        "pending_orders": pending_count,
        "active_traders": active_accounts,
    }

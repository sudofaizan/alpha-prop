from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.data import plans as plan_data
from app.models import ChallengeAccount, Order, PaymentSession, UsedPaymentHash, User
from app.services.accounts import fulfill_paid_order
from app.services.bsc_usdt import get_usdt_balance, verify_usdt_incoming_tx
from app.services.payment_settings import get_payment_settings, settings_dict

SESSION_TTL_MINUTES = 5
AMOUNT_TOLERANCE = 0.02


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _expire_if_needed(db: Session, session: PaymentSession, order: Order) -> bool:
    if session.status != "pending":
        return session.status == "expired"
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if _utcnow() > expires:
        session.status = "expired"
        order.status = "expired"
        db.add(session)
        db.add(order)
        db.commit()
        return True
    return False


def _session_out(db: Session, session: PaymentSession, order: Order) -> dict:
    program_label = plan_data.program_label(order.program)
    from app.services.accounts import _size_label

    return {
        "session_id": session.public_id,
        "order_id": order.id,
        "status": session.status,
        "order_status": order.status,
        "amount": round(float(session.amount), 2),
        "wallet_address": session.wallet_address,
        "network": "bep20",
        "asset": "USDT",
        "baseline_balance": round(float(session.baseline_balance), 6),
        "current_balance": None,
        "balance_delta": None,
        "expires_at": session.expires_at.isoformat() if session.expires_at else "",
        "tx_hash": session.tx_hash,
        "account_number": order.account.account_number if order.account else None,
        "program": order.program,
        "program_label": program_label,
        "account_size": order.account_size,
        "account_size_label": _size_label(order.account_size),
        "payment_method": order.payment_method,
    }


def create_crypto_session(
    db: Session,
    user: User,
    program: str,
    account_size: int,
    coupon_code: str | None,
    referral_code: str | None,
) -> dict:
    settings = get_payment_settings(db)
    if not settings.enabled or not settings.wallet_address:
        raise HTTPException(status_code=503, detail="Crypto payments are not configured")

    sizes = plan_data.get_sizes(program)
    if account_size not in sizes:
        raise HTTPException(status_code=400, detail="Invalid account size for program")

    amount = plan_data.get_price(account_size, program, coupon_code)
    base_amount = plan_data.get_base_price(account_size, program)
    wallet = settings.wallet_address.strip()

    try:
        baseline = get_usdt_balance(wallet)
    except HTTPException:
        baseline = 0.0

    order = Order(
        user_id=user.id,
        challenge_account_id=None,
        program=program,
        account_size=account_size,
        amount=amount,
        base_amount=base_amount,
        coupon_code=coupon_code.upper() if coupon_code else None,
        referral_code=referral_code,
        status="pending",
        payment_method="usdt_bep20",
    )
    db.add(order)
    db.flush()

    session = PaymentSession(
        public_id=str(uuid.uuid4()),
        user_id=user.id,
        order_id=order.id,
        amount=amount,
        wallet_address=wallet,
        baseline_balance=baseline,
        status="pending",
        expires_at=_utcnow() + timedelta(minutes=SESSION_TTL_MINUTES),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    db.refresh(order)

    out = _session_out(db, session, order)
    out["current_balance"] = baseline
    out["balance_delta"] = 0.0
    return out


def get_session_for_user(db: Session, user: User, public_id: str, *, check_balance: bool = True) -> dict:
    session = (
        db.query(PaymentSession)
        .filter(PaymentSession.public_id == public_id, PaymentSession.user_id == user.id)
        .one_or_none()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Payment session not found")
    order = db.query(Order).options(joinedload(Order.account)).filter(Order.id == session.order_id).one()

    if _expire_if_needed(db, session, order):
        db.refresh(session)
        db.refresh(order)

    out = _session_out(db, session, order)

    if session.status == "pending" and check_balance:
        try:
            current = get_usdt_balance(session.wallet_address)
            delta = max(0.0, current - float(session.baseline_balance))
            out["current_balance"] = round(current, 6)
            out["balance_delta"] = round(delta, 6)
            if delta + AMOUNT_TOLERANCE >= float(session.amount):
                _complete_session(db, session, order, tx_hash=session.tx_hash, via="balance")
                db.refresh(session)
                db.refresh(order)
                out = _session_out(db, session, order)
                out["current_balance"] = round(current, 6)
                out["balance_delta"] = round(delta, 6)
        except HTTPException:
            pass

    return out


def _hash_already_used(db: Session, tx_hash: str) -> bool:
    h = tx_hash.strip().lower()
    return db.query(UsedPaymentHash).filter(UsedPaymentHash.tx_hash == h).one_or_none() is not None


def _record_hash(db: Session, session: PaymentSession, tx_hash: str, amount: float) -> None:
    db.add(
        UsedPaymentHash(
            tx_hash=tx_hash.strip().lower(),
            payment_session_id=session.id,
            wallet_address=session.wallet_address,
            amount=amount,
        )
    )


def _complete_session(
    db: Session,
    session: PaymentSession,
    order: Order,
    *,
    tx_hash: str | None,
    via: str,
) -> ChallengeAccount:
    if session.status == "completed" and order.status == "paid":
        if order.challenge_account_id:
            account = db.query(ChallengeAccount).filter(ChallengeAccount.id == order.challenge_account_id).one()
            return account
    if session.status != "pending":
        raise HTTPException(status_code=400, detail=f"Payment session is {session.status}")

    if _expire_if_needed(db, session, order):
        raise HTTPException(status_code=400, detail="Payment session expired")

    if tx_hash:
        if _hash_already_used(db, tx_hash):
            raise HTTPException(status_code=400, detail="This transaction hash was already used")
        session.tx_hash = tx_hash.strip().lower()
        order.tx_hash = session.tx_hash

    account = fulfill_paid_order(db, order)
    session.status = "completed"
    session.confirmed_at = _utcnow()
    order.status = "paid"
    db.add(session)
    db.add(order)

    if session.tx_hash:
        _record_hash(db, session, session.tx_hash, float(session.amount))

    db.commit()
    db.refresh(session)
    db.refresh(order)
    db.refresh(account)
    return account


def verify_session_hash(db: Session, user: User, public_id: str, tx_hash: str) -> dict:
    session = (
        db.query(PaymentSession)
        .filter(PaymentSession.public_id == public_id, PaymentSession.user_id == user.id)
        .one_or_none()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Payment session not found")
    order = db.query(Order).options(joinedload(Order.account)).filter(Order.id == session.order_id).one()

    if session.status == "completed":
        out = _session_out(db, session, order)
        return {**out, "message": "Payment already completed"}

    if _expire_if_needed(db, session, order):
        raise HTTPException(status_code=400, detail="Payment session expired — start a new checkout")

    h = tx_hash.strip().lower()
    if _hash_already_used(db, h):
        raise HTTPException(status_code=400, detail="This transaction hash was already used")

    transfer = verify_usdt_incoming_tx(h, session.wallet_address, float(session.amount))
    _complete_session(db, session, order, tx_hash=h, via="hash")
    db.refresh(session)
    db.refresh(order)

    out = _session_out(db, session, order)
    out["message"] = "Payment verified successfully"
    out["verified_amount"] = round(transfer["amount"], 6)
    return out


def get_admin_payment_settings(db: Session) -> dict:
    return settings_dict(get_payment_settings(db))

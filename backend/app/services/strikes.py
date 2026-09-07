from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import ChallengeAccount, SimTrade, User, UserStrike
from app.models.user_strike import STRIKE_LIMIT
from app.services import sim_engine
from app.services.notifications import create_notification

RULE_PRESETS = [
    "News Trading",
    "Copy Trading",
    "Hedging",
    "Latency Arbitrage",
    "Account Sharing",
    "Other",
]


def strike_count(db: Session, user_id: int) -> int:
    return db.query(UserStrike).filter(UserStrike.user_id == user_id).count()


def list_strikes(db: Session, user_id: int) -> list[UserStrike]:
    return (
        db.query(UserStrike)
        .filter(UserStrike.user_id == user_id)
        .order_by(UserStrike.created_at.desc())
        .all()
    )


def _close_account_for_breach(db: Session, account: ChallengeAccount) -> None:
    open_trades = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "open")
        .all()
    )
    for trade in open_trades:
        sim_engine.close_position(db, account.id, trade.id, reason="breach", user_id=None)

    pending = (
        db.query(SimTrade)
        .filter(SimTrade.account_id == account.id, SimTrade.status == "pending")
        .all()
    )
    now = sim_engine._utcnow()
    for trade in pending:
        trade.status = "cancelled"
        trade.close_reason = "breach"
        trade.closed_at = now
        db.add(trade)

    account.status = "failed"
    db.add(account)


def breach_user_accounts(db: Session, user: User) -> int:
    accounts = (
        db.query(ChallengeAccount)
        .filter(
            ChallengeAccount.user_id == user.id,
            ChallengeAccount.status.in_(("active", "funded")),
        )
        .all()
    )
    for account in accounts:
        _close_account_for_breach(db, account)
    db.commit()
    return len(accounts)


def add_strike(
    db: Session,
    user: User,
    *,
    rule_label: str,
    reason: str,
) -> tuple[UserStrike, bool]:
    current = strike_count(db, user.id)
    if current >= STRIKE_LIMIT:
        raise ValueError(f"User already has {STRIKE_LIMIT} strikes — account is breached")

    label = (rule_label or "Rule violation").strip()[:120]
    body = (reason or "Rule violation recorded by admin.").strip()
    if not body:
        raise ValueError("Strike reason is required")

    strike = UserStrike(user_id=user.id, rule_label=label, reason=body)
    db.add(strike)
    db.flush()

    new_count = current + 1
    breached = new_count >= STRIKE_LIMIT

    create_notification(
        db,
        user.id,
        category="system",
        title=f"Strike {new_count} of {STRIKE_LIMIT} — {label}",
        body=body if not breached else f"{body} Your active challenge account(s) have been breached.",
    )

    if breached:
        breach_user_accounts(db, user)
        create_notification(
            db,
            user.id,
            category="system",
            title="Account breached",
            body=f"You received {STRIKE_LIMIT} strikes. Your active challenge account(s) have been breached and trading disabled.",
        )

    db.refresh(strike)
    return strike, breached


def clear_strikes(db: Session, user: User) -> int:
    count = strike_count(db, user.id)
    db.query(UserStrike).filter(UserStrike.user_id == user.id).delete()
    db.commit()
    return count


def risk_warnings_for_user(db: Session, user: User) -> list[dict]:
    strikes = list_strikes(db, user.id)
    count = len(strikes)
    if not count:
        return []

    warnings: list[dict] = []
    if count >= STRIKE_LIMIT:
        latest = strikes[0]
        warnings.append(
            {
                "kind": "breached",
                "title": f"Account breached · {latest.rule_label}",
                "subtitle": f"{count} of {STRIKE_LIMIT} strikes received · All active accounts breached · Trading disabled",
                "rule_label": latest.rule_label,
                "strike_count": count,
                "strike_limit": STRIKE_LIMIT,
            }
        )
        return warnings

    for strike in strikes:
        warnings.append(
            {
                "kind": "strike",
                "title": f"Risk warning · {strike.rule_label}",
                "subtitle": f"Current {count:.2f} · limit {STRIKE_LIMIT} · {strike.reason[:140]}",
                "rule_label": strike.rule_label,
                "strike_count": count,
                "strike_limit": STRIKE_LIMIT,
            }
        )
        break
    return warnings

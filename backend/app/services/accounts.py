import random

from sqlalchemy.orm import Session

from app.data import plans as plan_data
from app.models import ChallengeAccount, Order, User
from app.services.notifications import notify_checkout
from app.models.user_strike import STRIKE_LIMIT
from app.services.strikes import risk_warnings_for_user, strike_count


def _size_label(size: int) -> str:
    if size >= 1000:
        k = size / 1000
        return f"${k:g}K" if k == int(k) else f"${k:.1f}K"
    return f"${size}"


def generate_account_number(db: Session) -> str:
    for _ in range(20):
        num = str(random.randint(10000000, 99999999))
        exists = db.query(ChallengeAccount).filter(ChallengeAccount.account_number == num).first()
        if not exists:
            return num
    raise RuntimeError("Could not generate unique account number")


def account_to_summary(account: ChallengeAccount) -> AccountSummary:
    program = plan_data.PROGRAMS.get(account.program, plan_data.PROGRAMS["two-step"])
    phase = program["phases"][account.phase_index] if account.phase_index < len(program["phases"]) else program["phases"][0]
    profit_target = phase.get("profitTargetPct") or 0
    max_daily = phase.get("maxDailyLossPct") or 0
    max_overall = phase.get("maxOverallLossPct") or 0

    pnl = account.equity - account.starting_balance
    profit_progress = 0.0
    if profit_target:
        target_amt = account.starting_balance * (profit_target / 100)
        profit_progress = max(0.0, min(100.0, (pnl / target_amt) * 100)) if target_amt else 0.0

    loss_pct = max(0.0, ((account.starting_balance - account.equity) / account.starting_balance) * 100)

    return AccountSummary(
        id=account.id,
        account_number=account.account_number,
        program=account.program,
        program_label=plan_data.program_label(account.program),
        account_size=account.account_size,
        account_size_label=_size_label(account.account_size),
        phase_label=account.phase_label,
        status=account.status,
        balance=round(account.balance, 2),
        equity=round(account.equity, 2),
        open_pnl=round(account.open_pnl, 2),
        profit_target_pct=float(profit_target or 0),
        profit_target_progress=round(profit_progress, 2),
        max_daily_loss_pct=float(max_daily),
        max_overall_loss_pct=float(max_overall),
        daily_loss_used_pct=round(min(loss_pct, max_daily), 2),
        overall_loss_used_pct=round(min(loss_pct, max_overall), 2),
        starting_balance=round(float(account.starting_balance), 2),
        win_rate=round(float(account.win_rate or 0), 2),
        total_trades=int(account.total_trades or 0),
        created_at=account.created_at.isoformat() if account.created_at else "",
    )


def list_user_accounts(db: Session, user_id: int, status_filter: str | None = None) -> AccountsListResponse:
    q = db.query(ChallengeAccount).filter(ChallengeAccount.user_id == user_id).order_by(ChallengeAccount.created_at.desc())
    accounts = q.all()

    counts = {"all": len(accounts), "active": 0, "funded": 0, "failed": 0, "expired": 0, "passed": 0}
    for a in accounts:
        if a.status in counts:
            counts[a.status] += 1

    if status_filter and status_filter != "all":
        if status_filter == "breached":
            accounts = [a for a in accounts if a.status == "failed"]
        else:
            accounts = [a for a in accounts if a.status == status_filter]

    return AccountsListResponse(
        items=[account_to_summary(a) for a in accounts],
        counts=counts,
    )


def get_account(db: Session, user_id: int, account_id: int) -> ChallengeAccount | None:
    return (
        db.query(ChallengeAccount)
        .filter(ChallengeAccount.id == account_id, ChallengeAccount.user_id == user_id)
        .one_or_none()
    )


def dashboard_for_user(db: Session, user: User) -> DashboardResponse:
    accounts = (
        db.query(ChallengeAccount)
        .filter(ChallengeAccount.user_id == user.id)
        .order_by(ChallengeAccount.created_at.desc())
        .all()
    )
    total_spent = sum(o.amount for o in user.orders if o.status == "paid")
    primary = account_to_summary(accounts[0]) if accounts else None
    strikes = strike_count(db, user.id)
    warnings = risk_warnings_for_user(db, user)
    return DashboardResponse(
        has_accounts=bool(accounts),
        primary_account=primary,
        total_accounts=len(accounts),
        total_spent=round(total_spent, 2),
        user_name=user.full_name,
        strike_count=strikes,
        strike_limit=STRIKE_LIMIT,
        is_breached=strikes >= STRIKE_LIMIT,
        risk_warnings=warnings,
    )


def mock_checkout(
    db: Session,
    user: User,
    program: str,
    account_size: int,
    coupon_code: str | None,
    referral_code: str | None,
) -> tuple[Order, ChallengeAccount]:
    sizes = plan_data.get_sizes(program)
    if account_size not in sizes:
        raise ValueError("Invalid account size for program")

    amount = plan_data.get_price(account_size, program, coupon_code)
    base_amount = plan_data.get_base_price(account_size, program)
    account_number = generate_account_number(db)
    phase_label = plan_data.initial_phase(program)

    account = ChallengeAccount(
        user_id=user.id,
        account_number=account_number,
        program=program,
        account_size=account_size,
        phase_label=phase_label,
        phase_index=0,
        status="funded" if program == "instant" else "active",
        starting_balance=float(account_size),
        balance=float(account_size),
        equity=float(account_size),
        open_pnl=0.0,
    )
    db.add(account)
    db.flush()

    order = Order(
        user_id=user.id,
        challenge_account_id=account.id,
        program=program,
        account_size=account_size,
        amount=amount,
        base_amount=base_amount,
        coupon_code=coupon_code.upper() if coupon_code else None,
        referral_code=referral_code,
        status="paid",
        payment_method="mock",
    )
    db.add(order)
    db.commit()
    db.refresh(account)
    db.refresh(order)

    size_label = _size_label(account_size)
    notify_checkout(db, user.id, plan_data.program_label(program), size_label, account_number)
    return order, account

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.accounts import account_to_summary, dashboard_for_user, get_account, list_user_accounts

router = APIRouter(prefix="/trade", tags=["trade"])


@router.get("/snapshot")
def trade_snapshot(
    account_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Account + trade panels for the web terminal (positions pending MT5 Manager)."""
    dash = dashboard_for_user(db, user)
    accounts = list_user_accounts(db, user.id, None)

    account = None
    if account_id is not None:
        row = get_account(db, user.id, account_id)
        if row:
            account = account_to_summary(row)
    elif dash.primary_account:
        account = dash.primary_account
    elif accounts.items:
        account = accounts.items[0]

    return {
        "account": account.model_dump() if account else None,
        "accounts": [
            {
                "id": a.id,
                "account_number": a.account_number,
                "phase_label": a.phase_label,
                "label": f"#{a.account_number} · {a.phase_label}",
            }
            for a in accounts.items
        ],
        "open": [],
        "pending": [],
        "closed": [],
        "counts": {"open": 0, "pending": 0, "closed": 0},
    }


@router.get("/positions")
def open_positions(user: User = Depends(get_current_user), account_id: int | None = None):
    return {"items": [], "account_id": account_id}


@router.get("/orders/pending")
def pending_orders(user: User = Depends(get_current_user), account_id: int | None = None):
    return {"items": [], "account_id": account_id}


@router.get("/deals/closed")
def closed_deals(user: User = Depends(get_current_user), account_id: int | None = None, limit: int = 50):
    return {"items": [], "account_id": account_id}

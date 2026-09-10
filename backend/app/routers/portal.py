from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import AccountSummary, AccountsListResponse, DashboardResponse
from app.services.accounts import account_to_summary, dashboard_for_user, get_account, list_user_accounts

router = APIRouter(tags=["accounts"])


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return dashboard_for_user(db, user)


@router.get("/accounts", response_model=AccountsListResponse)
def accounts(
    status: str | None = Query(default="all"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_user_accounts(db, user.id, None if status == "all" else status)


@router.get("/accounts/{account_id}", response_model=AccountSummary)
def account_detail(account_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = get_account(db, user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Account not found"})
    return account_to_summary(account)



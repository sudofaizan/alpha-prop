from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import AccountSummary, AccountsListResponse, CheckoutRequest, CheckoutResponse, DashboardResponse
from app.services.accounts import account_to_summary, dashboard_for_user, get_account, list_user_accounts, mock_checkout

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


@router.post("/checkout/pay", response_model=CheckoutResponse)
def checkout_pay(payload: CheckoutRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not payload.terms_accepted or not payload.refund_accepted:
        raise HTTPException(
            status_code=400,
            detail={"code": "TERMS_REQUIRED", "message": "Accept terms and refund policy to continue"},
        )
    try:
        order, account = mock_checkout(
            db,
            user,
            payload.program,
            payload.account_size,
            payload.coupon_code,
            payload.referral_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "INVALID_CHECKOUT", "message": str(exc)}) from exc

    return CheckoutResponse(
        order_id=order.id,
        account_id=account.id,
        account_number=account.account_number,
        amount=order.amount,
        message="Payment successful. Your challenge account is ready.",
    )

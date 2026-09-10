from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.dependencies_admin import get_admin_user
from app.models import User
from app.schemas import (
    CheckoutRequest,
    CheckoutResponse,
    CreateCryptoSessionResponse,
    PaymentSessionOut,
    PaymentSettingsOut,
    PaymentSettingsUpdate,
    SubmitTxHashRequest,
)
from app.services.accounts import mock_checkout
from app.services.payment_sessions import (
    create_crypto_session,
    get_admin_payment_settings,
    get_session_for_user,
    verify_session_hash,
)
from app.services.payment_settings import update_payment_settings

router = APIRouter(tags=["payment"])


@router.post("/checkout/crypto/session", response_model=CreateCryptoSessionResponse)
def create_session(
    payload: CheckoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.terms_accepted or not payload.refund_accepted:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Accept terms and refund policy to continue")
    data = create_crypto_session(
        db,
        user,
        payload.program,
        payload.account_size,
        payload.coupon_code,
        payload.referral_code,
    )
    return CreateCryptoSessionResponse(**data)


@router.get("/checkout/crypto/sessions/{session_id}", response_model=PaymentSessionOut)
def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return PaymentSessionOut(**get_session_for_user(db, user, session_id, check_balance=True))


@router.post("/checkout/crypto/sessions/{session_id}/verify-hash", response_model=PaymentSessionOut)
def verify_hash(
    session_id: str,
    payload: SubmitTxHashRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = verify_session_hash(db, user, session_id, payload.tx_hash)
    return PaymentSessionOut(**data)


@router.post("/checkout/pay", response_model=CheckoutResponse)
def checkout_pay_card(
    payload: CheckoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Instant mock checkout for card/demo — crypto uses /checkout/crypto/session."""
    from fastapi import HTTPException

    if not payload.terms_accepted or not payload.refund_accepted:
        raise HTTPException(status_code=400, detail="Accept terms and refund policy to continue")
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
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CheckoutResponse(
        order_id=order.id,
        account_id=account.id,
        account_number=account.account_number,
        amount=order.amount,
        message="Payment successful. Your challenge account is ready.",
    )


@router.get("/admin/payment-settings", response_model=PaymentSettingsOut)
def admin_get_payment_settings(
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    return PaymentSettingsOut(**get_admin_payment_settings(db))


@router.patch("/admin/payment-settings", response_model=PaymentSettingsOut)
def admin_update_payment_settings(
    payload: PaymentSettingsUpdate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    row = update_payment_settings(db, payload.wallet_address, payload.enabled)
    from app.services.payment_settings import settings_dict

    return PaymentSettingsOut(**settings_dict(row))

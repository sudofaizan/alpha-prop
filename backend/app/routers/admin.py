from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies_admin import get_admin_user
from app.models import ChallengeAccount, Order, User
from app.schemas import AdminUserOut, BlockUserRequest, MessageResponse
from app.services.accounts import account_to_summary

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user_row(db: Session, user: User) -> AdminUserOut:
    account_count = db.query(ChallengeAccount).filter(ChallengeAccount.user_id == user.id).count()
    order_count = db.query(Order).filter(Order.user_id == user.id).count()
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_admin=user.is_admin,
        is_blocked=user.is_blocked,
        blocked_reason=user.blocked_reason,
        account_count=account_count,
        order_count=order_count,
        created_at=user.created_at.isoformat() if user.created_at else "",
    )


@router.get("/users")
def list_users(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return {"items": [_admin_user_row(db, u) for u in users]}


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

    return _admin_user_row(db, user)


@router.get("/accounts")
def admin_accounts(_admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    rows = db.query(ChallengeAccount).options(joinedload(ChallengeAccount.user)).order_by(ChallengeAccount.created_at.desc()).all()
    return {
        "items": [
            {
                **account_to_summary(a).model_dump(),
                "user_id": a.user_id,
                "user_email": a.user.email if a.user else None,
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
    return {
        "users": db.query(User).count(),
        "blocked_users": db.query(User).filter(User.is_blocked.is_(True)).count(),
        "accounts": db.query(ChallengeAccount).count(),
        "orders": db.query(Order).count(),
        "revenue": round(sum(o.amount for o in db.query(Order).filter(Order.status == "paid").all()), 2),
    }

from sqlalchemy.orm import Session, joinedload

from app.data import plans as plan_data
from app.models import Order, User
from app.services.accounts import _size_label


def billing_summary(db: Session, user: User) -> dict:
    orders = (
        db.query(Order)
        .options(joinedload(Order.account))
        .filter(Order.user_id == user.id)
        .order_by(Order.created_at.desc())
        .all()
    )

    paid = [o for o in orders if o.status == "paid"]
    pending = [o for o in orders if o.status == "pending"]
    expired = [o for o in orders if o.status == "expired"]

    items = []
    for o in orders:
        base = o.base_amount if o.base_amount is not None else o.amount
        items.append(
            {
                "id": o.id,
                "created_at": o.created_at.isoformat() if o.created_at else "",
                "program": o.program,
                "program_label": plan_data.program_label(o.program),
                "account_size": o.account_size,
                "account_size_label": _size_label(o.account_size),
                "amount": round(o.amount, 2),
                "base_amount": round(base, 2),
                "coupon_code": o.coupon_code,
                "status": o.status,
                "payment_method": o.payment_method,
                "account_number": o.account.account_number if o.account else None,
            }
        )

    return {
        "total_spent": round(sum(o.amount for o in paid), 2),
        "successful_purchases": len(paid),
        "pending_payments": len(pending),
        "counts": {
            "all": len(orders),
            "paid": len(paid),
            "pending": len(pending),
            "expired": len(expired),
        },
        "items": items,
    }

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.billing import billing_summary
from app.services.notifications import list_notifications, mark_all_read, unread_count

router = APIRouter(tags=["billing-notifications"])


@router.get("/billing")
def get_billing(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return billing_summary(db, user)


@router.get("/notifications")
def get_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notes = list_notifications(db, user.id)
    counts = {"all": len(notes), "payout": 0, "kyc": 0, "system": 0, "unread": 0}
    items = []
    for n in notes:
        if n.category in counts:
            counts[n.category] += 1
        if not n.is_read:
            counts["unread"] += 1
        items.append(
            {
                "id": n.id,
                "category": n.category,
                "title": n.title,
                "body": n.body,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else "",
            }
        )
    return {"items": items, "counts": counts}


@router.get("/notifications/unread-count")
def get_unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"count": unread_count(db, user.id)}


@router.post("/notifications/read-all")
def read_all_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mark_all_read(db, user.id)
    return {"message": "All notifications marked as read"}

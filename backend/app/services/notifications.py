from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Notification


def create_notification(
    db: Session,
    user_id: int,
    *,
    category: str,
    title: str,
    body: str,
) -> Notification:
    note = Notification(user_id=user_id, category=category, title=title, body=body)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def notify_checkout(db: Session, user_id: int, program_label: str, size_label: str, account_number: str) -> None:
    create_notification(
        db,
        user_id,
        category="system",
        title="Payment confirmed",
        body=f"Your {size_label} {program_label} challenge payment was received. Account #{account_number} is being provisioned.",
    )
    create_notification(
        db,
        user_id,
        category="system",
        title="Trading account ready",
        body=f"Your {size_label} account #{account_number} is live. Open My Accounts to view credentials and statistics.",
    )


def list_notifications(db: Session, user_id: int) -> list[Notification]:
    return (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .all()
    )


def unread_count(db: Session, user_id: int) -> int:
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read.is_(False)).count()


def mark_all_read(db: Session, user_id: int) -> None:
    db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read.is_(False)).update(
        {"is_read": True}
    )
    db.commit()

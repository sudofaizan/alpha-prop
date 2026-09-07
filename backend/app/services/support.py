from datetime import datetime, timezone

from sqlalchemy.orm import Session, joinedload

from app.models import SupportMessage, SupportTicket, User
from app.services.notifications import create_notification
from app.utils.time_format import utc_iso


def _message_row(msg: SupportMessage) -> dict:
    sender = msg.sender
    return {
        "id": msg.id,
        "body": msg.body,
        "is_staff": msg.is_staff,
        "sender_name": sender.full_name if sender else "Support",
        "created_at": utc_iso(msg.created_at),
    }


def _last_message(db: Session, ticket_id: int) -> SupportMessage | None:
    return (
        db.query(SupportMessage)
        .filter(SupportMessage.ticket_id == ticket_id)
        .order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc())
        .first()
    )


def _ticket_summary(db: Session, ticket: SupportTicket, *, include_user: bool = False) -> dict:
    last = _last_message(db, ticket.id)
    needs_reply = ticket.status == "open" and last is not None and not last.is_staff
    row = {
        "id": ticket.id,
        "subject": ticket.subject,
        "priority": ticket.priority,
        "status": ticket.status,
        "created_at": utc_iso(ticket.created_at),
        "updated_at": utc_iso(ticket.updated_at),
        "message_count": len(ticket.messages) if ticket.messages else db.query(SupportMessage).filter(SupportMessage.ticket_id == ticket.id).count(),
        "needs_reply": needs_reply,
        "last_message_at": utc_iso(last.created_at) if last else utc_iso(ticket.created_at),
    }
    if include_user and ticket.user:
        row["user_id"] = ticket.user_id
        row["user_email"] = ticket.user.email
        row["user_name"] = ticket.user.full_name
    return row


def list_user_tickets(db: Session, user_id: int) -> list[dict]:
    tickets = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages))
        .filter(SupportTicket.user_id == user_id)
        .order_by(SupportTicket.updated_at.desc())
        .all()
    )
    return [_ticket_summary(db, t) for t in tickets]


def list_all_tickets(db: Session) -> list[dict]:
    tickets = (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.user), joinedload(SupportTicket.messages))
        .order_by(SupportTicket.updated_at.desc())
        .all()
    )
    return [_ticket_summary(db, t, include_user=True) for t in tickets]


def get_ticket_for_user(db: Session, ticket_id: int, user_id: int) -> SupportTicket | None:
    return (
        db.query(SupportTicket)
        .options(joinedload(SupportTicket.messages).joinedload(SupportMessage.sender))
        .filter(SupportTicket.id == ticket_id, SupportTicket.user_id == user_id)
        .one_or_none()
    )


def get_ticket_admin(db: Session, ticket_id: int) -> SupportTicket | None:
    return (
        db.query(SupportTicket)
        .options(
            joinedload(SupportTicket.user),
            joinedload(SupportTicket.messages).joinedload(SupportMessage.sender),
        )
        .filter(SupportTicket.id == ticket_id)
        .one_or_none()
    )


def ticket_detail(ticket: SupportTicket, *, include_user: bool = False) -> dict:
    summary = {
        "id": ticket.id,
        "subject": ticket.subject,
        "priority": ticket.priority,
        "status": ticket.status,
        "created_at": utc_iso(ticket.created_at),
        "updated_at": utc_iso(ticket.updated_at),
        "messages": [_message_row(m) for m in ticket.messages],
    }
    if include_user and ticket.user:
        summary["user_id"] = ticket.user_id
        summary["user_email"] = ticket.user.email
        summary["user_name"] = ticket.user.full_name
    return summary


def create_ticket(db: Session, user: User, *, subject: str, priority: str, message: str) -> dict:
    ticket = SupportTicket(user_id=user.id, subject=subject.strip(), priority=priority.upper(), status="open")
    db.add(ticket)
    db.flush()
    msg = SupportMessage(ticket_id=ticket.id, sender_id=user.id, is_staff=False, body=message.strip())
    db.add(msg)
    ticket.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ticket)
    loaded = get_ticket_for_user(db, ticket.id, user.id)
    return ticket_detail(loaded)


def add_message(
    db: Session,
    ticket: SupportTicket,
    sender: User,
    body: str,
    *,
    is_staff: bool,
) -> dict:
    text = body.strip()
    if not text:
        raise ValueError("Message cannot be empty")
    msg = SupportMessage(ticket_id=ticket.id, sender_id=sender.id, is_staff=is_staff, body=text)
    db.add(msg)
    ticket.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    if is_staff and ticket.status == "open":
        create_notification(
            db,
            ticket.user_id,
            category="system",
            title="Support replied",
            body=f'New reply on "{ticket.subject}": {text[:120]}{"…" if len(text) > 120 else ""}',
        )
    return _message_row(msg)


def close_ticket(db: Session, ticket: SupportTicket) -> None:
    ticket.status = "closed"
    ticket.updated_at = datetime.now(timezone.utc)
    db.commit()


def open_ticket_count(db: Session) -> int:
    return db.query(SupportTicket).filter(SupportTicket.status == "open").count()


def awaiting_reply_count(db: Session) -> int:
    open_tickets = db.query(SupportTicket.id).filter(SupportTicket.status == "open").all()
    count = 0
    for (tid,) in open_tickets:
        last = _last_message(db, tid)
        if last and not last.is_staff:
            count += 1
    return count

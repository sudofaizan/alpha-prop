from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services import support as support_service

router = APIRouter(prefix="/support", tags=["support"])

VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "URGENT"}


class CreateTicketRequest(BaseModel):
    subject: str = Field(min_length=5, max_length=255)
    priority: str = "MEDIUM"
    message: str = Field(min_length=10)


class PostMessageRequest(BaseModel):
    body: str = Field(min_length=1)


@router.get("/tickets")
def list_tickets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"items": support_service.list_user_tickets(db, user.id)}


@router.post("/tickets", status_code=status.HTTP_201_CREATED)
def create_ticket(body: CreateTicketRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    priority = body.priority.upper()
    if priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_PRIORITY", "message": "Invalid priority"},
        )
    ticket = support_service.create_ticket(
        db,
        user,
        subject=body.subject,
        priority=priority,
        message=body.message,
    )
    return ticket


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = support_service.get_ticket_for_user(db, ticket_id, user.id)
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "Ticket not found"},
        )
    return support_service.ticket_detail(ticket)


@router.post("/tickets/{ticket_id}/messages")
def post_message(
    ticket_id: int,
    body: PostMessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ticket = support_service.get_ticket_for_user(db, ticket_id, user.id)
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "Ticket not found"},
        )
    if ticket.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "TICKET_CLOSED", "message": "This ticket is closed"},
        )
    try:
        msg = support_service.add_message(db, ticket, user, body.body, is_staff=False)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_MESSAGE", "message": str(exc)},
        ) from exc
    return {"message": msg}

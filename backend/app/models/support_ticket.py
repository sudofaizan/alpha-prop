from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    priority: Mapped[str] = mapped_column(String(16), default="MEDIUM", server_default="MEDIUM")
    status: Mapped[str] = mapped_column(String(16), default="open", server_default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="support_tickets")
    messages = relationship(
        "SupportMessage",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="SupportMessage.created_at.asc()",
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    is_staff: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("SupportTicket", back_populates="messages")
    sender = relationship("User")

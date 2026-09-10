from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PaymentSession(Base):
    __tablename__ = "payment_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), unique=True, index=True)
    amount: Mapped[float] = mapped_column(Float)
    wallet_address: Mapped[str] = mapped_column(String(64))
    baseline_balance: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending | completed | expired
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    tx_hash = mapped_column(String(80), nullable=True)
    confirmed_at = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="payment_sessions")
    order = relationship("Order", back_populates="payment_session")

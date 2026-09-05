from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    challenge_account_id = mapped_column(ForeignKey("challenge_accounts.id", ondelete="SET NULL"), nullable=True)
    program: Mapped[str] = mapped_column(String(32))
    account_size: Mapped[int] = mapped_column(Integer)
    amount: Mapped[float] = mapped_column(Float)
    base_amount = mapped_column(Float, nullable=True)
    coupon_code = mapped_column(String(64), nullable=True)
    referral_code = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="paid")  # paid | refunded
    payment_method: Mapped[str] = mapped_column(String(32), default="mock")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="orders")
    account = relationship("ChallengeAccount", back_populates="order")

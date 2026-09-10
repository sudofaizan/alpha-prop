from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UsedPaymentHash(Base):
    __tablename__ = "used_payment_hashes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tx_hash: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    payment_session_id: Mapped[int] = mapped_column(
        ForeignKey("payment_sessions.id", ondelete="CASCADE"), index=True
    )
    wallet_address: Mapped[str] = mapped_column(String(64))
    amount: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SimTrade(Base):
    """Simulated trade for challenge accounts (not sent to MT5)."""

    __tablename__ = "sim_trades"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("challenge_accounts.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))  # BUY | SELL
    volume: Mapped[float] = mapped_column(Float)
    entry_price: Mapped[float] = mapped_column(Float)
    exit_price = mapped_column(Float, nullable=True)
    stop_loss = mapped_column(Float, nullable=True)
    take_profit = mapped_column(Float, nullable=True)
    margin_used: Mapped[float] = mapped_column(Float, default=0.0)
    pnl = mapped_column(Float, nullable=True)
    order_type: Mapped[str] = mapped_column(String(16), default="market")  # market | limit | stop
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # pending | open | closed | cancelled
    close_reason = mapped_column(String(32), nullable=True)
    admin_close_message = mapped_column(Text, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at = mapped_column(DateTime(timezone=True), nullable=True)

    account = relationship("ChallengeAccount", back_populates="sim_trades")

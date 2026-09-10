from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.models import User
from app.services.auth import create_user, get_user_by_email


def _migrate_sim_trades() -> None:
    """Add columns to sim_trades on existing SQLite DBs (create_all does not alter)."""
    insp = inspect(engine)
    if "sim_trades" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("sim_trades")}
    with engine.begin() as conn:
        if "order_type" not in cols:
            conn.execute(text("ALTER TABLE sim_trades ADD COLUMN order_type VARCHAR(16) DEFAULT 'market'"))
        if "admin_close_message" not in cols:
            conn.execute(text("ALTER TABLE sim_trades ADD COLUMN admin_close_message TEXT"))


def _migrate_user_sessions() -> None:
    insp = inspect(engine)
    if "user_sessions" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("user_sessions")}
    with engine.begin() as conn:
        if "device_id" not in cols:
            conn.execute(text("ALTER TABLE user_sessions ADD COLUMN device_id VARCHAR(64)"))


def _migrate_orders_payment() -> None:
    insp = inspect(engine)
    if "orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("orders")}
    with engine.begin() as conn:
        if "tx_hash" not in cols:
            conn.execute(text("ALTER TABLE orders ADD COLUMN tx_hash VARCHAR(80)"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_sim_trades()
    _migrate_user_sessions()
    _migrate_orders_payment()
    seed_admin()
    seed_payment_settings()


def seed_payment_settings() -> None:
    from app.models import PaymentSettings
    from app.services.payment_settings import DEFAULT_WALLET

    db = SessionLocal()
    try:
        if db.query(PaymentSettings).filter(PaymentSettings.id == 1).one_or_none():
            return
        db.add(
            PaymentSettings(
                id=1,
                wallet_address=DEFAULT_WALLET,
                network="bep20",
                asset="usdt",
                enabled=True,
            )
        )
        db.commit()
    finally:
        db.close()


def seed_admin() -> None:
    db = SessionLocal()
    try:
        if get_user_by_email(db, settings.admin_email):
            return
        create_user(
            db,
            email=settings.admin_email,
            password=settings.admin_password,
            full_name=settings.admin_name,
            is_admin=True,
        )
        print(f"Seeded admin user: {settings.admin_email}")
    finally:
        db.close()

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

def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_sim_trades()
    seed_admin()


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

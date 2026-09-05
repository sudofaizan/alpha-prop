from app.config import settings
from app.database import Base, SessionLocal, engine
from app.models import User
from app.services.auth import create_user, get_user_by_email


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
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

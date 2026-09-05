from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import User, UserSession
from app.services.security import create_session_token, hash_password, hash_token, verify_password


class AuthError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower().strip()).first()


def authenticate_user(db: Session, email: str, password: str) -> User:
    user = get_user_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        raise AuthError("INVALID_CREDENTIALS", "Invalid email or password")
    if user.is_blocked:
        raise AuthError("USER_BLOCKED", user.blocked_reason or "Your account has been blocked. Contact support.")
    return user


def login_user(
    db: Session,
    user: User,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> tuple[str, UserSession]:
    """Create or replace the user's only active session."""
    token = create_session_token()
    token_hash = hash_token(token)

    session = db.query(UserSession).filter(UserSession.user_id == user.id).one_or_none()
    if session:
        session.token_hash = token_hash
        session.user_agent = user_agent
        session.ip_address = ip_address
    else:
        session = UserSession(
            user_id=user.id,
            token_hash=token_hash,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        db.add(session)

    db.commit()
    db.refresh(session)
    return token, session


def logout_user(db: Session, user: User) -> None:
    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
    db.commit()


def get_user_for_token(db: Session, token: str) -> User:
    token_hash = hash_token(token)
    session = db.query(UserSession).filter(UserSession.token_hash == token_hash).one_or_none()
    if not session:
        raise AuthError(
            "SESSION_INVALID",
            "Session expired or signed in elsewhere. Please log in again.",
        )

    user = db.query(User).filter(User.id == session.user_id).one_or_none()
    if not user:
        raise AuthError("SESSION_INVALID", "Session expired. Please log in again.")
    if user.is_blocked:
        raise AuthError("USER_BLOCKED", user.blocked_reason or "Your account has been blocked.")

    session.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return user


def create_user(db: Session, email: str, password: str, full_name: str, *, is_admin: bool = False) -> User:
    if get_user_by_email(db, email):
        raise AuthError("EMAIL_TAKEN", "An account with this email already exists")
    user = User(
        email=email.lower().strip(),
        password_hash=hash_password(password),
        full_name=full_name.strip(),
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

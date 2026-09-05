from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user
from app.models import User


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Admin access required"},
        )
    return user

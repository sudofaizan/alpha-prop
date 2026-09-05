from fastapi import APIRouter

from app.data import plans as plan_data

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("")
def get_plans():
    return plan_data.get_catalog()

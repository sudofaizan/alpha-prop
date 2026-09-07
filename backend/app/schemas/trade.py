from pydantic import BaseModel, Field


class PlaceOrderRequest(BaseModel):
    account_id: int
    symbol: str = Field(min_length=3, max_length=16)
    side: str = Field(pattern=r"^(?i)(buy|sell)$")
    volume: float = Field(gt=0, le=50)
    order_type: str = Field(default="market", pattern=r"^(?i)(market|limit|stop)$")
    price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None


class CancelPendingRequest(BaseModel):
    account_id: int


class ClosePositionRequest(BaseModel):
    account_id: int
    reason: str = "manual"


class UpdateStopsRequest(BaseModel):
    account_id: int
    stop_loss: float | None = None
    take_profit: float | None = None


class OrderResponse(BaseModel):
    ok: bool = True
    trade_id: int
    message: str = "Order filled (simulated)"

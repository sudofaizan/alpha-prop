from pydantic import BaseModel, Field


class PlaceOrderRequest(BaseModel):
    account_id: int
    symbol: str = Field(min_length=3, max_length=16)
    side: str = Field(pattern=r"^(?i)(buy|sell)$")
    volume: float = Field(gt=0, le=50)
    stop_loss: float | None = None
    take_profit: float | None = None


class ClosePositionRequest(BaseModel):
    account_id: int


class OrderResponse(BaseModel):
    ok: bool = True
    trade_id: int
    message: str = "Order filled (simulated)"

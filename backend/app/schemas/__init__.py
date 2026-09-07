from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_admin: bool = False
    is_blocked: bool = False
    created_at: str | None = None

    model_config = {"from_attributes": True}


def user_out(user) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_admin=user.is_admin,
        is_blocked=user.is_blocked,
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MessageResponse(BaseModel):
    message: str


class CheckoutRequest(BaseModel):
    program: str = Field(pattern=r"^(one-step|two-step|three-step|instant)$")
    account_size: int = Field(gt=0)
    coupon_code: str | None = None
    referral_code: str | None = None
    terms_accepted: bool = False
    refund_accepted: bool = False


class CheckoutResponse(BaseModel):
    order_id: int
    account_id: int
    account_number: str
    amount: float
    message: str


class AccountSummary(BaseModel):
    id: int
    account_number: str
    program: str
    program_label: str
    account_size: int
    account_size_label: str
    phase_label: str
    status: str
    balance: float
    equity: float
    open_pnl: float
    profit_target_pct: float
    profit_target_progress: float
    max_daily_loss_pct: float
    max_overall_loss_pct: float
    daily_loss_used_pct: float
    overall_loss_used_pct: float
    starting_balance: float = 0.0
    win_rate: float = 0.0
    total_trades: int = 0
    created_at: str

    model_config = {"from_attributes": True}


class AccountsListResponse(BaseModel):
    items: list[AccountSummary]
    counts: dict[str, int]


class DashboardResponse(BaseModel):
    has_accounts: bool
    primary_account: AccountSummary | None = None
    total_accounts: int = 0
    total_spent: float = 0.0


class AdminUserOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_admin: bool
    is_blocked: bool
    blocked_reason: str | None = None
    account_count: int = 0
    order_count: int = 0
    created_at: str


class BlockUserRequest(BaseModel):
    blocked: bool
    reason: str | None = None


class AdminClosePositionRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)

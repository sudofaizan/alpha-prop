from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)
    device_id: str | None = Field(default=None, max_length=64)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    device_id: str | None = Field(default=None, max_length=64)


class RiskWarningOut(BaseModel):
    kind: str
    title: str
    subtitle: str
    rule_label: str | None = None
    strike_count: int = 0
    strike_limit: int = 2


class UserOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_admin: bool = False
    is_blocked: bool = False
    created_at: str | None = None
    strike_count: int = 0
    strike_limit: int = 2
    is_breached: bool = False
    risk_warnings: list[RiskWarningOut] = []

    model_config = {"from_attributes": True}


def user_out(user, db=None) -> UserOut:
    strike_count_val = 0
    warnings: list[dict] = []
    is_breached = False
    strike_limit = 2
    if db is not None:
        from app.models.user_strike import STRIKE_LIMIT
        from app.services.strikes import risk_warnings_for_user, strike_count

        strike_limit = STRIKE_LIMIT
        strike_count_val = strike_count(db, user.id)
        warnings = risk_warnings_for_user(db, user)
        is_breached = strike_count_val >= STRIKE_LIMIT

    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_admin=user.is_admin,
        is_blocked=user.is_blocked,
        created_at=user.created_at.isoformat() if user.created_at else None,
        strike_count=strike_count_val,
        strike_limit=strike_limit,
        is_breached=is_breached,
        risk_warnings=warnings,
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


class CreateCryptoSessionResponse(BaseModel):
    session_id: str
    order_id: int
    status: str
    order_status: str
    amount: float
    wallet_address: str
    network: str
    asset: str
    baseline_balance: float
    current_balance: float | None = None
    balance_delta: float | None = None
    expires_at: str
    tx_hash: str | None = None
    account_number: str | None = None
    program: str
    program_label: str
    account_size: int
    account_size_label: str
    payment_method: str


class PaymentSessionOut(BaseModel):
    session_id: str
    order_id: int
    status: str
    order_status: str
    amount: float
    wallet_address: str
    network: str
    asset: str
    baseline_balance: float
    current_balance: float | None = None
    balance_delta: float | None = None
    expires_at: str
    tx_hash: str | None = None
    account_number: str | None = None
    program: str
    program_label: str
    account_size: int
    account_size_label: str
    payment_method: str
    message: str | None = None
    verified_amount: float | None = None


class SubmitTxHashRequest(BaseModel):
    tx_hash: str = Field(min_length=10, max_length=80)


class PaymentSettingsOut(BaseModel):
    wallet_address: str
    network: str
    asset: str
    enabled: bool
    updated_at: str


class PaymentSettingsUpdate(BaseModel):
    wallet_address: str = Field(min_length=10, max_length=64)
    enabled: bool = True


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
    user_name: str = ""
    strike_count: int = 0
    strike_limit: int = 2
    is_breached: bool = False
    risk_warnings: list[RiskWarningOut] = []


class StrikeOut(BaseModel):
    id: int
    rule_label: str
    reason: str
    created_at: str


class AddStrikeRequest(BaseModel):
    rule_label: str = Field(min_length=2, max_length=120)
    reason: str = Field(min_length=3, max_length=500)


class AdminUserOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_admin: bool
    is_blocked: bool
    blocked_reason: str | None = None
    strike_count: int = 0
    strike_limit: int = 2
    is_breached: bool = False
    account_count: int = 0
    order_count: int = 0
    created_at: str


class BlockUserRequest(BaseModel):
    blocked: bool
    reason: str | None = None


class AdminClosePositionRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)

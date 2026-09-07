from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.trade import CancelPendingRequest, ClosePositionRequest, OrderResponse, PlaceOrderRequest, UpdateStopsRequest
from app.services.accounts import account_to_summary, dashboard_for_user, get_account, list_user_accounts
from app.services import sim_engine

router = APIRouter(prefix="/trade", tags=["trade"])


def _resolve_account(db: Session, user: User, account_id: int | None):
    dash = dashboard_for_user(db, user)
    accounts = list_user_accounts(db, user.id, None)

    account = None
    if account_id is not None:
        account = get_account(db, user.id, account_id)
    elif dash.primary_account:
        account = get_account(db, user.id, dash.primary_account.id)
    elif accounts.items:
        account = get_account(db, user.id, accounts.items[0].id)

    return account, accounts


@router.get("/snapshot")
def trade_snapshot(
    account_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Account + simulated trade panels for the web terminal."""
    account, accounts = _resolve_account(db, user, account_id)
    summary = account_to_summary(account) if account else None
    panels = sim_engine.snapshot_for_account(db, account) if account else {
        "mode": "simulated",
        "trading_enabled": False,
        "open": [],
        "pending": [],
        "closed": [],
        "counts": {"open": 0, "pending": 0, "closed": 0},
        "metrics": None,
    }

    if account and panels.get("metrics"):
        m = panels["metrics"]
        summary = account_to_summary(account)
        summary = summary.model_copy(
            update={
                "balance": m["balance"],
                "equity": m["equity"],
                "open_pnl": m["open_pnl"],
            }
        )

    return {
        "account": summary.model_dump() if summary else None,
        "accounts": [
            {
                "id": a.id,
                "account_number": a.account_number,
                "phase_label": a.phase_label,
                "label": f"#{a.account_number} · {a.phase_label}",
            }
            for a in accounts.items
        ],
        "mode": panels["mode"],
        "trading_enabled": panels["trading_enabled"],
        "open": panels["open"],
        "pending": panels["pending"],
        "closed": panels["closed"],
        "counts": panels["counts"],
        "metrics": panels.get("metrics"),
        "stop_hits": panels.get("stop_hits") or [],
        "pending_fills": panels.get("pending_fills") or [],
    }


@router.post("/orders", response_model=OrderResponse)
def place_order(
    body: PlaceOrderRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Open a simulated market, limit, or stop order against live prices."""
    trade = sim_engine.place_order(
        db,
        user.id,
        body.account_id,
        body.symbol,
        body.side,
        body.volume,
        body.order_type,
        body.price,
        body.stop_loss,
        body.take_profit,
    )
    if trade.status == "pending":
        ot = (trade.order_type or "limit").upper()
        return OrderResponse(
            trade_id=trade.id,
            message=f"Pending {ot} {trade.side} {trade.volume} {trade.symbol} @ {trade.entry_price}",
        )
    return OrderResponse(trade_id=trade.id, message=f"Simulated {trade.side} {trade.volume} {trade.symbol} @ {trade.entry_price}")


@router.post("/positions/{trade_id}/close", response_model=OrderResponse)
def close_position(
    trade_id: int,
    body: ClosePositionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Close an open simulated position."""
    trade = sim_engine.close_position(db, user.id, body.account_id, trade_id, body.reason)
    return OrderResponse(trade_id=trade.id, message=f"Closed position #{trade.id} · P/L ${trade.pnl:.2f}")


@router.patch("/positions/{trade_id}/stops", response_model=OrderResponse)
def update_position_stops(
    trade_id: int,
    body: UpdateStopsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update stop loss / take profit on an open simulated position."""
    fields = body.model_fields_set
    trade = sim_engine.update_position_stops(
        db,
        user.id,
        body.account_id,
        trade_id,
        body.stop_loss,
        body.take_profit,
        set_stop_loss="stop_loss" in fields,
        set_take_profit="take_profit" in fields,
    )
    return OrderResponse(trade_id=trade.id, message="Stop levels updated")


@router.post("/orders/pending/{trade_id}/cancel", response_model=OrderResponse)
def cancel_pending_order(
    trade_id: int,
    body: CancelPendingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel a pending limit or stop order."""
    trade = sim_engine.cancel_pending_order(db, user.id, body.account_id, trade_id)
    return OrderResponse(trade_id=trade.id, message=f"Order #{trade.id} cancelled")


@router.get("/positions")
def open_positions(
    user: User = Depends(get_current_user),
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    account = get_account(db, user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    snap = sim_engine.snapshot_for_account(db, account)
    return {"items": snap["open"], "account_id": account_id}


@router.get("/orders/pending")
def pending_orders(user: User = Depends(get_current_user), account_id: int | None = None):
    return {"items": [], "account_id": account_id}


@router.get("/deals/closed")
def closed_deals(
    user: User = Depends(get_current_user),
    account_id: int = Query(...),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    account = get_account(db, user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    snap = sim_engine.snapshot_for_account(db, account)
    return {"items": snap["closed"][:limit], "account_id": account_id}

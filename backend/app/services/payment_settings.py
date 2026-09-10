from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import PaymentSettings

DEFAULT_WALLET = "0xaCb33094B4FeCd3e5113fe0E43C23B3Aa7d2616f"


def get_payment_settings(db: Session) -> PaymentSettings:
    row = db.query(PaymentSettings).filter(PaymentSettings.id == 1).one_or_none()
    if row:
        return row
    row = PaymentSettings(
        id=1,
        wallet_address=DEFAULT_WALLET,
        network="bep20",
        asset="usdt",
        enabled=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_payment_settings(db: Session, wallet_address: str, enabled: bool = True) -> PaymentSettings:
    row = get_payment_settings(db)
    row.wallet_address = wallet_address.strip()
    row.enabled = enabled
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def settings_dict(row: PaymentSettings) -> dict:
    return {
        "wallet_address": row.wallet_address,
        "network": row.network,
        "asset": row.asset,
        "enabled": row.enabled,
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }

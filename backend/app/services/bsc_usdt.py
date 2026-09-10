"""BSC BEP-20 USDT helpers — balance checks and tx verification."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request

from fastapi import HTTPException

from app.config import settings

USDT_BEP20 = "0x55d398326f99059fF775485246999027B3197955"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
BALANCE_OF = "0x70a08231"


def _rpc_url() -> str:
    return settings.bsc_rpc_url or "https://bsc-dataseed1.binance.org"


def _rpc_call(method: str, params: list) -> object:
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(
        _rpc_url(),
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"BSC RPC unavailable: {exc}") from exc
    if "error" in data:
        raise HTTPException(status_code=503, detail=f"BSC RPC error: {data['error']}")
    return data.get("result")


def _normalize_address(addr: str) -> str:
    return str(addr or "").strip().lower()


def get_usdt_balance(wallet_address: str) -> float:
    addr = _normalize_address(wallet_address)
    if not addr.startswith("0x") or len(addr) != 42:
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    data = BALANCE_OF + ("0" * 24) + addr[2:]
    raw = _rpc_call("eth_call", [{"to": USDT_BEP20, "data": data}, "latest"])
    if not raw:
        return 0.0
    return int(str(raw), 16) / 1e18


def _parse_transfer_amount(log: dict) -> tuple[str, str, float]:
    topics = log.get("topics") or []
    if len(topics) < 3:
        raise ValueError("Invalid transfer log")
    from_addr = "0x" + topics[1][-40:]
    to_addr = "0x" + topics[2][-40:]
    amount = int(log.get("data") or "0x0", 16) / 1e18
    return from_addr.lower(), to_addr.lower(), amount


def verify_usdt_incoming_tx(tx_hash: str, wallet_address: str, min_amount: float) -> dict:
    h = str(tx_hash or "").strip().lower()
    if not h.startswith("0x") or len(h) != 66:
        raise HTTPException(status_code=400, detail="Invalid transaction hash")
    wallet = _normalize_address(wallet_address)
    receipt = _rpc_call("eth_getTransactionReceipt", [h])
    if not receipt:
        raise HTTPException(status_code=400, detail="Transaction not found or still pending")
    status = receipt.get("status")
    if status not in ("0x1", 1, "1"):
        raise HTTPException(status_code=400, detail="Transaction failed on-chain")

    best = None
    for log in receipt.get("logs") or []:
        if _normalize_address(log.get("address") or "") != _normalize_address(USDT_BEP20):
            continue
        topics = log.get("topics") or []
        if not topics or str(topics[0]).lower() != TRANSFER_TOPIC.lower():
            continue
        try:
            _from, to_addr, amount = _parse_transfer_amount(log)
        except ValueError:
            continue
        if to_addr != wallet:
            continue
        if best is None or amount > best["amount"]:
            best = {"from": _from, "to": to_addr, "amount": amount, "tx_hash": h}

    if not best:
        raise HTTPException(status_code=400, detail="No USDT transfer to payment wallet in this transaction")
    if best["amount"] + 1e-6 < float(min_amount):
        raise HTTPException(
            status_code=400,
            detail=f"Transfer amount {best['amount']:.2f} USDT is less than required {min_amount:.2f} USDT",
        )
    return best

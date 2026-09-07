import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.services.auth import AuthError, get_user_for_token
from app.services.symbols import normalize_symbol
from app.services.tick_upstream import tick_upstream

log = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


def _authenticate_ws(token: str | None) -> bool:
    if not token:
        return False
    db = SessionLocal()
    try:
        get_user_for_token(db, token)
        return True
    except AuthError:
        return False
    finally:
        db.close()


async def _sender(client) -> None:
    """Single writer per WebSocket — avoids concurrent send/receive crashes."""
    try:
        while True:
            msg = await client.queue.get()
            if msg is None:
                break
            await client.ws.send_text(msg)
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    except Exception as exc:
        log.debug("WS sender stopped: %s", exc)


@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not _authenticate_ws(token):
        await websocket.close(code=4401)
        return

    await websocket.accept()
    client = tick_upstream.register(websocket)
    sender = asyncio.create_task(_sender(client))

    try:
        await websocket.send_json({"type": "hello", "service": "alphafx-quotes"})
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = msg.get("action")
            if action == "subscribe" and isinstance(msg.get("symbols"), list):
                symbols = [normalize_symbol(s) for s in msg["symbols"] if s]
                snapshot = tick_upstream.subscribe(websocket, symbols)
                await websocket.send_json({"type": "snapshot", "ticks": snapshot})
            elif action == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("WS quotes error: %s", exc)
    finally:
        sender.cancel()
        try:
            await sender
        except asyncio.CancelledError:
            pass
        tick_upstream.unsubscribe(websocket)

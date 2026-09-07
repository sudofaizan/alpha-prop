import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.services.auth import AuthError, get_user_for_token
from app.services.tick_upstream import tick_upstream

log = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


def _authenticate_ws(token: str | None) -> bool:
    if not token:
        return False
    db: Session = SessionLocal()
    try:
        get_user_for_token(db, token)
        return True
    except AuthError:
        return False
    finally:
        db.close()


@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not _authenticate_ws(token):
        await websocket.close(code=4401)
        return

    await websocket.accept()
    tick_upstream.subscribe(websocket, [])

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
                symbols = [str(s).upper() for s in msg["symbols"] if s]
                snapshot = tick_upstream.subscribe(websocket, symbols)
                await websocket.send_json({"type": "snapshot", "ticks": snapshot})
            elif action == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        tick_upstream.unsubscribe(websocket)

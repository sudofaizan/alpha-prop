#!/usr/bin/env python3
"""
AlphaFX Tick Hub — ingest MT5 ticks (TCP) and fan out to WebSocket clients.

Usage:
  python hub.py                    # ingest on :9001, ws on :9002, health on :9003
  python hub.py --mock             # also emit synthetic ticks (local dev)
  TICK_HUB_SYMBOLS=EURUSD,XAUUSD python hub.py --mock
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

try:
    from aiohttp import web
except ImportError:
    web = None  # type: ignore

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except ImportError:
    websockets = None  # type: ignore
    WebSocketServerProtocol = object  # type: ignore

log = logging.getLogger("tick-hub")

DEFAULT_SYMBOLS = ["EURUSD", "XAUUSD", "BTCUSD", "GBPUSD", "USDJPY"]


@dataclass
class TickStore:
    last: dict[str, dict[str, Any]] = field(default_factory=dict)
    ring: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=5000))
    subscribers: set[Any] = field(default_factory=set)

    def ingest(self, tick: dict[str, Any]) -> dict[str, Any]:
        raw_sym = str(tick["symbol"]).upper()
        sym = raw_sym
        for suffix in (".C", ".M", ".I", ".PRO"):
            if sym.endswith(suffix):
                sym = sym[: -len(suffix)]
                break
        tick = {
            "type": "tick",
            "symbol": sym,
            "bid": float(tick["bid"]),
            "ask": float(tick["ask"]),
            "time_ms": int(tick.get("time_ms") or time.time() * 1000),
            "source": tick.get("source", "mt5"),
        }
        self.last[sym] = tick
        self.ring.append(tick)
        return tick

    def snapshot(self, symbols: list[str]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for sym in symbols:
            sym = sym.upper()
            if sym in self.last:
                out.append(self.last[sym])
        return out


store = TickStore()


async def broadcast(tick: dict[str, Any]) -> None:
    if not store.subscribers:
        return
    msg = json.dumps(tick)
    dead: set[Any] = set()
    for ws in list(store.subscribers):
        try:
            await ws.send(msg)
        except Exception:
            dead.add(ws)
    store.subscribers -= dead


async def handle_tcp_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername")
    log.info("TCP ingest connected: %s", peer)
    buf = ""
    try:
        while True:
            chunk = await reader.read(4096)
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    log.warning("Invalid JSON from %s: %s", peer, line[:120])
                    continue
                if payload.get("type") == "heartbeat":
                    continue
                if "symbol" not in payload or "bid" not in payload or "ask" not in payload:
                    continue
                tick = store.ingest(payload)
                await broadcast(tick)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.warning("TCP client error %s: %s", peer, exc)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        log.info("TCP ingest disconnected: %s", peer)


async def handle_ws_client(websocket: WebSocketServerProtocol) -> None:
    store.subscribers.add(websocket)
    log.info("WS client connected (%d total)", len(store.subscribers))
    try:
        await websocket.send(json.dumps({"type": "hello", "service": "alphafx-tick-hub"}))
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("action") == "snapshot" and isinstance(msg.get("symbols"), list):
                ticks = store.snapshot(msg["symbols"])
                await websocket.send(json.dumps({"type": "snapshot", "ticks": ticks}))
    except Exception as exc:
        log.debug("WS client closed: %s", exc)
    finally:
        store.subscribers.discard(websocket)
        log.info("WS client disconnected (%d total)", len(store.subscribers))


async def mock_tick_loop(symbols: list[str]) -> None:
    """Synthetic ticks for local development without MT5."""
    seeds = {
        "EURUSD": 1.0850,
        "GBPUSD": 1.2650,
        "USDJPY": 149.50,
        "XAUUSD": 2650.0,
        "BTCUSD": 80000.0,
    }
    prices = {s: seeds.get(s, 100.0) for s in symbols}
    spreads = {
        "EURUSD": 0.00015,
        "GBPUSD": 0.00018,
        "USDJPY": 0.020,
        "XAUUSD": 0.35,
        "BTCUSD": 18.0,
    }
    log.info("Mock tick generator running for: %s", ", ".join(symbols))
    while True:
        for sym in symbols:
            drift = random.uniform(-0.00008, 0.00008)
            if sym == "XAUUSD":
                drift = random.uniform(-0.5, 0.5)
            if sym == "BTCUSD":
                drift = random.uniform(-15, 15)
            prices[sym] = max(0.0001, prices[sym] + drift)
            spread = spreads.get(sym, 0.0002)
            bid = round(prices[sym], 5 if sym != "BTCUSD" else 3)
            ask = round(bid + spread, 5 if sym != "BTCUSD" else 3)
            tick = store.ingest(
                {"symbol": sym, "bid": bid, "ask": ask, "time_ms": int(time.time() * 1000), "source": "mock"}
            )
            await broadcast(tick)
        await asyncio.sleep(0.25)


async def health_handler(_request: web.Request) -> web.Response:
    return web.json_response(
        {
            "status": "ok",
            "service": "alphafx-tick-hub",
            "subscribers": len(store.subscribers),
            "symbols_cached": len(store.last),
            "last_symbols": sorted(store.last.keys()),
        }
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="AlphaFX Tick Hub")
    parser.add_argument("--tcp-host", default="0.0.0.0")
    parser.add_argument("--tcp-port", type=int, default=9001)
    parser.add_argument("--ws-host", default="0.0.0.0")
    parser.add_argument("--ws-port", type=int, default=9002)
    parser.add_argument("--health-port", type=int, default=9003)
    parser.add_argument("--mock", action="store_true", help="Emit synthetic ticks")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if websockets is None:
        raise SystemExit("Install dependencies: pip install websockets aiohttp")

    symbols_env = __import__("os").environ.get("TICK_HUB_SYMBOLS", "")
    symbols = [s.strip().upper() for s in symbols_env.split(",") if s.strip()] or DEFAULT_SYMBOLS

    tcp_server = await asyncio.start_server(handle_tcp_client, args.tcp_host, args.tcp_port)
    ws_server = await websockets.serve(handle_ws_client, args.ws_host, args.ws_port, ping_interval=20)

    health_runner = None
    if web is not None:
        app = web.Application()
        app.router.add_get("/health", health_handler)
        health_runner = web.AppRunner(app)
        await health_runner.setup()
        await web.TCPSite(health_runner, "0.0.0.0", args.health_port).start()

    mock_task = None
    if args.mock:
        mock_task = asyncio.create_task(mock_tick_loop(symbols))

    log.info(
        "Tick hub listening tcp=%s:%d ws=%s:%d health=:%d",
        args.tcp_host, args.tcp_port, args.ws_host, args.ws_port, args.health_port,
    )

    try:
        await asyncio.Event().wait()
    finally:
        if mock_task:
            mock_task.cancel()
        tcp_server.close()
        await tcp_server.wait_closed()
        ws_server.close()
        await ws_server.wait_closed()
        if health_runner:
            await health_runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())

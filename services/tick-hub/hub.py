#!/usr/bin/env python3
"""
AlphaFX Tick Hub — ingest MT5 ticks + bar history (TCP) and fan out to WebSocket clients.

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
MAX_BARS_PER_KEY = 500


def normalize_symbol(raw: str) -> str:
    sym = str(raw or "").upper()
    for suffix in (".C", ".M", ".I", ".PRO"):
        if sym.endswith(suffix):
            return sym[: -len(suffix)]
    return sym


@dataclass
class TickStore:
    last: dict[str, dict[str, Any]] = field(default_factory=dict)
    ring: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=5000))
    subscribers: set[Any] = field(default_factory=set)

    def ingest(self, tick: dict[str, Any]) -> dict[str, Any]:
        sym = normalize_symbol(str(tick["symbol"]))
        tick = {
            "type": "tick",
            "symbol": sym,
            "bid": float(tick["bid"]),
            "ask": float(tick["ask"]),
            "time_ms": int(tick.get("time_ms") or time.time() * 1000),
            "source": tick.get("source", "mt5"),
        }
        if tick["source"] == "mt5":
            _mt5_last[sym] = time.time()
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


@dataclass
class BarStore:
    """Latest MT5 OHLC snapshots keyed by (symbol, timeframe)."""

    cache: dict[tuple[str, str], list[dict[str, Any]]] = field(default_factory=dict)
    updated_at: dict[tuple[str, str], float] = field(default_factory=dict)

    def ingest(self, payload: dict[str, Any]) -> dict[str, Any]:
        sym = normalize_symbol(str(payload.get("symbol", "")))
        tf = str(payload.get("timeframe", "M1")).upper()
        incoming = payload.get("bars") or []
        if not sym or not incoming:
            return {"symbol": sym, "timeframe": tf, "count": 0}

        cleaned: list[dict[str, Any]] = []
        for bar in incoming:
            try:
                cleaned.append(
                    {
                        "time": int(bar["time"]),
                        "open": float(bar["open"]),
                        "high": float(bar["high"]),
                        "low": float(bar["low"]),
                        "close": float(bar["close"]),
                    }
                )
            except (KeyError, TypeError, ValueError):
                continue

        if not cleaned:
            return {"symbol": sym, "timeframe": tf, "count": 0}

        cleaned.sort(key=lambda b: b["time"])
        # De-duplicate by bar open time (keep last)
        dedup: dict[int, dict[str, Any]] = {}
        for bar in cleaned:
            dedup[bar["time"]] = bar
        merged = [dedup[t] for t in sorted(dedup)]
        self.cache[(sym, tf)] = merged[-MAX_BARS_PER_KEY:]
        self.updated_at[(sym, tf)] = time.time()
        log.info("Bar cache updated %s %s (%d bars)", sym, tf, len(self.cache[(sym, tf)]))
        return {"symbol": sym, "timeframe": tf, "count": len(self.cache[(sym, tf)])}

    def get(self, symbol: str, timeframe: str = "M1", limit: int = 300) -> list[dict[str, Any]]:
        sym = normalize_symbol(symbol)
        tf = timeframe.upper()
        bars = self.cache.get((sym, tf), [])
        if limit <= 0:
            return list(bars)
        return bars[-limit:]

    def age_seconds(self, symbol: str, timeframe: str = "M1") -> float | None:
        sym = normalize_symbol(symbol)
        tf = timeframe.upper()
        ts = self.updated_at.get((sym, tf))
        if ts is None:
            return None
        return time.time() - ts


store = TickStore()
bar_store = BarStore()
# Symbols recently updated by MT5 — mock must not overwrite these
_mt5_last: dict[str, float] = {}


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


async def handle_tcp_payload(payload: dict[str, Any]) -> None:
    msg_type = payload.get("type")
    if msg_type == "heartbeat":
        return
    if msg_type == "bars":
        bar_store.ingest(payload)
        return
    if msg_type == "tick" or ("symbol" in payload and "bid" in payload and "ask" in payload):
        tick = store.ingest(payload)
        await broadcast(tick)


async def handle_tcp_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername")
    log.info("TCP ingest connected: %s", peer)
    buf = ""
    try:
        while True:
            chunk = await reader.read(65536)
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
                await handle_tcp_payload(payload)
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
        now = time.time()
        for sym in symbols:
            if now - _mt5_last.get(sym, 0) < 120:
                continue
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
    bar_keys = [f"{sym}:{tf}" for (sym, tf) in bar_store.cache]
    return web.json_response(
        {
            "status": "ok",
            "service": "alphafx-tick-hub",
            "subscribers": len(store.subscribers),
            "symbols_cached": len(store.last),
            "last_symbols": sorted(store.last.keys()),
            "bar_symbols": bar_keys,
            "bar_count": sum(len(v) for v in bar_store.cache.values()),
        }
    )


async def bars_handler(request: web.Request) -> web.Response:
    symbol = request.rel_url.query.get("symbol", "").strip()
    timeframe = request.rel_url.query.get("timeframe", "M1").strip().upper() or "M1"
    try:
        limit = int(request.rel_url.query.get("limit", "300"))
    except ValueError:
        limit = 300
    limit = max(1, min(limit, MAX_BARS_PER_KEY))

    if not symbol:
        return web.json_response({"detail": "symbol required"}, status=400)

    sym = normalize_symbol(symbol)
    bars = bar_store.get(sym, timeframe, limit)
    age = bar_store.age_seconds(sym, timeframe)
    return web.json_response(
        {
            "symbol": sym,
            "timeframe": timeframe,
            "source": "mt5" if bars else "none",
            "bars": bars,
            "count": len(bars),
            "age_seconds": round(age, 1) if age is not None else None,
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
        app.router.add_get("/bars", bars_handler)
        health_runner = web.AppRunner(app)
        await health_runner.setup()
        await web.TCPSite(health_runner, "0.0.0.0", args.health_port).start()

    mock_task = None
    if args.mock:
        mock_task = asyncio.create_task(mock_tick_loop(symbols))

    log.info(
        "Tick hub listening tcp=%s:%d ws=%s:%d health/bars=:%d",
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

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.services.symbols import normalize_symbol

log = logging.getLogger(__name__)


@dataclass
class QuoteClient:
    """One browser WebSocket — ticks are queued; the route handler is the only sender."""

    ws: Any
    symbols: set[str] = field(default_factory=set)
    queue: asyncio.Queue[str | None] = field(default_factory=asyncio.Queue)


class TickUpstream:
    """Maintains connection to tick hub and fans ticks to portal WS clients."""

    def __init__(self) -> None:
        self._clients: dict[Any, QuoteClient] = {}
        self._last: dict[str, dict[str, Any]] = {}
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        for client in list(self._clients.values()):
            try:
                client.queue.put_nowait(None)
            except Exception:
                pass

    def register(self, ws: Any) -> QuoteClient:
        client = QuoteClient(ws=ws)
        self._clients[ws] = client
        return client

    def subscribe(self, ws: Any, symbols: list[str]) -> list[dict[str, Any]]:
        client = self._clients.get(ws)
        if not client:
            return []
        client.symbols = {normalize_symbol(s) for s in symbols if s}
        return [self._last[s] for s in client.symbols if s in self._last]

    def unsubscribe(self, ws: Any) -> None:
        client = self._clients.pop(ws, None)
        if client:
            try:
                client.queue.put_nowait(None)
            except Exception:
                pass

    def last_quote(self, symbol: str) -> dict[str, Any] | None:
        return self._last.get(normalize_symbol(symbol))

    async def _run(self) -> None:
        while True:
            if settings.tick_mock or not settings.tick_hub_ws:
                await self._mock_loop()
                continue
            try:
                await self._hub_loop()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("Tick hub upstream error: %s — retry in 3s", exc)
                await asyncio.sleep(3)

    async def _hub_loop(self) -> None:
        import websockets

        url = settings.tick_hub_ws
        log.info("Connecting to tick hub %s", url)
        async with websockets.connect(url, ping_interval=20) as upstream:
            log.info("Tick hub upstream connected")
            async for raw in upstream:
                try:
                    tick = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if tick.get("type") != "tick":
                    continue
                await self._ingest_tick(tick)

    async def _mock_loop(self) -> None:
        seeds = {"EURUSD": 1.0850, "GBPUSD": 1.2650, "USDJPY": 149.5, "XAUUSD": 2650.0, "BTCUSD": 80000.0}
        spreads = {"EURUSD": 0.00015, "GBPUSD": 0.00018, "USDJPY": 0.02, "XAUUSD": 0.35, "BTCUSD": 18.0}
        prices = dict(seeds)
        symbols = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"]
        log.info("Tick upstream mock mode active")
        while settings.tick_mock or not settings.tick_hub_ws:
            for sym in symbols:
                drift = random.uniform(-0.00008, 0.00008)
                if sym == "XAUUSD":
                    drift = random.uniform(-0.5, 0.5)
                if sym == "BTCUSD":
                    drift = random.uniform(-15, 15)
                prices[sym] = max(0.0001, prices[sym] + drift)
                spread = spreads[sym]
                bid = round(prices[sym], 5 if sym != "BTCUSD" else 3)
                ask = round(bid + spread, 5 if sym != "BTCUSD" else 3)
                await self._ingest_tick(
                    {
                        "type": "tick",
                        "symbol": sym,
                        "bid": bid,
                        "ask": ask,
                        "time_ms": int(time.time() * 1000),
                        "source": "mock",
                    }
                )
            await asyncio.sleep(0.25)

    async def _ingest_tick(self, tick: dict[str, Any]) -> None:
        sym = normalize_symbol(str(tick.get("symbol", "")))
        source = tick.get("source", "mt5")
        prev = self._last.get(sym)
        if prev and prev.get("source") == "mt5" and source == "mock":
            return
        tick = {**tick, "symbol": sym, "source": source}
        self._last[sym] = tick
        await self._fanout(tick)

    async def _fanout(self, tick: dict[str, Any]) -> None:
        sym = tick["symbol"]
        msg = json.dumps(tick)
        for client in list(self._clients.values()):
            if sym not in client.symbols:
                continue
            try:
                client.queue.put_nowait(msg)
            except Exception:
                self.unsubscribe(client.ws)


tick_upstream = TickUpstream()

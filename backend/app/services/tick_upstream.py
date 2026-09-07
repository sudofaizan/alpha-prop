import asyncio
import json
import logging
import random
import time
from typing import Any

from app.config import settings
from app.services.symbols import normalize_symbol

log = logging.getLogger(__name__)


class TickUpstream:
    """Maintains connection to tick hub and fans ticks to portal WS clients."""

    def __init__(self) -> None:
        self._clients: dict[Any, set[str]] = {}
        self._last: dict[str, dict[str, Any]] = {}
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

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

    def subscribe(self, ws: Any, symbols: list[str]) -> list[dict[str, Any]]:
        syms = {normalize_symbol(s) for s in symbols if s}
        self._clients[ws] = syms
        return [self._last[s] for s in syms if s in self._last]

    def unsubscribe(self, ws: Any) -> None:
        self._clients.pop(ws, None)

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
                sym = normalize_symbol(str(tick.get("symbol", "")))
                source = tick.get("source", "mt5")
                prev = self._last.get(sym)
                if prev and prev.get("source") == "mt5" and source == "mock":
                    continue
                tick = {**tick, "symbol": sym, "source": source}
                self._last[sym] = tick
                await self._fanout(tick)

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
                tick = {
                    "type": "tick",
                    "symbol": sym,
                    "bid": bid,
                    "ask": ask,
                    "time_ms": int(time.time() * 1000),
                    "source": "mock",
                }
                self._last[sym] = tick
                await self._fanout(tick)
            await asyncio.sleep(0.25)

    async def _fanout(self, tick: dict[str, Any]) -> None:
        sym = tick["symbol"]
        msg = json.dumps(tick)
        dead: list[Any] = []
        for ws, syms in list(self._clients.items()):
            if sym not in syms:
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(ws)


tick_upstream = TickUpstream()

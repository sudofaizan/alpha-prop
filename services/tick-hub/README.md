# AlphaFX Tick Hub

Ingests newline-delimited JSON from the MT5 EA (TCP) and fans out ticks to WebSocket clients. Caches OHLC bar history for the portal chart.

## Ports

| Port | Purpose |
|------|---------|
| 9001 | TCP ingest (MQL5 EA — ticks + bars) |
| 9002 | WebSocket downstream (portal API) |
| 9003 | HTTP `/health` and `/bars` |

## Run

```bash
./run.sh              # ingest only
TICK_HUB_MOCK=1 ./run.sh   # + synthetic ticks for dev
```

## MT5 Expert (Windows)

Attach **one** EA to any chart:

| EA | File | Sends |
|----|------|-------|
| AlphaFXBridge | `mt5/AlphaFXBridge.mq5` | Live ticks + M1 OHLC history |

Compile in MetaEditor, attach once, set `InpHubHost` to the tick hub IP (Linux EC2 private IP if hub runs on Linux).

## Message formats

**Tick:**
```json
{"type":"tick","symbol":"EURUSD","bid":1.08542,"ask":1.08544,"time_ms":1725623456789,"source":"mt5"}
```

**Bars (snapshot, oldest → newest):**
```json
{"type":"bars","symbol":"XAUUSD","timeframe":"M1","source":"mt5","bars":[{"time":1788766080,"open":4395.1,"high":4396.2,"low":4394.5,"close":4395.8}]}
```

## HTTP bar API

```bash
curl "http://127.0.0.1:9003/bars?symbol=XAUUSD&timeframe=M1&limit=300"
```

Portal API proxies via `GET /api/v1/market/history` (reads tick hub cache first, synthetic fallback if empty).

# AlphaFX Tick Hub

Ingests newline-delimited JSON ticks from the MT5 `TickPublisher` EA (TCP) and fans out to WebSocket clients.

## Ports

| Port | Purpose |
|------|---------|
| 9001 | TCP ingest (MQL5 EA) |
| 9002 | WebSocket downstream (portal API) |
| 9003 | HTTP `/health` |

## Run

```bash
./run.sh              # ingest only
TICK_HUB_MOCK=1 ./run.sh   # + synthetic ticks for dev
```

## EA message format

```json
{"type":"tick","symbol":"EURUSD","bid":1.08542,"ask":1.08544,"time_ms":1725623456789,"source":"mt5"}
```

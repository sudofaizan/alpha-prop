# Alpha Prop

Prop firm platform for AlphaFX — challenge accounts, funded trader management, risk monitoring, and trade execution.

## Status

Project initialization. Code will be added incrementally.

## Live trading API (external)

The MT5 backend runs separately on a VPS:

| Setting | Value |
|---------|-------|
| **Base URL** | `http://18.175.170.218:8080` |
| **API key** | `alphafx` (header: `X-API-Key`) |
| **Version** | `1.8.7` |
| **Broker** | Skyriss Securities |

```bash
# Live price
curl -H "X-API-Key: alphafx" \
  "http://18.175.170.218:8080/getPrice?symbol=XAUUSD.pr"

# Candles
curl -H "X-API-Key: alphafx" \
  "http://18.175.170.218:8080/getCandles?symbol=XAUUSD.pr&timeframe=M5&count=5"
```

## Roadmap

- [ ] Challenge engine (drawdown rules, profit targets)
- [ ] Trader portal
- [ ] Risk guardrails
- [ ] Admin panel
- [ ] Payout workflow

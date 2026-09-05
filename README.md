# Alpha Prop

Prop firm platform for **AlphaFX** — challenge accounts, funded trader management, risk monitoring, and trade execution.

## Status

Static website scaffold live. Backend integration coming next.

## Website (static)

Capiffy-style trader portal with harsh challenge rules (~90% eval failure target).

```bash
cd website
python3 -m http.server 3000
# Open http://localhost:3000
```

| Page | Description |
|------|-------------|
| `website/index.html` | Challenge picker — One-step, Two-step, Three-step, Instant |
| `website/rules.html` | Full rulebook |
| `website/js/plans.js` | Plan data & rule engine |
| `website/css/styles.css` | Dark + gold theme |

### Challenge programs

| Program | Phases | Difficulty |
|---------|--------|------------|
| **One-step** | 1 eval → funded | 10% target, 8% max loss, 45-day limit |
| **Two-step** | 2 eval → funded | 6% + 5%, 10%/8% max loss |
| **Three-step** | 3 eval → funded | 5% + 5% + 4%, tightens each phase |
| **Instant** | Straight to funded | 70% split, 5% max loss, 1:30 leverage |

Account sizes: **$2.5K · $5K · $10K · $25K · $50K · $100K**

### Global rules (all programs)

- Static drawdown (never trails up with profit)
- 5 profitable days (0.4% min each) before payout
- Consistency: best day ≤ 30% of total profit
- No news trading ±10 min high impact
- No weekend holding (close Fri 20:00 UTC)
- Max floating loss 1.5% when funded
- 10-day inactivity = fail
- No EAs / copy trading without approval

## Live trading API (external)

MT5 backend on VPS — not in this repo yet:

| Setting | Value |
|---------|-------|
| **Base URL** | `http://18.175.170.218:8080` |
| **API key** | `alphafx` (header: `X-API-Key`) |

## Roadmap

- [x] Static challenge website + rulebook
- [ ] Auth & trader accounts
- [ ] Challenge purchase / Stripe
- [ ] Live rule enforcement via MT5 API
- [ ] Admin panel
- [ ] Payout workflow

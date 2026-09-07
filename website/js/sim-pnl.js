/**
 * Client-side simulated P/L — mirrors backend sim_engine.py for live tick updates.
 */
(function () {
  const DEFAULT_CONTRACT = {
    EURUSD: 100000,
    GBPUSD: 100000,
    USDJPY: 100000,
    XAUUSD: 100,
    BTCUSD: 1,
  };

  function contractSize(symbol, meta) {
    return meta?.contract_size ?? DEFAULT_CONTRACT[String(symbol).toUpperCase()] ?? 100000;
  }

  /** Exit price for marking an open position (bid to close BUY, ask to close SELL). */
  function markPrice(tick, side) {
    const s = String(side || "").toUpperCase();
    if (!tick) return null;
    return s === "BUY" ? Number(tick.bid) : Number(tick.ask);
  }

  function calcPnl(symbol, side, volume, entry, exitPx, meta) {
    const sym = String(symbol).toUpperCase();
    const contract = contractSize(sym, meta);
    const vol = Number(volume);
    const ent = Number(entry);
    const exit = Number(exitPx);
    if (!Number.isFinite(vol) || !Number.isFinite(ent) || !Number.isFinite(exit)) return 0;

    let diff = exit - ent;
    if (String(side).toUpperCase() === "SELL") diff = -diff;

    let pnl;
    if (sym === "USDJPY") {
      pnl = (diff * contract * vol) / exit;
    } else {
      pnl = diff * contract * vol;
    }
    return Math.round(pnl * 100) / 100;
  }

  function positionPnl(position, tick, meta) {
    const exitPx = markPrice(tick, position.side);
    if (exitPx == null) return 0;
    return calcPnl(position.symbol, position.side, position.volume, position.entry, exitPx, meta);
  }

  window.AlphaFXSimPnl = {
    contractSize,
    markPrice,
    calcPnl,
    positionPnl,
  };
})();

/**
 * WebSocket client for live quote ticks (/ws/quotes)
 */
(function () {
  const API = window.ALPHAFX_API || window.location.origin;

  function wsUrl() {
    const token = window.AlphaFXApi?.getToken?.();
    if (!token) return null;
    const base = API || window.location.origin;
    const url = new URL("/ws/quotes", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    return url.toString();
  }

  function normalizeSymbol(symbol) {
    return String(symbol || "")
      .toUpperCase()
      .replace(/\.(C|M|I|PRO)$/i, "");
  }

  class QuotesSocket {
    constructor() {
      this.ws = null;
      this.symbols = new Set();
      this.handlers = new Set();
      this.reconnectMs = 2000;
      this._shouldRun = false;
      this._connecting = false;
      this._live = false;
      this._statusTimer = null;
      this._pingTimer = null;
      this._last = {};
    }

    onTick(fn) {
      this.handlers.add(fn);
      return () => this.handlers.delete(fn);
    }

    getLast(symbol) {
      return this._last[normalizeSymbol(symbol)] || null;
    }

    connect(symbols) {
      this._shouldRun = true;
      (symbols || []).forEach((s) => this.symbols.add(normalizeSymbol(s)));
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this._open();
      } else {
        this._sendSubscribe();
      }
    }

    subscribe(symbols) {
      (symbols || []).forEach((s) => this.symbols.add(normalizeSymbol(s)));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._sendSubscribe();
      } else if (!this._connecting) {
        this._open();
      }
    }

    disconnect() {
      this._shouldRun = false;
      this._connecting = false;
      this._stopPing();
      if (this.ws) {
        const old = this.ws;
        old.onclose = null;
        old.onerror = null;
        old.close();
        this.ws = null;
      }
      this._setLive(false, true);
    }

    _sendSubscribe() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ action: "subscribe", symbols: [...this.symbols] }));
    }

    _setLive(live, immediate) {
      const apply = () => {
        if (this._live === live) return;
        this._live = live;
        window.dispatchEvent(new CustomEvent("alphafx:quotes:status", { detail: { live } }));
      };
      clearTimeout(this._statusTimer);
      if (immediate || live) {
        apply();
      } else {
        // Avoid flicker: show "Reconnecting" only after 2s offline
        this._statusTimer = setTimeout(apply, 2000);
      }
    }

    _startPing(ws) {
      this._stopPing();
      this._pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: "ping" }));
        }
      }, 25000);
    }

    _stopPing() {
      if (this._pingTimer) {
        clearInterval(this._pingTimer);
        this._pingTimer = null;
      }
    }

    _open() {
      const url = wsUrl();
      if (!url || !this._shouldRun || this._connecting) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

      this._connecting = true;

      if (this.ws) {
        const old = this.ws;
        old.onclose = null;
        old.onerror = null;
        old.close();
        this.ws = null;
      }

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this._connecting = false;
        this.reconnectMs = 2000;
        this._sendSubscribe();
        this._setLive(true, true);
        this._startPing(ws);
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "snapshot" && Array.isArray(msg.ticks)) {
          msg.ticks.forEach((t) => this._emit(t));
          return;
        }
        if (msg.type === "tick") {
          this._emit(msg);
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this._stopPing();
        this.ws = null;
        this._connecting = false;
        if (!this._shouldRun) return;
        this._setLive(false, false);
        setTimeout(() => this._open(), this.reconnectMs);
        this.reconnectMs = Math.min(Math.round(this.reconnectMs * 1.5), 15000);
      };

      ws.onerror = () => {
        if (this.ws === ws) ws.close();
      };
    }

    _emit(tick) {
      if (!tick || !tick.symbol) return;
      const sym = normalizeSymbol(tick.symbol);
      // Prefer MT5 over mock if both arrive for the same symbol
      const prev = this._last[sym];
      if (prev && prev.source === "mt5" && tick.source === "mock") return;

      const normalized = { ...tick, symbol: sym };
      this._last[sym] = normalized;
      this.handlers.forEach((fn) => {
        try {
          fn(normalized);
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  window.AlphaFXQuotes = new QuotesSocket();
})();

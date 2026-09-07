/**
 * WebSocket client for live quote ticks (/ws/quotes)
 */
(function () {
  const API = window.ALPHAFX_API || window.location.origin;

  function wsUrl() {
    const token = window.AlphaFXApi?.getToken?.();
    if (!token) return null;
    const base = API.replace(/^http/, "ws");
    return `${base}/ws/quotes?token=${encodeURIComponent(token)}`;
  }

  class QuotesSocket {
    constructor() {
      this.ws = null;
      this.symbols = new Set();
      this.handlers = new Set();
      this.reconnectMs = 1500;
      this._shouldRun = false;
      this._last = {};
    }

    onTick(fn) {
      this.handlers.add(fn);
      return () => this.handlers.delete(fn);
    }

    getLast(symbol) {
      return this._last[String(symbol || "").toUpperCase()] || null;
    }

    connect(symbols) {
      this._shouldRun = true;
      (symbols || []).forEach((s) => this.symbols.add(String(s).toUpperCase()));
      this._open();
    }

    subscribe(symbols) {
      (symbols || []).forEach((s) => this.symbols.add(String(s).toUpperCase()));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: "subscribe", symbols: [...this.symbols] }));
      } else {
        this._open();
      }
    }

    disconnect() {
      this._shouldRun = false;
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }

    _open() {
      const url = wsUrl();
      if (!url || !this._shouldRun) return;

      if (this.ws) {
        this.ws.close();
      }

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "subscribe", symbols: [...this.symbols] }));
        window.dispatchEvent(new CustomEvent("alphafx:quotes:status", { detail: { live: true } }));
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
        window.dispatchEvent(new CustomEvent("alphafx:quotes:status", { detail: { live: false } }));
        if (this._shouldRun) {
          setTimeout(() => this._open(), this.reconnectMs);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    _emit(tick) {
      if (!tick || !tick.symbol) return;
      const sym = String(tick.symbol).toUpperCase();
      this._last[sym] = tick;
      this.handlers.forEach((fn) => {
        try {
          fn(tick);
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  window.AlphaFXQuotes = new QuotesSocket();
})();

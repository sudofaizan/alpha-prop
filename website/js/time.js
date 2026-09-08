/**
 * Parse API datetimes (stored UTC, often sent without timezone suffix).
 */
(function (global) {
  function parseUtc(iso) {
    if (!iso) return null;
    const s = String(iso).trim();
    if (!s) return null;
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
    return new Date(s + "Z");
  }

  function formatTimeAgo(iso) {
    const d = parseUtc(iso);
    if (!d || Number.isNaN(d.getTime())) return "";
    const diff = Date.now() - d.getTime();
    if (diff < 0) return "just now";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /** Format unix seconds in the browser timezone (matches chart axis labels). */
  function formatLocalDateTime(unixSec) {
    const sec = Number(unixSec);
    if (!Number.isFinite(sec) || sec <= 0) return "—";
    const d = new Date(sec * 1000);
    if (Number.isNaN(d.getTime())) return "—";
    const parts = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
  }

  global.AlphaFXTime = { parseUtc, formatTimeAgo, formatLocalDateTime };
})(typeof window !== "undefined" ? window : globalThis);

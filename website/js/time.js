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

  global.AlphaFXTime = { parseUtc, formatTimeAgo };
})(typeof window !== "undefined" ? window : globalThis);

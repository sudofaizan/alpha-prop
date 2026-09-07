from datetime import datetime, timezone


def utc_iso(dt: datetime | None) -> str:
    """Serialize a datetime as UTC ISO-8601 with Z suffix."""
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"

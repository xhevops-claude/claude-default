#!/usr/bin/env python3
"""Transform a yt-dlp flat-playlist dump into the lean per-channel JSON the
Binge app reads. Oldest video first.

Preserves any precise upload dates (`d`, YYYYMMDD) already present in a
previously published file at out_path, so the slow date-enrichment pass
(see yt_apply_dates.py) only has to run once per video.

Usage: yt_transform.py <raw_json> <out_json>
Env:   SLUG, SRC_URL
"""
import calendar
import json
import os
import sys


def d_to_epoch(d):
    """YYYYMMDD int/str -> UTC epoch seconds, or None."""
    if not d:
        return None
    s = str(int(d)).zfill(8)
    try:
        return calendar.timegm((int(s[0:4]), int(s[4:6]), int(s[6:8]), 0, 0, 0))
    except (ValueError, OverflowError):
        return None


def sort_key(v):
    """Precise date if we have it, else the approximate listing timestamp."""
    return d_to_epoch(v.get("d")) or v.get("ts") or 0


def main():
    raw_path, out_path = sys.argv[1], sys.argv[2]
    with open(raw_path) as f:
        data = json.load(f)

    # Carry forward precise dates already known for these video ids.
    prior_d = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as f:
                for v in json.load(f).get("videos", []):
                    if v.get("id") and v.get("d"):
                        prior_d[v["id"]] = v["d"]
        except Exception:
            prior_d = {}

    entries = [e for e in (data.get("entries") or []) if e and e.get("id")]
    vids = []
    for e in entries:
        ts = e.get("timestamp") or e.get("release_timestamp")
        vids.append({
            "id": e["id"],
            "title": (e.get("title") or "Untitled").strip(),
            "duration": e.get("duration") or None,
            "ts": int(ts) if ts else None,
            "d": prior_d.get(e["id"]),
        })

    # Oldest first: precise date when known, approximate listing time
    # otherwise. If nothing has any date, fall back to reversing the
    # newest-first listing yt-dlp returns.
    if any(sort_key(v) for v in vids):
        vids.sort(key=sort_key)
    else:
        vids.reverse()
    for i, v in enumerate(vids):
        v["i"] = i

    name = (data.get("channel") or data.get("title")
            or data.get("uploader") or os.environ["SLUG"])
    doc = {
        "slug": os.environ["SLUG"],
        "name": name,
        "channelId": data.get("channel_id") or data.get("id"),
        "url": os.environ["SRC_URL"],
        "count": len(vids),
        "videos": vids,
    }
    with open(out_path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)

    have = sum(1 for v in vids if v.get("d"))
    print("%s: %d videos (%d with precise dates)" % (os.environ["SLUG"], len(vids), have))


if __name__ == "__main__":
    main()

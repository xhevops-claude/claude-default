#!/usr/bin/env python3
"""Merge precise upload dates (from a yt-dlp `id upload_date` dump) into a
channel JSON, then re-sort oldest-first and reassign the chronological
index.

Usage: yt_apply_dates.py <json> <dates_file>
  dates_file lines: "<id> <YYYYMMDD>"  (NA / missing dates ignored)
"""
import calendar
import json
import sys


def d_to_epoch(d):
    if not d:
        return None
    s = str(int(d)).zfill(8)
    try:
        return calendar.timegm((int(s[0:4]), int(s[4:6]), int(s[6:8]), 0, 0, 0))
    except (ValueError, OverflowError):
        return None


def sort_key(v):
    return d_to_epoch(v.get("d")) or v.get("ts") or 0


def main():
    json_path, dates_path = sys.argv[1], sys.argv[2]
    with open(json_path) as f:
        doc = json.load(f)

    dates = {}
    with open(dates_path) as f:
        for line in f:
            parts = line.split()
            if len(parts) != 2:
                continue
            vid, d = parts
            if d.isdigit() and len(d) == 8:
                dates[vid] = int(d)

    applied = 0
    for v in doc.get("videos", []):
        if v.get("id") in dates and not v.get("d"):
            v["d"] = dates[v["id"]]
            applied += 1

    vids = doc.get("videos", [])
    if any(sort_key(v) for v in vids):
        vids.sort(key=sort_key)
    for i, v in enumerate(vids):
        v["i"] = i

    with open(json_path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)

    print("%s: applied %d precise dates" % (doc.get("slug", "?"), applied))


if __name__ == "__main__":
    main()

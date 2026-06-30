#!/usr/bin/env python3
"""Transform a yt-dlp flat-playlist dump into the lean per-channel JSON the
Binge app reads. Oldest video first.

Usage: yt_transform.py <raw_json> <out_json>
Env:   SLUG, SRC_URL
"""
import json
import os
import sys


def main():
    raw_path, out_path = sys.argv[1], sys.argv[2]
    with open(raw_path) as f:
        data = json.load(f)

    entries = [e for e in (data.get("entries") or []) if e and e.get("id")]
    vids = []
    for e in entries:
        ts = e.get("timestamp") or e.get("release_timestamp")
        vids.append({
            "id": e["id"],
            "title": (e.get("title") or "Untitled").strip(),
            "duration": e.get("duration") or None,
            "ts": int(ts) if ts else None,
        })

    if vids and all(v["ts"] for v in vids):
        vids.sort(key=lambda v: v["ts"])          # true chronological
    else:
        vids.reverse()                            # newest-first -> oldest-first
    for i, v in enumerate(vids):
        v["i"] = i                                # stable chronological index

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

    print("%s: %d videos" % (os.environ["SLUG"], len(vids)))


if __name__ == "__main__":
    main()

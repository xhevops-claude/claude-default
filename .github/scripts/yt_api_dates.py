#!/usr/bin/env python3
"""Fill exact publish dates via the YouTube Data API (videos.list) — the one
reliable, no-bot-wall source of per-video dates from CI.

Batches 50 undated ids per request (1 quota unit each; a whole channel is a
handful of units out of the 10,000/day free quota). Incremental: only videos
without a `d` are looked up, so each is dated once and skipped forever after.
Order is left untouched (the videos-page order set by yt_transform).

Usage: yt_api_dates.py <json> [max]
Env:   YT_API_KEY  (if unset, this is a no-op)
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/youtube/v3/videos"


def main():
    path = sys.argv[1]
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
    key = os.environ.get("YT_API_KEY")
    if not key:
        print("no YT_API_KEY — skipping exact-date enrichment")
        return

    with open(path) as f:
        doc = json.load(f)
    todo = [v["id"] for v in doc.get("videos", []) if v.get("id") and not v.get("d")][:cap]
    if not todo:
        print("%s: all videos already dated" % doc.get("slug", "?"))
        return

    dates = {}
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        qs = urllib.parse.urlencode({
            "part": "snippet",
            "fields": "items(id,snippet/publishedAt)",
            "maxResults": "50",
            "id": ",".join(batch),
            "key": key,
        })
        try:
            with urllib.request.urlopen(API + "?" + qs, timeout=30) as r:
                data = json.load(r)
        except Exception as e:
            print("  API error on batch %d: %r" % (i // 50, e))
            continue
        for it in data.get("items", []):
            pa = (it.get("snippet") or {}).get("publishedAt", "")
            # publishedAt looks like 2019-09-27T14:00:00Z
            if len(pa) >= 10 and pa[4] == "-" and pa[7] == "-":
                dates[it["id"]] = int(pa[0:4] + pa[5:7] + pa[8:10])
        time.sleep(0.1)

    applied = 0
    for v in doc.get("videos", []):
        if v.get("id") in dates and not v.get("d"):
            v["d"] = dates[v["id"]]
            applied += 1

    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print("%s: API applied %d exact dates (%d requested)"
          % (doc.get("slug", "?"), applied, len(todo)))


if __name__ == "__main__":
    main()

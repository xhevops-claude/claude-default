#!/usr/bin/env python3
"""Print video ids from a channel JSON that still lack a precise upload
date (`d`), up to a cap. Feeds the date-enrichment yt-dlp pass.

Usage: yt_pick_missing.py <json> <max>
"""
import json
import sys


def main():
    path = sys.argv[1]
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    try:
        with open(path) as f:
            vids = json.load(f).get("videos", [])
    except Exception:
        return
    out = [v["id"] for v in vids if v.get("id") and not v.get("d")]
    for vid in out[:cap]:
        print(vid)


if __name__ == "__main__":
    main()

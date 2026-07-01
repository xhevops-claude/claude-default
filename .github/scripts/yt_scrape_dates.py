#!/usr/bin/env python3
"""Scrape each video's exact publish date, one video at a time, from its
watch page. A plain HTML GET exposes the microformat `publishDate` /
`uploadDate`, which gets through where yt-dlp's innertube API is bot-walled.

Incremental: only videos that don't already have a `d` are fetched (so a
video is dated once and skipped forever after). Bounded by a per-run cap.
The videos-page order (set by yt_transform) is left untouched — this only
fills in `d`. Progress is checkpointed so a killed run keeps what it got.

Usage: yt_scrape_dates.py <json> [max]
"""
import json
import re
import sys
import time
import urllib.request

DATE_RES = [
    re.compile(r'"uploadDate":"(\d{4})-(\d{2})-(\d{2})'),
    re.compile(r'"publishDate":"(\d{4})-(\d{2})-(\d{2})'),
    re.compile(r'itemprop="(?:datePublished|uploadDate)"[^>]*content="(\d{4})-(\d{2})-(\d{2})'),
]
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/124.0 Safari/537.36"),
    "Accept-Language": "en-US,en;q=0.9",
    # Skip the EU consent interstitial so the real watch page (with the
    # microformat) is served.
    "Cookie": "CONSENT=YES+1; SOCS=CAI",
}


def fetch_html(vid):
    url = ("https://www.youtube.com/watch?v=%s&hl=en&gl=US"
           "&bpctr=9999999999&has_verified=1" % vid)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.getcode(), resp.geturl(), resp.read().decode("utf-8", "replace")


def parse_date(html):
    for rx in DATE_RES:
        m = rx.search(html)
        if m:
            return int(m.group(1) + m.group(2) + m.group(3))
    return None


def main():
    path = sys.argv[1]
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 800
    with open(path) as f:
        doc = json.load(f)

    todo = [v for v in doc.get("videos", []) if v.get("id") and not v.get("d")][:cap]
    if not todo:
        print("%s: all videos already dated" % doc.get("slug", "?"))
        return

    applied = 0
    fails = 0
    for n, v in enumerate(todo):
        try:
            _, _, html = fetch_html(v["id"])
            d = parse_date(html)
            if n < 3 and not d:  # diagnose why the first few miss
                markers = [k for k in ("publishDate", "uploadDate", "datePublished",
                                       "not a bot", "Before you continue", "consent", "captcha")
                           if k in html]
                print("  DIAG %s: len=%d markers=%s" % (v["id"], len(html), markers))
            if d:
                v["d"] = d
                applied += 1
                fails = 0
            else:
                fails += 1
        except Exception as e:
            if n < 3:
                print("  DIAG %s: error %r" % (v["id"], e))
            fails += 1
        # Checkpoint periodically so a killed job keeps progress.
        if applied and applied % 25 == 0:
            with open(path, "w") as f:
                json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
        # Bail out if the page stops yielding dates (likely rate-limited);
        # the rest retry next run.
        if fails >= 20:
            print("%s: stopping early after %d consecutive misses" % (doc.get("slug", "?"), fails))
            break
        time.sleep(0.25)

    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)

    print("%s: scraped %d exact dates (%d attempted this run)"
          % (doc.get("slug", "?"), applied, len(todo)))


if __name__ == "__main__":
    main()

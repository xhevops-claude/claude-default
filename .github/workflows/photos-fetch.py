#!/usr/bin/env python3
"""Fetch the Commons photos listed in data-sources/photos-mavrovo.json.

Runs inside the photos-fetch workflow. For each entry it asks the
Commons API for a resized thumbnail URL plus license metadata
(extmetadata), downloads and sanity-checks the image, and appends a
credits record. Entries already published with the same source title
are skipped by comparing against the credits.json currently on
gh-pages (passed in via PUBLISHED_CREDITS).

Attribution matters: the published credits.json is what the app renders
in its credits section, so author/license fields must survive intact.
"""

import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

SOURCE_LIST = os.environ["SOURCE_LIST"]
OUT_DIR = os.environ["OUT_DIR"]
PUBLISHED_CREDITS = os.environ["PUBLISHED_CREDITS"]

API = "https://commons.wikimedia.org/w/api.php"
UA = "claude-default-photos-fetch/1.0 (https://github.com/xhevops-claude/claude-default; contact via repo issues)"

MAGIC = {b"\xff\xd8\xff": ".jpg", b"\x89PNG": ".png"}


def api_imageinfo(title, width):
    q = urllib.parse.urlencode({
        "action": "query",
        "titles": title,
        "redirects": "1",  # renamed files resolve via their redirect
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": str(width),
        "format": "json",
        "formatversion": "2",
    })
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    pages = data.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or "imageinfo" not in pages[0]:
        return None
    return pages[0]["imageinfo"][0]


def strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def meta_value(info, key):
    return strip_html(info.get("extmetadata", {}).get(key, {}).get("value", ""))


def main():
    with open(SOURCE_LIST) as f:
        entries = json.load(f)
    try:
        with open(PUBLISHED_CREDITS) as f:
            published = {p["slug"]: p for p in json.load(f).get("photos", [])}
    except Exception:
        published = {}

    os.makedirs(OUT_DIR, exist_ok=True)
    photos, any_changed, failures = [], False, []

    for e in entries:
        slug, title = e["slug"], e["title"]
        width = int(e.get("width", 1600))
        prev = published.get(slug)
        if prev and prev.get("title") == title and prev.get("width") == width:
            print(f"{slug}: unchanged ({title}), keeping published copy")
            photos.append(prev)
            continue

        print(f"{slug}: fetching {title} @ {width}px")
        info = api_imageinfo(title, width)
        if not info:
            failures.append(f"{slug}: Commons has no file titled {title!r}")
            continue

        url = info.get("thumburl") or info.get("url")
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
        ext = next((x for m, x in MAGIC.items() if body.startswith(m)), None)
        if ext is None or len(body) < 30_000:
            failures.append(f"{slug}: downloaded body is not a plausible image ({len(body)} bytes)")
            continue

        fname = f"{slug}{ext}"
        with open(os.path.join(OUT_DIR, fname), "wb") as f:
            f.write(body)
        any_changed = True
        photos.append({
            "slug": slug,
            "file": fname,
            "title": title,
            "width": width,
            "author": meta_value(info, "Artist") or "Unknown",
            "license": meta_value(info, "LicenseShortName") or "see source",
            "licenseUrl": info.get("extmetadata", {}).get("LicenseUrl", {}).get("value", ""),
            "source": info.get("descriptionurl", ""),
        })
        time.sleep(1)  # be polite to the Commons API

    # Failures are reported but never block the good entries — the
    # published set is curated by eye afterwards anyway.
    for f_ in failures:
        print(f"::warning::{f_}")

    manifest = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "photos": photos}
    if any_changed:
        with open(os.path.join(OUT_DIR, "credits.json"), "w") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
        print(f"wrote {len(photos)} photo records")
    else:
        print("nothing changed")

    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"any_changed={'1' if any_changed else '0'}\n")


if __name__ == "__main__":
    main()

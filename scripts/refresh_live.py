"""Hourly: fresh view counts of the channel's 15 newest public videos from YouTube's public RSS
feed (no key, no login, no quota). Writes data/live.json, which the dashboard merges over the
full data. Uses only Python's standard library."""

import datetime as dt
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

CHANNEL_ID = "UCIqsSPGCNSqpGZ38gzoWVug"
FEED = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
OUT = os.path.join("data", "live.json")
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "media": "http://search.yahoo.com/mrss/"}


def main():
    req = urllib.request.Request(FEED, headers={"User-Agent": "CuriosityByteDashboard/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        root = ET.fromstring(resp.read())
    videos = {}
    for entry in root.findall("a:entry", NS):
        vid = entry.findtext("yt:videoId", namespaces=NS)
        stats = entry.find("media:group/media:community/media:statistics", NS)
        rating = entry.find("media:group/media:community/media:starRating", NS)
        if not vid or stats is None:
            continue
        videos[vid] = {"title": entry.findtext("a:title", namespaces=NS),
                       "published": entry.findtext("a:published", namespaces=NS),
                       "views": int(stats.get("views", 0)),
                       "likes": int(rating.get("count", 0)) if rating is not None else None}
    if not videos:
        sys.exit("The feed had no videos; live.json left unchanged.")
    os.makedirs("data", exist_ok=True)
    data = {"fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "videos": videos}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(f"{len(videos)} videos, {sum(v['views'] for v in videos.values()):,} views -> {OUT}")


if __name__ == "__main__":
    main()

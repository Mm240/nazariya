"""Check every feed in feeds.yaml without touching the database.

    python -m nazariya.check_feeds

Prints whether each feed responds, how many usable items it has, how fresh
the newest one is, and a sample headline. Run it after editing feeds.yaml.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone

from .config import load_feeds, load_settings
from .fetch import fetch_all_sync
from .normalize import normalize_entry


def main() -> int:
    settings = load_settings(require_db=False)
    feeds = load_feeds(settings.feeds_path)
    results = fetch_all_sync(feeds, settings.user_agent)
    now = datetime.now(timezone.utc)

    failed = 0
    print(f"{'feed':<18} {'status':<8} {'usable':>6}  {'newest':>8}  sample headline")
    print("-" * 100)
    for r in results:
        if not r.ok:
            failed += 1
            print(f"{r.feed.slug:<18} {'FAIL':<8} {'-':>6}  {'-':>8}  {r.error}")
            continue
        usable = [
            c
            for c in (
                normalize_entry(e, r.feed, now, 48, settings.skip_url_patterns, settings.skip_title_keywords)
                for e in r.entries
            )
            if c
        ]
        if usable:
            newest = max(c.published_at for c in usable)
            age = f"{(now - newest).total_seconds() / 3600:.1f}h"
            wrong_lang = sum(c.language != r.feed.language for c in usable)
            sample = usable[0].title[:60]
            note = f"  ({wrong_lang} in other language)" if wrong_lang else ""
            print(f"{r.feed.slug:<18} {'ok':<8} {len(usable):>6}  {age:>8}  {sample}{note}")
        else:
            print(f"{r.feed.slug:<18} {'EMPTY':<8} {0:>6}  {'-':>8}  {len(r.entries)} items, none from the last 48h")

    print("-" * 100)
    print(f"{len(results) - failed}/{len(results)} feeds reachable.")
    if failed:
        print("Fix or disable failing feeds in feeds.yaml (set `enabled: false`).")
    return 1 if failed == len(results) else 0


if __name__ == "__main__":
    sys.exit(main())

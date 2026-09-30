"""Fetch and parse RSS feeds concurrently. One broken feed never stops a run."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import feedparser
import httpx

from .config import Feed

log = logging.getLogger(__name__)


@dataclass
class FeedResult:
    feed: Feed
    entries: list[dict] = field(default_factory=list)
    error: str | None = None
    status_code: int | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def parse_feed_bytes(content: bytes) -> list[dict]:
    parsed = feedparser.parse(content)
    if parsed.bozo and not parsed.entries:
        raise ValueError(f"not a valid feed ({parsed.bozo_exception!r})")
    return list(parsed.entries)


async def _fetch_one(client: httpx.AsyncClient, feed: Feed, sem: asyncio.Semaphore) -> FeedResult:
    async with sem:
        try:
            response = await client.get(feed.url)
            if response.status_code >= 400:
                return FeedResult(feed, error=f"HTTP {response.status_code}", status_code=response.status_code)
            entries = parse_feed_bytes(response.content)
            return FeedResult(feed, entries=entries, status_code=response.status_code)
        except Exception as exc:  # network errors, timeouts, parse errors
            return FeedResult(feed, error=f"{type(exc).__name__}: {exc}"[:300])


async def fetch_all(feeds: list[Feed], user_agent: str, concurrency: int = 8) -> list[FeedResult]:
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    }
    sem = asyncio.Semaphore(concurrency)
    timeout = httpx.Timeout(20.0, connect=10.0)
    async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
        results = await asyncio.gather(*(_fetch_one(client, f, sem) for f in feeds))
    for r in results:
        if r.ok:
            log.info("feed %-18s ok  %3d entries", r.feed.slug, len(r.entries))
        else:
            log.warning("feed %-18s FAILED %s", r.feed.slug, r.error)
    return list(results)


def fetch_all_sync(feeds: list[Feed], user_agent: str) -> list[FeedResult]:
    return asyncio.run(fetch_all(feeds, user_agent))

"""Turn raw RSS entries into clean article candidates."""

from __future__ import annotations

import calendar
import hashlib
import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .config import Feed

EXCERPT_MAX_CHARS = 300
MIN_TITLE_CHARS = 12

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_TRACKING_PARAMS = {"fbclid", "gclid", "ref", "ref_src", "cmpid", "ito", "from", "source"}


@dataclass
class ArticleCandidate:
    outlet_slug: str
    url: str
    url_hash: str
    title: str
    excerpt: str | None
    language: str
    published_at: datetime
    section: str = "india"
    image_url: str | None = None
    category: str = "general"


_IMG_SRC_RE = re.compile(r"""<img[^>]+src=["']([^"']+)["']""", re.I)


def extract_image(entry: dict) -> str | None:
    """The picture the outlet attached to this item in its own feed, if any."""
    candidates: list[str] = []
    for key in ("media_content", "media_thumbnail"):
        for m in entry.get(key) or []:
            if isinstance(m, dict) and m.get("url") and m.get("medium", "image") in ("image", None, ""):
                candidates.append(m["url"])
    for link in entry.get("links") or []:
        if isinstance(link, dict) and link.get("rel") == "enclosure" and str(link.get("type", "")).startswith("image"):
            candidates.append(link.get("href", ""))
    for enc in entry.get("enclosures") or []:
        if isinstance(enc, dict) and str(enc.get("type", "")).startswith("image"):
            candidates.append(enc.get("href") or enc.get("url") or "")
    html_blob = entry.get("summary") or entry.get("description") or ""
    candidates += _IMG_SRC_RE.findall(html_blob)
    for url in candidates:
        url = (url or "").strip().replace("&amp;", "&")
        if url.startswith("//"):
            url = "https:" + url
        if url.startswith("https://") or url.startswith("http://"):
            return url[:1000]
    return None


def clean_text(value: str | None) -> str:
    """Strip HTML tags and entities and collapse whitespace."""
    if not value:
        return ""
    text = _TAG_RE.sub(" ", value)
    text = html.unescape(text)
    # Some feeds double-encode entities (&amp;#8217;).
    text = html.unescape(text)
    return _WS_RE.sub(" ", text).strip()


def truncate(text: str, max_chars: int = EXCERPT_MAX_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars].rsplit(" ", 1)[0]
    return cut.rstrip(",;:.-–— ") + "…"


def canonical_url(url: str) -> str:
    """Normalise a URL so the same article isn't stored twice."""
    parts = urlsplit(url.strip())
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in _TRACKING_PARAMS
    ]
    return urlunsplit(
        (
            (parts.scheme or "https").lower(),
            parts.netloc.lower(),
            parts.path,
            urlencode(query),
            "",  # drop #fragment
        )
    )


def url_hash(url: str) -> str:
    return hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()


def detect_language(text: str, fallback: str) -> str:
    """Tell Hindi (Devanagari) from English by script. Good enough for headlines."""
    deva = len(_DEVANAGARI_RE.findall(text))
    latin = len(_LATIN_RE.findall(text))
    if deva + latin == 0:
        return fallback
    return "hi" if deva / (deva + latin) >= 0.3 else "en"


def parse_published(entry: dict, now: datetime) -> datetime:
    struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if not struct:
        return now
    published = datetime.fromtimestamp(calendar.timegm(struct), tz=timezone.utc)
    # Clamp timestamps from the future (wrong time zones are common in feeds).
    return min(published, now)


def normalize_entry(
    entry: dict,
    feed: Feed,
    now: datetime,
    max_age_hours: int,
    skip_url_patterns: tuple[str, ...] = (),
    skip_title_keywords: tuple[str, ...] = (),
) -> ArticleCandidate | None:
    """Return a clean candidate, or None if the entry should be skipped."""
    link = (entry.get("link") or "").strip()
    title = clean_text(entry.get("title"))
    if not link.startswith(("http://", "https://")) or len(title) < MIN_TITLE_CHARS:
        return None

    lowered_link = link.lower()
    if any(pattern in lowered_link for pattern in skip_url_patterns):
        return None
    lowered_title = title.lower()
    if any(keyword in lowered_title for keyword in skip_title_keywords):
        return None

    published_at = parse_published(entry, now)
    if published_at < now - timedelta(hours=max_age_hours):
        return None

    excerpt = clean_text(entry.get("summary") or entry.get("description"))
    # Many feeds repeat the headline as the summary; that adds nothing.
    if excerpt and (excerpt == title or excerpt.startswith(title)):
        excerpt = excerpt[len(title):].strip(" -–—:|")
    excerpt = truncate(excerpt) if excerpt else None

    canonical = canonical_url(link)
    return ArticleCandidate(
        image_url=extract_image(entry),
        category=feed.category,
        outlet_slug=feed.outlet,
        section=feed.section,
        url=canonical,
        url_hash=url_hash(canonical),
        title=title,
        excerpt=excerpt or None,
        # Hindi and English feeds sometimes carry the other language; other feeds are one language.
        language=(detect_language(title, fallback=feed.language)
                  if feed.language in ("en", "hi") else feed.language),
        published_at=published_at,
    )


def embedding_text(title: str, excerpt: str | None, excerpt_chars: int = 160) -> str:
    """Text we embed for clustering: the headline plus the start of the excerpt."""
    if excerpt:
        return f"{title}. {excerpt[:excerpt_chars]}"
    return title

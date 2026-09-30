"""Configuration: environment variables plus feeds.yaml."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PIPELINE_DIR = Path(__file__).resolve().parent.parent


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


CATEGORIES = ("general", "politics", "business", "sports", "entertainment", "technology", "science", "health")


@dataclass(frozen=True)
class Feed:
    slug: str  # unique per feed, e.g. "the-hindu" or "the-hindu-world"
    name: str
    language: str
    url: str
    homepage: str | None = None
    enabled: bool = True
    media_group: str | None = None  # ownership group, e.g. "NDTV" for NDTV and NDTV India
    outlet_slug: str | None = None  # set when several feeds belong to one outlet; defaults to slug
    section: str = "india"  # "india" or "world"
    scope: str = "indian"  # "indian" or "international" outlet
    country: str = "IN"  # where the outlet is based (ISO 3166 code)
    ownership: str = "private"  # "private", "public" (public broadcaster) or "state"
    category: str = "general"  # topic of the feed: politics, business, sports, entertainment...

    @property
    def outlet(self) -> str:
        return self.outlet_slug or self.slug


@dataclass(frozen=True)
class ClusterParams:
    """Thresholds for grouping articles into stories.

    Similarities are cosine similarities between an article and a story's
    centroid. Cross-language pairs (Hindi article, English-only story) score
    systematically lower with multilingual embedders, so they get their own,
    lower threshold. Calibrate all three with `python -m nazariya.evaluate sweep`.
    """

    same_lang_threshold: float = 0.66
    cross_lang_threshold: float = 0.58
    merge_threshold: float = 0.78
    window_hours: float = 36.0
    # Anti-snowball: a big story's centroid drifts toward its general topic
    # ("Indian politics") and starts attracting unrelated headlines. So the bar
    # rises by this much each time a story doubles past 2 articles, up to max_growth.
    # (Members of a genuinely tight story score *higher* against a larger centroid,
    # because averaging removes noise, so real coverage still joins.)
    growth_per_doubling: float = 0.025
    max_growth: float = 0.10
    # When the AI reports that a story mixes different events, its articles are
    # re-clustered with every threshold raised by this much.
    split_tighten: float = 0.08


@dataclass(frozen=True)
class Settings:
    database_url: str
    feeds_path: Path
    anthropic_api_key: str | None
    analysis_model: str
    embedder: str
    embedding_model: str
    model_cache_dir: Path
    user_agent: str
    cluster: ClusterParams
    max_article_age_hours: int
    retention_days: int
    min_outlets_for_analysis: int
    max_analyses_per_run: int
    daily_analysis_limit: int
    reanalysis_cooldown_hours: int
    max_articles_per_analysis: int
    input_price_per_mtok: float
    output_price_per_mtok: float
    skip_url_patterns: tuple[str, ...] = field(default_factory=tuple)
    skip_title_keywords: tuple[str, ...] = field(default_factory=tuple)


def load_settings(require_db: bool = True) -> Settings:
    database_url = os.environ.get("DATABASE_URL", "")
    if require_db and not database_url:
        raise SystemExit("DATABASE_URL is not set. See DEPLOY.md, step 1.")

    feeds_path = Path(os.environ.get("FEEDS_PATH", PIPELINE_DIR / "feeds.yaml"))
    raw = yaml.safe_load(feeds_path.read_text(encoding="utf-8")) or {}

    return Settings(
        database_url=database_url,
        feeds_path=feeds_path,
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
        analysis_model=os.environ.get("ANALYSIS_MODEL", "claude-haiku-4-5-20251001"),
        embedder=os.environ.get("EMBEDDER", "fastembed"),
        embedding_model=os.environ.get(
            "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        ),
        model_cache_dir=Path(os.environ.get("MODEL_CACHE_DIR", PIPELINE_DIR / ".model-cache")),
        user_agent=os.environ.get(
            "USER_AGENT",
            "Mozilla/5.0 (compatible; NazariyaBot/1.0; +https://github.com/Mm240/nazariya)",
        ),
        cluster=ClusterParams(
            same_lang_threshold=_env_float("SAME_LANG_THRESHOLD", 0.66),
            cross_lang_threshold=_env_float("CROSS_LANG_THRESHOLD", 0.58),
            merge_threshold=_env_float("MERGE_THRESHOLD", 0.78),
            growth_per_doubling=_env_float("GROWTH_PER_DOUBLING", 0.025),
            max_growth=_env_float("MAX_GROWTH", 0.10),
            window_hours=_env_float("CLUSTER_WINDOW_HOURS", 36),
        ),
        max_article_age_hours=_env_int("MAX_ARTICLE_AGE_HOURS", 48),
        retention_days=_env_int("RETENTION_DAYS", 14),
        min_outlets_for_analysis=_env_int("MIN_OUTLETS_FOR_ANALYSIS", 3),
        max_analyses_per_run=_env_int("MAX_ANALYSES_PER_RUN", 5),
        # Hard cap on Claude calls in any rolling 24 hours: this is the cost ceiling.
        daily_analysis_limit=_env_int("DAILY_ANALYSIS_LIMIT", 30),
        reanalysis_cooldown_hours=_env_int("REANALYSIS_COOLDOWN_HOURS", 3),
        max_articles_per_analysis=_env_int("MAX_ARTICLES_PER_ANALYSIS", 12),
        input_price_per_mtok=_env_float("INPUT_PRICE_PER_MTOK", 1.0),
        output_price_per_mtok=_env_float("OUTPUT_PRICE_PER_MTOK", 5.0),
        skip_url_patterns=tuple(raw.get("skip_url_patterns") or ()),
        skip_title_keywords=tuple(k.lower() for k in (raw.get("skip_title_keywords") or ())),
    )


def load_feeds(path: Path) -> list[Feed]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    feeds = []
    seen: set[str] = set()
    for item in raw.get("feeds", []):
        feed = Feed(
            slug=item["slug"],
            name=item["name"],
            language=item["language"],
            url=item["url"],
            homepage=item.get("homepage"),
            enabled=item.get("enabled", True),
            media_group=item.get("group"),
            outlet_slug=item.get("outlet"),
            section=item.get("section", "india"),
            scope=item.get("scope", "indian"),
            country=str(item.get("country", "IN")).upper(),
            ownership=item.get("ownership", "private"),
            category=item.get("category", "general"),
        )
        if not re.fullmatch(r"[a-z]{2}", feed.language):
            raise ValueError(f"{feed.slug}: language must be a two-letter code like 'en', 'hi' or 'ar'")
        if feed.category not in CATEGORIES:
            raise ValueError(f"{feed.slug}: category must be one of {', '.join(CATEGORIES)}")
        if feed.ownership not in ("private", "public", "state"):
            raise ValueError(f"{feed.slug}: ownership must be 'private', 'public' or 'state'")
        if feed.section not in ("india", "world"):
            raise ValueError(f"{feed.slug}: section must be 'india' or 'world'")
        if feed.scope not in ("indian", "international"):
            raise ValueError(f"{feed.slug}: scope must be 'indian' or 'international'")
        if feed.slug in seen:
            raise ValueError(f"Duplicate feed slug: {feed.slug}")
        seen.add(feed.slug)
        if feed.enabled:
            feeds.append(feed)
    return feeds

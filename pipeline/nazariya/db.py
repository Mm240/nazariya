"""All SQL used by the pipeline lives here."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

from .cluster import StoryState
from .config import Feed
from .normalize import ArticleCandidate


def connect(database_url: str) -> psycopg.Connection:
    conn = psycopg.connect(database_url, row_factory=dict_row, autocommit=False)
    # The vector type must exist before psycopg can learn about it, so make
    # sure the extension is there even on a brand-new database.
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
    conn.commit()
    register_vector(conn)
    return conn


def apply_schema(conn: psycopg.Connection, schema_sql: str) -> None:
    with conn.cursor() as cur:
        cur.execute(schema_sql)
    conn.commit()


def upsert_outlets(conn: psycopg.Connection, feeds: list[Feed]) -> dict[str, int]:
    # One outlet can have several feeds (e.g. its India and World sections): the first
    # feed listed for an outlet supplies its name, homepage and group.
    outlets: dict[str, Feed] = {}
    for f in feeds:
        outlets.setdefault(f.outlet, f)
    with conn.cursor() as cur:
        for slug, f in outlets.items():
            cur.execute(
                """
                INSERT INTO outlets (slug, name, language, homepage, media_group, scope, active)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (slug) DO UPDATE
                  SET name = EXCLUDED.name, language = EXCLUDED.language, homepage = EXCLUDED.homepage,
                      media_group = EXCLUDED.media_group, scope = EXCLUDED.scope, active = TRUE
                """,
                (slug, f.name, f.language, f.homepage, f.media_group, f.scope),
            )
        # Outlets removed from feeds.yaml stay (their articles are still linked) but are hidden.
        cur.execute("UPDATE outlets SET active = FALSE WHERE NOT (slug = ANY(%s))", (list(outlets),))
        cur.execute("SELECT id, slug FROM outlets")
        ids = {row["slug"]: row["id"] for row in cur.fetchall()}
    conn.commit()
    return ids


@dataclass
class NewArticle:
    id: int
    title: str
    excerpt: str | None
    language: str
    published_at: datetime


def insert_articles(
    conn: psycopg.Connection, candidates: list[ArticleCandidate], outlet_ids: dict[str, int]
) -> list[NewArticle]:
    """Insert candidates; return only the ones that were new.

    Two round trips in total, however many candidates: the pipeline often runs far
    from the database (GitHub's servers in the US, Neon in Singapore), where one
    query per article would cost ~0.2 s each and keep the database awake for minutes.
    """
    if not candidates:
        return []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT url_hash FROM articles WHERE url_hash = ANY(%s)", ([c.url_hash for c in candidates],)
        )
        existing = {r["url_hash"] for r in cur.fetchall()}
        fresh = [c for c in candidates if c.url_hash not in existing]
        if not fresh:
            return []
        cur.execute(
            """
            INSERT INTO articles (outlet_id, url, url_hash, title, excerpt, language, published_at, section)
            SELECT * FROM unnest(%s::int[], %s::text[], %s::text[], %s::text[], %s::text[],
                                 %s::text[], %s::timestamptz[], %s::text[])
            ON CONFLICT (url_hash) DO NOTHING
            RETURNING id, url_hash
            """,
            (
                [outlet_ids[c.outlet_slug] for c in fresh],
                [c.url for c in fresh],
                [c.url_hash for c in fresh],
                [c.title for c in fresh],
                [c.excerpt for c in fresh],
                [c.language for c in fresh],
                [c.published_at for c in fresh],
                [c.section for c in fresh],
            ),
        )
        ids = {r["url_hash"]: r["id"] for r in cur.fetchall()}
    conn.commit()
    return [
        NewArticle(ids[c.url_hash], c.title, c.excerpt, c.language, c.published_at)
        for c in fresh
        if c.url_hash in ids
    ]


@dataclass
class PendingArticle:
    id: int
    title: str
    excerpt: str | None
    language: str
    published_at: datetime
    embedding: np.ndarray | None


def load_unclustered(conn: psycopg.Connection, since: datetime) -> list[PendingArticle]:
    """Articles stored but not yet in a story: this run's new ones, plus any
    left behind by an earlier run that failed between inserting and clustering."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, excerpt, language, published_at, embedding
            FROM articles WHERE story_id IS NULL AND published_at >= %s
            ORDER BY published_at, id
            """,
            (since,),
        )
        return [
            PendingArticle(
                r["id"], r["title"], r["excerpt"], r["language"], r["published_at"],
                None if r["embedding"] is None else to_numpy(r["embedding"]),
            )
            for r in cur.fetchall()
        ]


def set_embeddings(conn: psycopg.Connection, article_ids: list[int], vectors: np.ndarray) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE articles SET embedding = %s WHERE id = %s",
            [(vec, aid) for aid, vec in zip(article_ids, vectors)],
        )
    conn.commit()


def to_numpy(value) -> np.ndarray:
    """pgvector returns Vector objects (newer versions) or numpy arrays."""
    if hasattr(value, "to_numpy"):
        value = value.to_numpy()
    return np.asarray(value, dtype=np.float32)


def load_active_stories(conn: psycopg.Connection, since: datetime) -> list[StoryState]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, centroid, languages, last_article_at, article_count
            FROM stories WHERE last_article_at >= %s
            """,
            (since,),
        )
        return [
            StoryState(
                key=row["id"],
                centroid=to_numpy(row["centroid"]),
                languages=set(row["languages"] or []),
                last_article_at=row["last_article_at"],
                size=row["article_count"],
            )
            for row in cur.fetchall()
        ]


def create_story(conn: psycopg.Connection, state: StoryState) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO stories (centroid, article_count, languages, first_seen_at, last_article_at)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
            """,
            (state.centroid, state.size, sorted(state.languages), state.last_article_at, state.last_article_at),
        )
        return cur.fetchone()["id"]


def assign_articles(conn: psycopg.Connection, pairs: list[tuple[int, int]]) -> None:
    """pairs: (article_id, story_id)"""
    with conn.cursor() as cur:
        cur.executemany("UPDATE articles SET story_id = %s WHERE id = %s", [(s, a) for a, s in pairs])


def merge_stories(conn: psycopg.Connection, keep_id: int, drop_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE articles SET story_id = %s WHERE story_id = %s", (keep_id, drop_id))
        # Readers' comments, votes and reports move to the surviving story.
        cur.execute("UPDATE comments SET story_id = %s WHERE story_id = %s", (keep_id, drop_id))
        cur.execute("UPDATE story_feedback SET story_id = %s WHERE story_id = %s", (keep_id, drop_id))
        cur.execute(
            """
            INSERT INTO story_votes (story_id, visitor, side, created_at)
            SELECT %s, visitor, side, created_at FROM story_votes WHERE story_id = %s
            ON CONFLICT (story_id, visitor) DO NOTHING
            """,
            (keep_id, drop_id),
        )
        # Links to the absorbed story (and to anything already redirected to it) now lead to keep_id.
        cur.execute("UPDATE story_redirects SET to_id = %s WHERE to_id = %s", (keep_id, drop_id))
        cur.execute(
            """
            INSERT INTO story_redirects (from_id, to_id) VALUES (%s, %s)
            ON CONFLICT (from_id) DO UPDATE SET to_id = EXCLUDED.to_id
            """,
            (drop_id, keep_id),
        )
        cur.execute("DELETE FROM stories WHERE id = %s", (drop_id,))


def recompute_story_stats(conn: psycopg.Connection, story_ids: list[int]) -> None:
    """Rebuild centroid and counters from member articles (self-healing)."""
    if not story_ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE stories s SET
              centroid        = sub.centroid,
              article_count   = sub.article_count,
              outlet_count    = sub.outlet_count,
              languages       = sub.languages,
              first_seen_at   = sub.first_at,
              last_article_at = sub.last_at,
              section         = sub.section
            FROM (
              SELECT story_id,
                     sum(embedding)                                  AS centroid,
                     count(*)                                        AS article_count,
                     count(DISTINCT outlet_id)                       AS outlet_count,
                     array_agg(DISTINCT language ORDER BY language)  AS languages,
                     min(published_at)                               AS first_at,
                     max(published_at)                               AS last_at,
                     CASE WHEN avg((section = 'world')::int) >= 0.5
                          THEN 'world' ELSE 'india' END             AS section
              FROM articles
              WHERE story_id = ANY(%s) AND embedding IS NOT NULL
              GROUP BY story_id
            ) sub
            WHERE s.id = sub.story_id
            """,
            (story_ids,),
        )


# ---------- analysis ----------


def stories_needing_analysis(
    conn: psycopg.Connection, min_outlets: int, cooldown_hours: int, limit: int
) -> list[int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM stories
            WHERE outlet_count >= %s
              AND outlet_count > analyzed_outlet_count
              AND (analyzed_at IS NULL OR analyzed_at < now() - make_interval(hours => %s))
              AND last_article_at > now() - interval '48 hours'
            ORDER BY outlet_count DESC, last_article_at DESC
            LIMIT %s
            """,
            (min_outlets, cooldown_hours, limit),
        )
        return [row["id"] for row in cur.fetchall()]


def story_articles_for_analysis(conn: psycopg.Connection, story_id: int, limit: int) -> list[dict]:
    """Newest article per outlet, alternating languages so both are represented."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM (
              SELECT DISTINCT ON (a.outlet_id)
                     o.slug AS outlet_slug, o.name AS outlet_name, a.language,
                     a.title, a.excerpt, a.published_at
              FROM articles a JOIN outlets o ON o.id = a.outlet_id
              WHERE a.story_id = %s
              ORDER BY a.outlet_id, a.published_at DESC
            ) per_outlet
            ORDER BY published_at
            """,
            (story_id,),
        )
        rows = cur.fetchall()
    by_lang: dict[str, list[dict]] = {}
    for r in rows:
        by_lang.setdefault(r["language"], []).append(r)
    picked: list[dict] = []
    while len(picked) < limit and any(by_lang.values()):
        for lang in sorted(by_lang):
            if by_lang[lang] and len(picked) < limit:
                picked.append(by_lang[lang].pop(0))
    return picked


def save_analysis(
    conn: psycopg.Connection,
    story_id: int,
    model: str,
    content: dict,
    input_tokens: int,
    output_tokens: int,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO story_analyses (story_id, model, content, input_tokens, output_tokens, created_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (story_id) DO UPDATE SET
              model = EXCLUDED.model, content = EXCLUDED.content,
              input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
              created_at = now()
            """,
            (story_id, model, json.dumps(content, ensure_ascii=False), input_tokens, output_tokens),
        )
        cur.execute(
            "UPDATE stories SET analyzed_at = now(), analyzed_outlet_count = outlet_count WHERE id = %s",
            (story_id,),
        )
    conn.commit()


def analyses_in_last_24h(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT coalesce(sum(analyses), 0) AS n FROM pipeline_runs WHERE started_at > now() - interval '24 hours'"
        )
        return int(cur.fetchone()["n"])


def story_items(conn: psycopg.Connection, story_id: int) -> list:
    from .cluster import ArticleItem

    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, embedding, language, published_at FROM articles
               WHERE story_id = %s AND embedding IS NOT NULL""",
            (story_id,),
        )
        return [ArticleItem(r["id"], to_numpy(r["embedding"]), r["language"], r["published_at"])
                for r in cur.fetchall()]


def flagged_mixed_stories(conn: psycopg.Connection) -> list[int]:
    """Stories whose saved analysis says the articles describe different events."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT sa.story_id FROM story_analyses sa JOIN stories s ON s.id = sa.story_id
               WHERE sa.content->>'same_event' = 'false' AND s.outlet_count > 1"""
        )
        return [r["story_id"] for r in cur.fetchall()]


def split_story(conn: psycopg.Connection, story_id: int, groups: list[list[int]]) -> list[int]:
    """Keep the largest group in the original story (so its comments, votes and links
    stay); move every other group into a new story. The original loses its analysis
    so it is re-analysed. Returns the ids of all resulting stories."""
    ids = [story_id]
    with conn.cursor() as cur:
        for group in groups[1:]:
            cur.execute(
                """INSERT INTO stories (centroid, article_count, languages, first_seen_at, last_article_at)
                   SELECT sum(embedding), count(*), array_agg(DISTINCT language), min(published_at), max(published_at)
                   FROM articles WHERE id = ANY(%s) RETURNING id""",
                (group,),
            )
            new_id = cur.fetchone()["id"]
            cur.execute("UPDATE articles SET story_id = %s WHERE id = ANY(%s)", (new_id, group))
            ids.append(new_id)
        cur.execute("DELETE FROM story_analyses WHERE story_id = %s", (story_id,))
        cur.execute(
            "UPDATE stories SET analyzed_at = NULL, analyzed_outlet_count = 0 WHERE id = %s", (story_id,)
        )
    recompute_story_stats(conn, ids)
    conn.commit()
    return ids


def mark_analysis_attempted(conn: psycopg.Connection, story_id: int) -> None:
    """After a failed analysis, wait for the cooldown before retrying."""
    with conn.cursor() as cur:
        cur.execute("UPDATE stories SET analyzed_at = now() WHERE id = %s", (story_id,))
    conn.commit()


# ---------- housekeeping ----------


def prune(conn: psycopg.Connection, retention_days: int) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM articles WHERE published_at < now() - make_interval(days => %s)", (retention_days,))
        articles = cur.rowcount
        cur.execute("DELETE FROM stories s WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id)")
        stories = cur.rowcount
        cur.execute("DELETE FROM pipeline_runs WHERE started_at < now() - interval '30 days'")
    conn.commit()
    return {"articles": articles, "stories": stories}


# Arbitrary constant: only one pipeline run may hold this advisory lock at a time.
RUN_LOCK_KEY = 7_424_242


def try_lock(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s) AS ok", (RUN_LOCK_KEY,))
        ok = bool(cur.fetchone()["ok"])
    conn.commit()
    return ok


def unlock(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_unlock(%s)", (RUN_LOCK_KEY,))
    conn.commit()


def start_run(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO pipeline_runs DEFAULT VALUES RETURNING id")
        run_id = cur.fetchone()["id"]
    conn.commit()
    return run_id


def finish_run(conn: psycopg.Connection, run_id: int, stats: dict, errors: list[str]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE pipeline_runs SET
              finished_at = now(), feeds_ok = %s, feeds_failed = %s, articles_new = %s,
              stories_new = %s, stories_merged = %s, analyses = %s,
              input_tokens = %s, output_tokens = %s, errors = %s
            WHERE id = %s
            """,
            (
                stats.get("feeds_ok", 0),
                stats.get("feeds_failed", 0),
                stats.get("articles_new", 0),
                stats.get("stories_new", 0),
                stats.get("stories_merged", 0),
                stats.get("analyses", 0),
                stats.get("input_tokens", 0),
                stats.get("output_tokens", 0),
                json.dumps(errors[:50], ensure_ascii=False),
                run_id,
            ),
        )
    conn.commit()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hours_ago(hours: float) -> datetime:
    return utcnow() - timedelta(hours=hours)

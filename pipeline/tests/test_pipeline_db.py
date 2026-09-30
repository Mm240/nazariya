"""End-to-end pipeline test against a real PostgreSQL + pgvector database.

Needs TEST_DATABASE_URL pointing at an empty, disposable database, e.g.
    TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nazariya_test
Skipped when the variable is not set.
"""

import os
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

import pytest

from nazariya import db, run as run_module
from nazariya.config import PIPELINE_DIR, Feed, load_settings
from nazariya.fetch import FeedResult, parse_feed_bytes

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")

FEEDS = [
    Feed("alpha", "Alpha News", "en", "https://alpha.example/rss"),
    Feed("beta", "Beta Times", "en", "https://beta.example/rss"),
    Feed("gamma", "Gamma Samachar", "hi", "https://gamma.example/rss"),
]


def rss(items: list[tuple[str, str, float]]) -> bytes:
    now = datetime.now(timezone.utc)
    body = "".join(
        f"<item><title>{title}</title><link>{link}</link>"
        f"<pubDate>{format_datetime(now - timedelta(hours=h))}</pubDate></item>"
        for title, link, h in items
    )
    return f'<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>{body}</channel></rss>'.encode()


FEED_ITEMS = {
    "alpha": [
        ("Parliament passes data protection bill after long debate", "https://alpha.example/a1", 3),
        ("Heavy rain floods streets in Mumbai, trains delayed", "https://alpha.example/a2", 2),
        ("Old story from last week about something else", "https://alpha.example/old", 24 * 7),
    ],
    "beta": [
        ("Parliament passes data protection bill after long debate in Lok Sabha", "https://beta.example/b1", 2.5),
        ("Heavy rain floods Mumbai streets, local trains delayed", "https://beta.example/b2?utm_source=rss", 1.5),
    ],
    "gamma": [
        ("संसद ने डेटा संरक्षण विधेयक पारित किया", "https://gamma.example/g1", 2),
    ],
}


@pytest.fixture
def conn():
    connection = db.connect(TEST_DB)
    with connection.cursor() as cur:
        cur.execute("SET lock_timeout = '10s'")  # fail fast instead of hanging on a stray lock
        cur.execute(
            "DROP TABLE IF EXISTS headline_edits, comment_actions, comments, story_votes, story_feedback, pipeline_runs, story_redirects, "
            "story_analyses, articles, stories, outlets CASCADE"
        )
    connection.commit()
    db.apply_schema(connection, (PIPELINE_DIR.parent / "db" / "schema.sql").read_text())
    yield connection
    connection.close()


@pytest.fixture
def settings(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("EMBEDDER", "hashing")  # no model download in tests
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    feeds_file = tmp_path / "feeds.yaml"
    feeds_file.write_text(
        "feeds:\n"
        + "".join(f"  - {{slug: {f.slug}, name: {f.name}, language: {f.language}, url: '{f.url}'}}\n" for f in FEEDS)
    )
    monkeypatch.setenv("FEEDS_PATH", str(feeds_file))
    return load_settings()


@pytest.fixture
def fake_fetch(monkeypatch):
    def _fake(feeds, user_agent):
        results = []
        for f in feeds:
            if f.slug in FEED_ITEMS:
                results.append(FeedResult(f, entries=parse_feed_bytes(rss(FEED_ITEMS[f.slug]))))
            else:
                results.append(FeedResult(f, error="HTTP 404"))
        return results

    monkeypatch.setattr(run_module, "fetch_all_sync", _fake)


def stories(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.outlet_count, s.article_count, s.languages,
                   array_agg(o.slug ORDER BY o.slug) AS outlets
            FROM stories s JOIN articles a ON a.story_id = s.id JOIN outlets o ON o.id = a.outlet_id
            GROUP BY s.id ORDER BY s.id
            """
        )
        return cur.fetchall()


def test_full_run_clusters_and_is_idempotent(conn, settings, fake_fetch):
    stats = run_module.run(settings, analysis=True)
    assert stats["feeds_ok"] == 3
    assert stats["articles_new"] == 5  # the week-old item is skipped
    rows = stories(conn)
    by_outlets = {tuple(r["outlets"]): r for r in rows}
    # Both English "Parliament" headlines share a story; same for the Mumbai rain ones.
    assert ("alpha", "beta") in by_outlets
    assert sum(1 for r in rows if r["outlets"] == ["alpha", "beta"]) == 2
    for r in rows:
        assert r["outlet_count"] == len(set(r["outlets"]))
        assert r["article_count"] == len(r["outlets"])

    # Centroids are recomputed from members with pgvector's sum().
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS bad FROM stories s
            WHERE s.centroid <> (SELECT sum(embedding) FROM articles a WHERE a.story_id = s.id)
            """
        )
        assert cur.fetchone()["bad"] == 0

    # A second run with the same feeds adds nothing and creates no stories.
    stats2 = run_module.run(settings, analysis=True)
    assert stats2["articles_new"] == 0
    assert len(stories(conn)) == len(rows)

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n, bool_and(finished_at IS NOT NULL) AS done FROM pipeline_runs")
        row = cur.fetchone()
        assert row["n"] == 2 and row["done"]


def test_merge_of_existing_stories_moves_articles(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    rows = stories(conn)
    # Split the Parliament story in two by hand, then let a new article trigger a merge.
    parliament = next(r for r in rows if r["outlets"] == ["alpha", "beta"] and r["article_count"] == 2)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM articles WHERE story_id = %s ORDER BY id", (parliament["id"],))
        a1, a2 = [r["id"] for r in cur.fetchall()]
        cur.execute(
            """
            INSERT INTO stories (centroid, first_seen_at, last_article_at)
            SELECT embedding, published_at, published_at FROM articles WHERE id = %s RETURNING id
            """,
            (a2,),
        )
        split_id = cur.fetchone()["id"]
        cur.execute("UPDATE articles SET story_id = %s WHERE id = %s", (split_id, a2))
    db.recompute_story_stats(conn, [parliament["id"], split_id])
    conn.commit()

    FEED_ITEMS["alpha"].append(
        ("Parliament passes data protection bill after long debate today", "https://alpha.example/a3", 1)
    )
    try:
        stats = run_module.run(settings, analysis=False)
    finally:
        FEED_ITEMS["alpha"].pop()
    assert stats["articles_new"] == 1
    assert stats["stories_merged"] >= 1
    with conn.cursor() as cur:
        cur.execute("SELECT count(DISTINCT story_id) AS n, min(story_id) AS sid FROM articles WHERE id IN (%s, %s)",
                    (a1, a2))
        row = cur.fetchone()
        assert row["n"] == 1
        # The absorbed story's id now redirects to the surviving story.
        cur.execute("SELECT from_id, to_id FROM story_redirects")
        redirects = cur.fetchall()
        assert redirects and all(r["to_id"] == row["sid"] for r in redirects)
        assert {r["from_id"] for r in redirects} <= {parliament["id"], split_id}


def test_prune_removes_old_articles_and_empty_stories(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    with conn.cursor() as cur:
        cur.execute("UPDATE articles SET published_at = now() - interval '30 days'")
    conn.commit()
    result = db.prune(conn, retention_days=14)
    assert result["articles"] == 5
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM stories")
        assert cur.fetchone()["n"] == 0


def test_analysis_selection_and_storage(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    ids = db.stories_needing_analysis(conn, min_outlets=2, cooldown_hours=3, limit=5)
    assert len(ids) == 2  # the two stories covered by alpha + beta
    articles = db.story_articles_for_analysis(conn, ids[0], limit=12)
    assert {a["outlet_slug"] for a in articles} == {"alpha", "beta"}

    content = {"same_event": True, "facts_disputed": False,
               "neutral_headline": {"en": "x", "hi": "y"}, "summary": {"en": "x", "hi": "y"},
               "common_ground": [], "differences": [], "outlet_framing": []}
    db.save_analysis(conn, ids[0], "test-model", content, 100, 50)
    remaining = db.stories_needing_analysis(conn, min_outlets=2, cooldown_hours=3, limit=5)
    assert ids[0] not in remaining


def test_articles_left_unclustered_by_a_crashed_run_are_recovered(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    # Simulate a run that stored an article and then died before embedding/clustering it.
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM outlets WHERE slug = 'beta'")
        beta = cur.fetchone()["id"]
        cur.execute(
            """
            INSERT INTO articles (outlet_id, url, url_hash, title, language, published_at)
            VALUES (%s, 'https://beta.example/orphan', 'orphan-hash',
                    'Heavy rain floods streets in Mumbai again, trains delayed', 'en', now() - interval '1 hour')
            RETURNING id
            """,
            (beta,),
        )
        orphan = cur.fetchone()["id"]
    conn.commit()

    stats = run_module.run(settings, analysis=False)
    assert stats["articles_new"] == 0
    with conn.cursor() as cur:
        cur.execute("SELECT story_id, embedding IS NOT NULL AS embedded FROM articles WHERE id = %s", (orphan,))
        row = cur.fetchone()
    assert row["story_id"] is not None and row["embedded"]


def test_daily_limit_caps_analyses(conn, settings, fake_fetch, monkeypatch):
    import nazariya.analyze as analyze_module

    calls = []

    class FakeAnalyzer:
        def __init__(self, api_key, model):
            self.model = model

        def analyze(self, articles):
            calls.append(articles)
            content = {"same_event": True, "facts_disputed": False,
                       "neutral_headline": {"en": "x", "hi": "y"}, "summary": {"en": "x", "hi": "y"},
                       "common_ground": [], "differences": [], "outlet_framing": []}
            return analyze_module.AnalysisResult(content, 1000, 500)

    monkeypatch.setattr(analyze_module, "Analyzer", FakeAnalyzer)
    limited = replace(settings, anthropic_api_key="test-key", min_outlets_for_analysis=2, daily_analysis_limit=1)

    stats = run_module.run(limited, analysis=True)
    assert stats["analyses"] == 1 and len(calls) == 1  # two stories qualify, the cap allows one
    assert stats["input_tokens"] == 1000

    stats = run_module.run(limited, analysis=True)
    assert stats["analyses"] == 0  # budget for the rolling 24 hours is used up


def test_second_concurrent_run_is_skipped(conn, settings, fake_fetch):
    other = db.connect(TEST_DB)
    try:
        assert db.try_lock(other)
        assert run_module.run(settings, analysis=False) == {"skipped": 1}
    finally:
        db.unlock(other)
        other.close()


def test_outlets_removed_from_config_become_inactive(conn, settings, fake_fetch, tmp_path):
    run_module.run(settings, analysis=False)
    feeds_file = tmp_path / "fewer.yaml"
    feeds_file.write_text(
        "feeds:\n"
        "  - {slug: alpha, name: Alpha News, language: en, url: 'https://alpha.example/rss', group: Alpha Group}\n"
    )
    run_module.run(replace(settings, feeds_path=feeds_file), analysis=False)
    with conn.cursor() as cur:
        cur.execute("SELECT slug, active, media_group FROM outlets ORDER BY slug")
        rows = {r["slug"]: r for r in cur.fetchall()}
    assert rows["alpha"]["active"] and rows["alpha"]["media_group"] == "Alpha Group"
    assert not rows["beta"]["active"] and not rows["gamma"]["active"]


def test_world_feeds_share_an_outlet_and_mark_world_stories(conn, settings, fake_fetch, tmp_path, monkeypatch):
    FEED_ITEMS["alpha-world"] = [
        ("Ceasefire talks resume in Geneva as envoys meet", "https://alpha.example/w1", 2),
    ]
    FEED_ITEMS["intl"] = [
        ("Ceasefire talks resume in Geneva as envoys meet again", "https://intl.example/w1", 1.5),
    ]
    feeds_file = tmp_path / "world.yaml"
    feeds_file.write_text(
        "feeds:\n"
        "  - {slug: alpha, name: Alpha News, language: en, url: 'https://alpha.example/rss'}\n"
        "  - {slug: alpha-world, outlet: alpha, section: world, name: Alpha News, language: en, url: 'https://alpha.example/world'}\n"
        "  - {slug: intl, name: Intl Wire, language: en, scope: international, section: world, url: 'https://intl.example/rss'}\n"
    )
    try:
        run_module.run(replace(settings, feeds_path=feeds_file), analysis=False)
    finally:
        FEED_ITEMS.pop("alpha-world")
        FEED_ITEMS.pop("intl")
    with conn.cursor() as cur:
        cur.execute("SELECT slug, scope FROM outlets ORDER BY slug")
        assert [(r["slug"], r["scope"]) for r in cur.fetchall()] == [("alpha", "indian"), ("intl", "international")]
        cur.execute(
            """SELECT s.section, s.outlet_count FROM stories s JOIN articles a ON a.story_id = s.id
               WHERE a.url = 'https://intl.example/w1'"""
        )
        row = cur.fetchone()
    assert row["section"] == "world" and row["outlet_count"] == 2


def test_merge_keeps_readers_comments_and_votes(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM stories ORDER BY id LIMIT 2")
        keep, drop = [r["id"] for r in cur.fetchall()]
        cur.execute("INSERT INTO comments (story_id, visitor, name, body) VALUES (%s, 'v1', 'A', 'hello')", (drop,))
        cur.execute("INSERT INTO story_votes (story_id, visitor, side) VALUES (%s, 'v1', 'for'), (%s, 'v2', 'against')",
                    (drop, drop))
        cur.execute("INSERT INTO story_votes (story_id, visitor, side) VALUES (%s, 'v1', 'against')", (keep,))
    db.merge_stories(conn, keep, drop)
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM comments WHERE story_id = %s", (keep,))
        assert cur.fetchone()["n"] == 1
        cur.execute("SELECT visitor, side FROM story_votes WHERE story_id = %s ORDER BY visitor", (keep,))
        # v1 already voted on the surviving story, so their vote there wins; v2's vote moves over.
        assert [(r["visitor"], r["side"]) for r in cur.fetchall()] == [("v1", "against"), ("v2", "against")]


def test_ai_verdict_of_different_events_splits_the_story(conn, settings, fake_fetch, monkeypatch):
    """An over-merged story (built here by merging two real ones) gets split when
    the analysis says its articles are not about the same event."""
    import nazariya.analyze as analyze_module

    run_module.run(settings, analysis=False)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM stories ORDER BY outlet_count DESC, id LIMIT 2")
        keep, drop = [r["id"] for r in cur.fetchall()]
        cur.execute("SELECT count(*) AS n FROM articles WHERE story_id IN (%s, %s)", (keep, drop))
        total = cur.fetchone()["n"]
    db.merge_stories(conn, keep, drop)
    db.recompute_story_stats(conn, [keep])
    conn.commit()

    class MixedAnalyzer:
        def __init__(self, api_key, model):
            self.model = model

        def analyze(self, articles):
            return analyze_module.AnalysisResult({"same_event": False}, 800, 100)

    monkeypatch.setattr(analyze_module, "Analyzer", MixedAnalyzer)
    stats = run_module.run(replace(settings, anthropic_api_key="k", min_outlets_for_analysis=2), analysis=True)

    assert stats["stories_split"] >= 1
    with conn.cursor() as cur:
        cur.execute("SELECT count(DISTINCT story_id) AS n, count(*) AS total FROM articles WHERE story_id IS NOT NULL "
                    "AND id IN (SELECT id FROM articles)")
        cur.execute("SELECT count(*) AS n FROM story_analyses WHERE story_id = %s", (keep,))
        assert cur.fetchone()["n"] == 0  # the mixed analysis is not shown
        cur.execute("SELECT count(*) AS n FROM articles WHERE story_id = %s", (keep,))
        assert 0 < cur.fetchone()["n"] < total  # the original story kept only one of the events


def test_stories_flagged_in_earlier_runs_are_split_without_calling_the_ai(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM stories ORDER BY outlet_count DESC, id LIMIT 2")
        keep, drop = [r["id"] for r in cur.fetchall()]
    db.merge_stories(conn, keep, drop)
    db.recompute_story_stats(conn, [keep])
    db.save_analysis(conn, keep, "m", {"same_event": False}, 1, 1)
    conn.commit()

    stats = run_module.run(settings, analysis=False)
    assert stats.get("stories_split") == 1
    assert db.flagged_mixed_stories(conn) == []


def test_changed_headlines_are_recorded_as_edits(conn, settings, fake_fetch):
    run_module.run(settings, analysis=False)
    title, url, age = FEED_ITEMS["alpha"][0]
    FEED_ITEMS["alpha"][0] = ("UPDATED: " + title + " amid protests", url, age)
    try:
        run_module.run(settings, analysis=False)
        run_module.run(settings, analysis=False)  # seeing the same new title again is not another edit
    finally:
        FEED_ITEMS["alpha"][0] = (title, url, age)
    with conn.cursor() as cur:
        cur.execute("SELECT old_title, new_title FROM headline_edits")
        edits = cur.fetchall()
        cur.execute("SELECT title FROM articles WHERE url = %s", (url,))
        current = cur.fetchone()["title"]
    assert len(edits) == 1 and edits[0]["old_title"] == title
    assert current.startswith("UPDATED:")


def test_feed_category_flows_to_articles_and_stories(conn, settings, fake_fetch, tmp_path):
    feeds_file = tmp_path / "sports.yaml"
    feeds_file.write_text(
        "feeds:\n"
        "  - {slug: alpha, name: Alpha News, language: en, url: 'https://alpha.example/rss', category: sports}\n"
        "  - {slug: beta, name: Beta Times, language: en, url: 'https://beta.example/rss', category: sports}\n"
    )
    run_module.run(replace(settings, feeds_path=feeds_file), analysis=False)
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT category FROM articles")
        assert [r["category"] for r in cur.fetchall()] == ["sports"]
        cur.execute("SELECT count(*) AS n FROM stories WHERE category = 'sports'")
        assert cur.fetchone()["n"] > 0

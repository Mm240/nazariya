"""One pipeline run. Scheduled every 15 minutes by .github/workflows/pipeline.yml.

    python -m nazariya.run                 # full run
    python -m nazariya.run --no-analysis   # skip the Claude step
    python -m nazariya.run --init-db       # apply db/schema.sql first
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import timedelta

from . import db
from .cluster import ArticleItem, Clusterer, split_groups
from .config import PIPELINE_DIR, Settings, load_feeds, load_settings
from .embed import make_embedder
from .fetch import fetch_all_sync
from .normalize import embedding_text, normalize_entry

log = logging.getLogger("nazariya")


def run(settings: Settings, analysis: bool = True, init_db: bool = False) -> dict:
    started = time.monotonic()
    stats: dict[str, int] = {}
    errors: list[str] = []

    conn = db.connect(settings.database_url)
    try:
        if init_db:
            db.apply_schema(conn, (PIPELINE_DIR.parent / "db" / "schema.sql").read_text(encoding="utf-8"))
            log.info("schema applied")
        if not db.try_lock(conn):
            log.warning("another pipeline run holds the lock; exiting without doing anything")
            return {"skipped": 1}
        try:
            return _run(conn, settings, analysis, started, stats, errors)
        finally:
            conn.rollback()  # no-op after a clean run; releases row locks after a crash
            db.unlock(conn)
    finally:
        conn.close()


def _run(conn, settings: Settings, analysis: bool, started: float,
         stats: dict[str, int], errors: list[str]) -> dict:
    run_id = db.start_run(conn)

    # 1. Fetch
    feeds = load_feeds(settings.feeds_path)
    outlet_ids = db.upsert_outlets(conn, feeds)
    results = fetch_all_sync(feeds, settings.user_agent)
    stats["feeds_ok"] = sum(r.ok for r in results)
    stats["feeds_failed"] = len(results) - stats["feeds_ok"]
    errors += [f"feed {r.feed.slug}: {r.error}" for r in results if not r.ok]

    # 2. Normalise and store new articles
    now = db.utcnow()
    candidates = []
    seen_hashes: set[str] = set()
    for result in results:
        for entry in result.entries:
            c = normalize_entry(
                entry,
                result.feed,
                now,
                settings.max_article_age_hours,
                settings.skip_url_patterns,
                settings.skip_title_keywords,
            )
            if c and c.url_hash not in seen_hashes:
                seen_hashes.add(c.url_hash)
                candidates.append(c)
    new_articles = db.insert_articles(conn, candidates, outlet_ids)
    stats["articles_new"] = len(new_articles)
    log.info("%d candidates, %d new articles", len(candidates), len(new_articles))

    # 3. Embed and cluster everything not yet in a story (normally just the new
    #    articles; after a crashed run, also whatever it left behind).
    stats["stories_new"] = stats["stories_merged"] = 0
    pending = db.load_unclustered(conn, now - timedelta(hours=settings.max_article_age_hours))
    if pending:
        missing = [p for p in pending if p.embedding is None]
        if missing:
            embedder = make_embedder(settings.embedder, settings.embedding_model, settings.model_cache_dir)
            vectors = embedder.embed([embedding_text(p.title, p.excerpt) for p in missing])
            db.set_embeddings(conn, [p.id for p in missing], vectors)
            for p, v in zip(missing, vectors):
                p.embedding = v
        if len(pending) > len(new_articles):
            log.info("recovering %d articles left unclustered by an earlier run", len(pending) - len(new_articles))

        earliest = min(p.published_at for p in pending)
        window = timedelta(hours=settings.cluster.window_hours)
        clusterer = Clusterer.from_stories(settings.cluster, db.load_active_stories(conn, earliest - window))
        for p in pending:  # already sorted by publish time
            clusterer.assign(ArticleItem(p.id, p.embedding, p.language, p.published_at))
        merges = clusterer.merge_pass(now=now)

        # Persist in one transaction: new stories, assignments, merges, stats.
        id_map: dict[int, int] = {}
        for key in sorted(clusterer.created, reverse=True):  # temp keys: -1, -2, ...
            id_map[key] = db.create_story(conn, clusterer.stories[key])

        def to_db(key: int) -> int:
            key = clusterer.resolve(key)
            return id_map.get(key, key)

        db.assign_articles(conn, [(a, to_db(s)) for a, s in clusterer.assignments.items()])
        for keep, drop in merges:
            if drop > 0:  # an existing database story was absorbed
                db.merge_stories(conn, to_db(keep), drop)
        db.recompute_story_stats(conn, sorted({to_db(k) for k in clusterer.touched}))
        conn.commit()

        stats["stories_new"] = len(clusterer.created)
        stats["stories_merged"] = len(merges)
        log.info("%d new stories, %d merges", stats["stories_new"], stats["stories_merged"])

    # 3b. Stories an earlier analysis flagged as mixing different events: split them
    #     now (no AI call needed; the pieces get analysed on their own later).
    for story_id in db.flagged_mixed_stories(conn):
        groups = split_groups(db.story_items(conn, story_id), settings.cluster)
        if len(groups) > 1:
            ids = db.split_story(conn, story_id, groups)
            stats["stories_split"] = stats.get("stories_split", 0) + 1
            log.info("split previously flagged story %s into %d stories", story_id, len(ids))

    # 4. AI analysis, within the per-run and rolling 24-hour budgets
    stats["analyses"] = stats["input_tokens"] = stats["output_tokens"] = 0
    if analysis and settings.anthropic_api_key:
        budget = min(settings.max_analyses_per_run,
                     settings.daily_analysis_limit - db.analyses_in_last_24h(conn))
        if budget <= 0:
            log.info("daily analysis limit (%d) reached; skipping AI analysis this run",
                     settings.daily_analysis_limit)
        else:
            _analyze(conn, settings, budget, stats, errors)
    elif analysis:
        log.info("ANTHROPIC_API_KEY not set: skipping AI analysis (stories still cluster and display)")

    # 5. Housekeeping
    pruned = db.prune(conn, settings.retention_days)
    log.info("pruned %d old articles, %d empty stories", pruned["articles"], pruned["stories"])

    db.finish_run(conn, run_id, stats, errors)
    elapsed = time.monotonic() - started
    log.info("run %d finished in %.1fs: %s", run_id, elapsed, stats)
    _write_github_summary(settings, stats, errors, elapsed)
    return stats


def _analyze(conn, settings: Settings, budget: int, stats: dict[str, int], errors: list[str]) -> None:
    from .analyze import Analyzer

    analyzer = Analyzer(settings.anthropic_api_key, settings.analysis_model)
    story_ids = db.stories_needing_analysis(
        conn, settings.min_outlets_for_analysis, settings.reanalysis_cooldown_hours, budget
    )
    for story_id in story_ids:
        articles = db.story_articles_for_analysis(conn, story_id, settings.max_articles_per_analysis)
        try:
            result = analyzer.analyze(articles)
        except Exception as exc:
            # Unusable output was still billed: count its tokens so cost figures stay honest.
            stats["input_tokens"] += getattr(exc, "input_tokens", 0)
            stats["output_tokens"] += getattr(exc, "output_tokens", 0)
            errors.append(f"analysis story {story_id}: {type(exc).__name__}: {exc}"[:300])
            log.warning("analysis failed for story %s: %s", story_id, exc)
            db.mark_analysis_attempted(conn, story_id)
            if type(exc).__name__ in ("AuthenticationError", "PermissionDeniedError", "NotFoundError"):
                # Wrong key, no credit, or a retired ANALYSIS_MODEL: every call would fail the same way.
                log.error("stopping analysis for this run: check ANTHROPIC_API_KEY and ANALYSIS_MODEL")
                break
            continue
        stats["analyses"] += 1
        stats["input_tokens"] += result.input_tokens
        stats["output_tokens"] += result.output_tokens
        if result.content.get("same_event") is False:
            # The AI says these articles describe different events: the grouping
            # over-merged. Re-cluster the story's articles more strictly.
            groups = split_groups(db.story_items(conn, story_id), settings.cluster)
            if len(groups) > 1:
                ids = db.split_story(conn, story_id, groups)
                stats["stories_split"] = stats.get("stories_split", 0) + 1
                log.info("story %s mixed different events: split into %d stories %s", story_id, len(ids), ids)
                continue
            log.info("story %s mixed different events but could not be split further", story_id)
        db.save_analysis(conn, story_id, analyzer.model, result.content, result.input_tokens, result.output_tokens)
    log.info("%d analyses, %d in / %d out tokens, ~$%.4f", stats["analyses"],
             stats["input_tokens"], stats["output_tokens"], _cost(settings, stats))


def _cost(settings: Settings, stats: dict[str, int]) -> float:
    return (stats.get("input_tokens", 0) * settings.input_price_per_mtok
            + stats.get("output_tokens", 0) * settings.output_price_per_mtok) / 1_000_000


def _write_github_summary(settings: Settings, stats: dict[str, int], errors: list[str], elapsed: float) -> None:
    """Show a small table on the GitHub Actions run page."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    rows = [
        ("Feeds reachable", f"{stats.get('feeds_ok', 0)} / {stats.get('feeds_ok', 0) + stats.get('feeds_failed', 0)}"),
        ("New articles", stats.get("articles_new", 0)),
        ("New stories", stats.get("stories_new", 0)),
        ("Stories merged", stats.get("stories_merged", 0)),
        ("Mixed stories split by the AI check", stats.get("stories_split", 0)),
        ("AI analyses", stats.get("analyses", 0)),
        ("Estimated AI cost", f"${_cost(settings, stats):.4f}"),
        ("Duration", f"{elapsed:.0f}s"),
    ]
    lines = ["### Nazariya pipeline run", "", "| | |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in rows]
    if errors:
        lines += ["", "<details><summary>Problems this run</summary>", ""]
        lines += [f"- {e}" for e in errors[:30]]
        lines += ["", "</details>"]
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Nazariya news pipeline once.")
    parser.add_argument("--no-analysis", action="store_true", help="skip the Claude analysis step")
    parser.add_argument("--init-db", action="store_true", help="apply db/schema.sql before running")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
    stats = run(load_settings(), analysis=not args.no_analysis, init_db=args.init_db)
    if stats.get("skipped"):
        return 0
    # Fail the scheduled job loudly if every feed failed (network or config problem).
    return 1 if stats.get("feeds_ok", 0) == 0 else 0


if __name__ == "__main__":
    sys.exit(main())

"""Measure clustering quality against hand labels, and tune thresholds.

1. Export recent articles to a CSV, grouped by the story they were put in:
       python -m nazariya.evaluate export --hours 6 --out labels.csv
2. Open the CSV and fix the `gold_story` column so that articles about the
   same event share a value (it starts as a copy of the predicted story;
   check every row, don't just accept it).
3. Score the live clustering:
       python -m nazariya.evaluate score labels.csv
4. Replay clustering over the same articles with a grid of thresholds:
       python -m nazariya.evaluate sweep labels.csv
   then set the best values as SAME_LANG_THRESHOLD / CROSS_LANG_THRESHOLD /
   MERGE_THRESHOLD in the pipeline environment.

Metrics: B-cubed precision/recall/F1 over all articles, plus precision and
recall restricted to cross-language pairs (one Hindi and one English article),
which is the number that shows whether multilingual clustering really works.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, replace

from . import db
from .cluster import ArticleItem, replay
from .config import load_settings


@dataclass
class Scores:
    precision: float
    recall: float
    f1: float
    xl_precision: float | None  # cross-lingual pair precision
    xl_recall: float | None
    xl_gold_pairs: int


def _f1(p: float, r: float) -> float:
    return 2 * p * r / (p + r) if p + r else 0.0


def bcubed(pred: dict[int, object], gold: dict[int, object]) -> tuple[float, float, float]:
    items = [i for i in gold if i in pred]
    if not items:
        return 0.0, 0.0, 0.0
    pred_members: dict[object, set[int]] = defaultdict(set)
    gold_members: dict[object, set[int]] = defaultdict(set)
    for i in items:
        pred_members[pred[i]].add(i)
        gold_members[gold[i]].add(i)
    p = r = 0.0
    for i in items:
        overlap = len(pred_members[pred[i]] & gold_members[gold[i]])
        p += overlap / len(pred_members[pred[i]])
        r += overlap / len(gold_members[gold[i]])
    p, r = p / len(items), r / len(items)
    return p, r, _f1(p, r)


def cross_lingual(
    pred: dict[int, object], gold: dict[int, object], lang: dict[int, str]
) -> tuple[float | None, float | None, int]:
    """Precision/recall over pairs of articles in different languages."""

    def xl_pairs(counter: Counter) -> int:
        return counter["en"] * counter["hi"]

    items = [i for i in gold if i in pred]
    by_pred: dict[object, Counter] = defaultdict(Counter)
    by_gold: dict[object, Counter] = defaultdict(Counter)
    by_both: dict[tuple, Counter] = defaultdict(Counter)
    for i in items:
        by_pred[pred[i]][lang[i]] += 1
        by_gold[gold[i]][lang[i]] += 1
        by_both[(pred[i], gold[i])][lang[i]] += 1
    tp = sum(xl_pairs(c) for c in by_both.values())
    pred_pos = sum(xl_pairs(c) for c in by_pred.values())
    gold_pos = sum(xl_pairs(c) for c in by_gold.values())
    precision = tp / pred_pos if pred_pos else None
    recall = tp / gold_pos if gold_pos else None
    return precision, recall, gold_pos


def score(pred: dict[int, object], gold: dict[int, object], lang: dict[int, str]) -> Scores:
    p, r, f = bcubed(pred, gold)
    xp, xr, n = cross_lingual(pred, gold, lang)
    return Scores(p, r, f, xp, xr, n)


def _fmt(x: float | None) -> str:
    return "  n/a" if x is None else f"{x:5.3f}"


def read_labels(path: str) -> tuple[dict[int, str], dict[int, str], dict[int, str]]:
    pred, gold, lang = {}, {}, {}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if not row.get("gold_story", "").strip():
                continue
            aid = int(row["article_id"])
            pred[aid] = row["story_id"]
            gold[aid] = row["gold_story"].strip()
            lang[aid] = row["language"]
    return pred, gold, lang


def cmd_export(args: argparse.Namespace) -> int:
    settings = load_settings()
    conn = db.connect(settings.database_url)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.id, a.story_id, a.language, o.name AS outlet, a.published_at, a.title
            FROM articles a JOIN outlets o ON o.id = a.outlet_id
            WHERE a.published_at > now() - %s * interval '1 hour' AND a.story_id IS NOT NULL
            ORDER BY a.story_id, a.published_at
            LIMIT %s
            """,
            (args.hours, args.limit),
        )
        rows = cur.fetchall()
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["article_id", "story_id", "gold_story", "language", "outlet", "published_at", "title"])
        for r in rows:
            writer.writerow([r["id"], r["story_id"], r["story_id"], r["language"], r["outlet"],
                             r["published_at"].isoformat(timespec="minutes"), r["title"]])
    print(f"Wrote {len(rows)} articles to {args.out}. Edit the gold_story column, then run `score`.")
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    pred, gold, lang = read_labels(args.labels)
    s = score(pred, gold, lang)
    print(f"articles: {len(gold)}   gold stories: {len(set(gold.values()))}   predicted: {len(set(pred.values()))}")
    print(f"B-cubed   precision {_fmt(s.precision)}  recall {_fmt(s.recall)}  F1 {_fmt(s.f1)}")
    print(f"Cross-lingual pairs ({s.xl_gold_pairs} gold)  precision {_fmt(s.xl_precision)}  recall {_fmt(s.xl_recall)}")
    return 0


def cmd_sweep(args: argparse.Namespace) -> int:
    settings = load_settings()
    _, gold, lang = read_labels(args.labels)
    conn = db.connect(settings.database_url)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, language, published_at, embedding FROM articles WHERE id = ANY(%s) AND embedding IS NOT NULL",
            (list(gold),),
        )
        items = [
            ArticleItem(r["id"], db.to_numpy(r["embedding"]), r["language"], r["published_at"])
            for r in cur.fetchall()
        ]
    print(f"Replaying {len(items)} labelled articles...")

    grid_same = [0.58, 0.62, 0.66, 0.70, 0.74]
    grid_cross = [0.50, 0.54, 0.58, 0.62, 0.66]
    grid_merge = [0.74, 0.78, 0.82, 0.86]
    results = []
    for same, cross, merge in itertools.product(grid_same, grid_cross, grid_merge):
        if cross > same or merge < same:
            continue
        params = replace(settings.cluster, same_lang_threshold=same, cross_lang_threshold=cross, merge_threshold=merge)
        pred = replay(items, params)
        results.append((score(pred, gold, lang), same, cross, merge))

    results.sort(key=lambda r: (r[0].f1, r[0].precision), reverse=True)
    print(f"{'same':>5} {'cross':>5} {'merge':>5}   {'P':>5} {'R':>5} {'F1':>5}   {'xl-P':>5} {'xl-R':>5}")
    for s, same, cross, merge in results[: args.top]:
        print(f"{same:5.2f} {cross:5.2f} {merge:5.2f}   {_fmt(s.precision)} {_fmt(s.recall)} {_fmt(s.f1)}"
              f"   {_fmt(s.xl_precision)} {_fmt(s.xl_recall)}")
    best = results[0]
    print(f"\nBest: SAME_LANG_THRESHOLD={best[1]} CROSS_LANG_THRESHOLD={best[2]} MERGE_THRESHOLD={best[3]}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_export = sub.add_parser("export", help="export recent articles for labelling")
    p_export.add_argument("--hours", type=float, default=6)
    p_export.add_argument("--limit", type=int, default=600)
    p_export.add_argument("--out", default="labels.csv")
    p_score = sub.add_parser("score", help="score the live clustering against labels")
    p_score.add_argument("labels")
    p_sweep = sub.add_parser("sweep", help="replay clustering with a grid of thresholds")
    p_sweep.add_argument("labels")
    p_sweep.add_argument("--top", type=int, default=10)
    args = parser.parse_args(argv)
    return {"export": cmd_export, "score": cmd_score, "sweep": cmd_sweep}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

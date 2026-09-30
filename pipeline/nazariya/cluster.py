"""Group articles about the same event into stories.

The algorithm is online (single pass, articles in publish order):

1. Compare the new article with every story active in the last
   `window_hours`, using cosine similarity to the story centroid.
2. The acceptance threshold depends on language: if the story already has an
   article in the new article's language, use `same_lang_threshold`;
   otherwise use the lower `cross_lang_threshold`, because multilingual
   embedders score translations a little lower than same-language paraphrases.
3. Join the story with the largest margin above its threshold, or start a
   new story if none clears it.
4. After each batch, a merge pass joins stories whose centroids are very
   close. This repairs fragmentation, e.g. when a Hindi report arrived before
   any English one and started its own story.

This module is pure numpy with no database access, so the exact same code
runs in the pipeline and in offline evaluation (`nazariya.evaluate`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import math
from collections import defaultdict
from dataclasses import replace

import numpy as np

from .config import ClusterParams


@dataclass
class StoryState:
    key: int  # database id (> 0) or temporary id (< 0) for stories created this run
    centroid: np.ndarray  # sum of member unit vectors
    languages: set[str]
    last_article_at: datetime
    size: int


@dataclass
class ArticleItem:
    key: int
    vector: np.ndarray  # unit length
    language: str
    published_at: datetime


@dataclass
class Clusterer:
    params: ClusterParams
    stories: dict[int, StoryState] = field(default_factory=dict)
    assignments: dict[int, int] = field(default_factory=dict)  # article key -> story key
    created: set[int] = field(default_factory=set)
    touched: set[int] = field(default_factory=set)
    redirects: dict[int, int] = field(default_factory=dict)  # merged-away key -> surviving key
    _next_temp: int = -1

    @classmethod
    def from_stories(cls, params: ClusterParams, stories: list[StoryState]) -> "Clusterer":
        return cls(params=params, stories={s.key: s for s in stories})

    # ---------- assignment ----------

    def _size_bonus(self, size: int) -> float:
        """Extra similarity required from big stories (see ClusterParams)."""
        if size <= 2:
            return 0.0
        return min(self.params.max_growth, self.params.growth_per_doubling * math.log2(size / 2))

    def _threshold(self, story: StoryState, language: str) -> float:
        base = (
            self.params.same_lang_threshold
            if language in story.languages
            else self.params.cross_lang_threshold
        )
        return base + self._size_bonus(story.size)

    def best_match(self, item: ArticleItem) -> tuple[int | None, float]:
        """Return (story key, similarity) of the best story, or (None, best_sim)."""
        window_start = item.published_at - timedelta(hours=self.params.window_hours)
        candidates = [s for s in self.stories.values() if s.last_article_at >= window_start]
        if not candidates:
            return None, 0.0
        centroids = np.stack([s.centroid for s in candidates])
        norms = np.linalg.norm(centroids, axis=1)
        norms[norms == 0] = 1.0
        sims = (centroids @ item.vector) / norms

        best_key, best_margin, best_sim = None, -1.0, float(sims.max())
        for story, sim in zip(candidates, sims):
            margin = float(sim) - self._threshold(story, item.language)
            if margin >= 0 and margin > best_margin:
                best_key, best_margin, best_sim = story.key, margin, float(sim)
        return best_key, best_sim

    def assign(self, item: ArticleItem) -> int:
        key, _ = self.best_match(item)
        if key is None:
            key = self._next_temp
            self._next_temp -= 1
            self.stories[key] = StoryState(
                key=key,
                centroid=item.vector.astype(np.float32).copy(),
                languages={item.language},
                last_article_at=item.published_at,
                size=1,
            )
            self.created.add(key)
        else:
            story = self.stories[key]
            story.centroid = story.centroid + item.vector
            story.languages.add(item.language)
            story.last_article_at = max(story.last_article_at, item.published_at)
            story.size += 1
        self.assignments[item.key] = key
        self.touched.add(key)
        return key

    # ---------- merging ----------

    def _merge_threshold(self, a: StoryState, b: StoryState) -> float:
        bonus = self._size_bonus(max(a.size, b.size))
        if a.languages & b.languages:
            return self.params.merge_threshold + bonus
        # Disjoint languages (e.g. Hindi-only vs English-only): apply the same
        # cross-language discount used for assignment.
        delta = self.params.same_lang_threshold - self.params.cross_lang_threshold
        return self.params.merge_threshold - delta + bonus

    def merge_pass(self, now: datetime) -> list[tuple[int, int]]:
        """Merge near-duplicate stories. Returns (kept_key, dropped_key) pairs."""
        window_start = now - timedelta(hours=self.params.window_hours)
        active = [s for s in self.stories.values() if s.last_article_at >= window_start]
        touched = [s for s in active if s.key in self.touched]
        if not touched or len(active) < 2:
            return []

        def unit(matrix: np.ndarray) -> np.ndarray:
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            return matrix / norms

        t_mat = unit(np.stack([s.centroid for s in touched]))
        a_mat = unit(np.stack([s.centroid for s in active]))
        sims = t_mat @ a_mat.T

        pairs: list[tuple[float, int, int]] = []
        for i, ts in enumerate(touched):
            for j, as_ in enumerate(active):
                if ts.key == as_.key:
                    continue
                if sims[i, j] >= self._merge_threshold(ts, as_):
                    a, b = sorted((ts.key, as_.key))
                    pairs.append((float(sims[i, j]), a, b))
        if not pairs:
            return []

        # Union-find over candidate pairs, strongest first.
        parent: dict[int, int] = {}

        def find(k: int) -> int:
            parent.setdefault(k, k)
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k

        for _, a, b in sorted(set(pairs), reverse=True):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        groups: dict[int, list[int]] = {}
        for k in parent:
            groups.setdefault(find(k), []).append(k)

        merges: list[tuple[int, int]] = []
        for members in groups.values():
            if len(members) < 2:
                continue
            # Keep an existing database story when possible (stable ids and URLs),
            # then the biggest story.
            keep = min(members, key=lambda k: (k < 0, -self.stories[k].size, abs(k)))
            for drop in members:
                if drop != keep:
                    self._absorb(keep, drop)
                    merges.append((keep, drop))
        return merges

    def _absorb(self, keep: int, drop: int) -> None:
        kept, dropped = self.stories[keep], self.stories.pop(drop)
        kept.centroid = kept.centroid + dropped.centroid
        kept.languages |= dropped.languages
        kept.last_article_at = max(kept.last_article_at, dropped.last_article_at)
        kept.size += dropped.size
        self.redirects[drop] = keep
        self.created.discard(drop)
        self.touched.discard(drop)
        self.touched.add(keep)
        for article_key, story_key in self.assignments.items():
            if story_key == drop:
                self.assignments[article_key] = keep

    def resolve(self, key: int) -> int:
        while key in self.redirects:
            key = self.redirects[key]
        return key


def replay(items: list[ArticleItem], params: ClusterParams, batch_hours: float = 1.0) -> dict[int, int]:
    """Cluster items from scratch, simulating hourly pipeline runs.
    Returns article key -> story key. Used for offline evaluation."""
    clusterer = Clusterer(params=params)
    items = sorted(items, key=lambda it: (it.published_at, it.key))
    if not items:
        return {}
    batch_end = items[0].published_at + timedelta(hours=batch_hours)
    for item in items:
        if item.published_at >= batch_end:
            clusterer.merge_pass(now=batch_end)
            clusterer.touched.clear()
            while item.published_at >= batch_end:
                batch_end += timedelta(hours=batch_hours)
        clusterer.assign(item)
    clusterer.merge_pass(now=items[-1].published_at)
    return {a: clusterer.resolve(s) for a, s in clusterer.assignments.items()}


def split_groups(items: list[ArticleItem], params: ClusterParams) -> list[list[int]]:
    """Re-cluster one story's articles with stricter thresholds and no merging.

    Used when the AI analysis reports that a story mixes different events.
    Returns groups of article keys, largest first; one group means "can't split".
    """
    t = params.split_tighten
    strict = replace(
        params,
        same_lang_threshold=params.same_lang_threshold + t,
        cross_lang_threshold=params.cross_lang_threshold + t,
        merge_threshold=params.merge_threshold + t,
        window_hours=10_000.0,  # the articles already belong together in time
    )
    clusterer = Clusterer(strict)
    for item in sorted(items, key=lambda i: (i.published_at, i.key)):
        clusterer.assign(item)
    groups: dict[int, list[int]] = defaultdict(list)
    for article, story in clusterer.assignments.items():
        groups[story].append(article)
    return sorted(groups.values(), key=lambda g: (-len(g), min(g)))

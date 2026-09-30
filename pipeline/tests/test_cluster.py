from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from nazariya.cluster import ArticleItem, Clusterer, StoryState, replay
from nazariya.config import ClusterParams

T0 = datetime(2026, 9, 29, 6, 0, tzinfo=timezone.utc)
DIM = 384
PARAMS = ClusterParams(same_lang_threshold=0.66, cross_lang_threshold=0.58, merge_threshold=0.78, window_hours=36)


def unit(v):
    return (v / np.linalg.norm(v)).astype(np.float32)


@pytest.fixture
def rng():
    return np.random.default_rng(42)


def near(base, rng, similarity):
    """A unit vector with (approximately) the given cosine similarity to base."""
    noise = rng.normal(size=DIM)
    noise -= noise.dot(base) * base  # orthogonal to base
    noise = unit(noise)
    return unit(similarity * base + np.sqrt(1 - similarity**2) * noise)


def item(key, vec, lang="en", hours=0.0):
    return ArticleItem(key=key, vector=vec, language=lang, published_at=T0 + timedelta(hours=hours))


def test_similar_same_language_articles_join_one_story(rng):
    event = unit(rng.normal(size=DIM))
    c = Clusterer(PARAMS)
    s1 = c.assign(item(1, near(event, rng, 0.9)))
    s2 = c.assign(item(2, near(event, rng, 0.9), hours=1))
    assert s1 == s2
    assert c.stories[s1].size == 2


def test_unrelated_articles_start_new_stories(rng):
    c = Clusterer(PARAMS)
    s1 = c.assign(item(1, unit(rng.normal(size=DIM))))
    s2 = c.assign(item(2, unit(rng.normal(size=DIM))))
    assert s1 != s2
    assert c.created == {s1, s2}


def test_cross_language_uses_lower_threshold(rng):
    event = unit(rng.normal(size=DIM))
    english = near(event, rng, 0.95)
    # A Hindi article with ~0.62 similarity: below the same-language threshold
    # (0.66) but above the cross-language threshold (0.58).
    hindi = near(english, rng, 0.62)
    c = Clusterer(PARAMS)
    s_en = c.assign(item(1, english, "en"))
    s_hi = c.assign(item(2, hindi, "hi", hours=1))
    assert s_en == s_hi
    assert c.stories[s_en].languages == {"en", "hi"}

    # The same similarity between two English articles is not enough.
    c2 = Clusterer(PARAMS)
    a = c2.assign(item(1, english, "en"))
    b = c2.assign(item(2, near(english, rng, 0.62), "en", hours=1))
    assert a != b


def test_stories_outside_the_window_are_not_candidates(rng):
    event = unit(rng.normal(size=DIM))
    c = Clusterer(PARAMS)
    s1 = c.assign(item(1, near(event, rng, 0.95)))
    s2 = c.assign(item(2, near(event, rng, 0.95), hours=PARAMS.window_hours + 1))
    assert s1 != s2


def test_best_margin_wins(rng):
    event_a, event_b = unit(rng.normal(size=DIM)), unit(rng.normal(size=DIM))
    c = Clusterer(PARAMS)
    sa = c.assign(item(1, event_a))
    c.assign(item(2, event_b))
    # Much closer to A than B.
    assert c.assign(item(3, near(event_a, rng, 0.9), hours=1)) == sa


def test_merge_pass_joins_fragmented_stories_and_prefers_existing_ids(rng):
    event = unit(rng.normal(size=DIM))
    existing = StoryState(key=101, centroid=near(event, rng, 0.97), languages={"en"},
                          last_article_at=T0, size=3)
    c = Clusterer.from_stories(PARAMS, [existing])
    # Force a separate story for a Hindi article that is only moderately close
    # to the centroid, then let the merge pass join them.
    params_strict = ClusterParams(same_lang_threshold=0.99, cross_lang_threshold=0.99,
                                  merge_threshold=0.80, window_hours=36)
    c.params = params_strict
    temp = c.assign(item(1, near(event, rng, 0.85), "hi", hours=1))
    assert temp < 0
    c.params = PARAMS  # merge thresholds: 0.78 same-language, 0.70 across languages
    merges = c.merge_pass(now=T0 + timedelta(hours=1))
    assert merges == [(101, temp)]
    assert c.resolve(temp) == 101
    assert c.assignments[1] == 101
    assert c.stories[101].languages == {"en", "hi"}
    assert temp not in c.created


def test_merge_pass_ignores_untouched_stories(rng):
    event = unit(rng.normal(size=DIM))
    a = StoryState(1, near(event, rng, 0.99), {"en"}, T0, 2)
    b = StoryState(2, near(event, rng, 0.99), {"en"}, T0, 2)
    c = Clusterer.from_stories(PARAMS, [a, b])
    assert c.merge_pass(now=T0) == []  # nothing touched this run


def test_replay_groups_events(rng):
    events = [unit(rng.normal(size=DIM)) for _ in range(5)]
    items, truth = [], {}
    key = 0
    for e_idx, event in enumerate(events):
        for j in range(4):
            key += 1
            lang = "hi" if j % 2 else "en"
            items.append(item(key, near(event, rng, 0.9), lang, hours=e_idx * 0.5 + j * 0.2))
            truth[key] = e_idx
    pred = replay(items, PARAMS)
    # Every event ends up in exactly one predicted story, and no story mixes events.
    for e_idx in range(5):
        assert len({pred[k] for k, t in truth.items() if t == e_idx}) == 1
    assert len(set(pred.values())) == 5


def _unit(v):
    v = np.asarray(v, dtype=np.float32)
    return v / np.linalg.norm(v)


def _vec_at(cos: float, dim: int = 8) -> np.ndarray:
    """A unit vector with the given cosine to axis 0."""
    v = np.zeros(dim, dtype=np.float32)
    v[0], v[1] = cos, (1 - cos**2) ** 0.5
    return v


def test_big_stories_need_a_closer_match_than_small_ones():
    from datetime import datetime, timezone

    from nazariya.cluster import ArticleItem, Clusterer, StoryState
    from nazariya.config import ClusterParams

    now = datetime(2026, 9, 30, tzinfo=timezone.utc)
    axis = _unit([1, 0, 0, 0, 0, 0, 0, 0])
    params = ClusterParams()  # same-language threshold 0.66
    small = StoryState(1, axis.copy(), {"en"}, now, size=1)
    big = StoryState(2, axis * 16, {"en"}, now, size=16)
    item = ArticleItem(99, _vec_at(0.70), "en", now)  # clears 0.66, not 0.66 + bonus

    assert Clusterer.from_stories(params, [small]).best_match(item)[0] == 1
    assert Clusterer.from_stories(params, [big]).best_match(item)[0] is None


def test_split_groups_separates_different_events():
    from datetime import datetime, timedelta, timezone

    from nazariya.cluster import ArticleItem, split_groups
    from nazariya.config import ClusterParams

    t0 = datetime(2026, 9, 30, tzinfo=timezone.utc)
    rng = np.random.default_rng(1)
    a, b = _unit(rng.normal(size=8)), _unit(rng.normal(size=8))
    items = [
        ArticleItem(i, _unit(base + 0.05 * rng.normal(size=8)), "en", t0 + timedelta(minutes=i))
        for i, base in enumerate([a, a, a, b, b])
    ]
    groups = split_groups(items, ClusterParams())
    assert groups == [[0, 1, 2], [3, 4]]
    assert split_groups(items[:3], ClusterParams()) == [[0, 1, 2]]  # nothing to split

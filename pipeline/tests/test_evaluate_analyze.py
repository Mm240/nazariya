from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from nazariya.analyze import Analyzer, build_user_message, validate_analysis
from nazariya.evaluate import bcubed, cross_lingual

# ---------- evaluation metrics ----------


def test_bcubed_perfect_and_degenerate():
    gold = {1: "a", 2: "a", 3: "b", 4: "b"}
    assert bcubed(gold, gold) == (1.0, 1.0, 1.0)
    p, r, _ = bcubed({1: 0, 2: 0, 3: 0, 4: 0}, gold)  # everything in one cluster
    assert r == 1.0 and p == pytest.approx(0.5)
    p, r, _ = bcubed({1: 1, 2: 2, 3: 3, 4: 4}, gold)  # all singletons
    assert p == 1.0 and r == pytest.approx(0.5)


def test_cross_lingual_pairs():
    lang = {1: "en", 2: "hi", 3: "en", 4: "hi"}
    gold = {1: "a", 2: "a", 3: "b", 4: "b"}  # 2 gold cross-lingual pairs: (1,2), (3,4)
    pred = {1: "x", 2: "x", 3: "y", 4: "z"}  # finds (1,2), misses (3,4)
    p, r, n = cross_lingual(pred, gold, lang)
    assert n == 2 and p == 1.0 and r == 0.5
    p, r, _ = cross_lingual({1: 0, 2: 0, 3: 0, 4: 0}, gold, lang)  # 4 predicted pairs, 2 right
    assert p == 0.5 and r == 1.0


# ---------- analysis ----------

GOOD = {
    "same_event": True,
    "facts_disputed": False,
    "neutral_headline": {"en": "Parliament passes data bill", "hi": "संसद ने डेटा विधेयक पारित किया"},
    "summary": {"en": "The bill passed.", "hi": "विधेयक पारित हुआ।"},
    "common_ground": [{"en": "The vote was on Monday.", "hi": "मतदान सोमवार को हुआ।"}],
    "differences": [],
    "outlet_framing": [
        {"outlet": "the-hindu", "en": "Leads with the vote count.", "hi": "मतों की संख्या से शुरुआत।"},
        {"outlet": "made-up-outlet", "en": "x", "hi": "y"},
    ],
}


def test_validate_analysis_keeps_known_outlets_only():
    out = validate_analysis(GOOD, {"the-hindu", "aaj-tak"})
    assert [f["outlet"] for f in out["outlet_framing"]] == ["the-hindu"]
    assert out["neutral_headline"]["hi"].startswith("संसद")


@pytest.mark.parametrize(
    "patch",
    [
        {"same_event": "yes"},
        {"summary": {"en": "only english"}},
        {"common_ground": "not a list"},
        {"neutral_headline": {"en": "", "hi": "x"}},
    ],
)
def test_validate_analysis_rejects_bad_output(patch):
    with pytest.raises(ValueError):
        validate_analysis({**GOOD, **patch}, {"the-hindu"})


ARTICLES = [
    {
        "outlet_slug": "the-hindu",
        "outlet_name": "The Hindu",
        "language": "en",
        "title": 'Bill passes <b>"quickly"</b> & quietly',
        "excerpt": None,
        "published_at": datetime(2026, 9, 29, 8, 0, tzinfo=timezone.utc),
    },
    {
        "outlet_slug": "aaj-tak",
        "outlet_name": "Aaj Tak",
        "language": "hi",
        "title": "विधेयक पारित",
        "excerpt": "सोमवार को मतदान",
        "published_at": datetime(2026, 9, 29, 9, 0, tzinfo=timezone.utc),
    },
]


def test_user_message_escapes_markup():
    msg = build_user_message(ARTICLES)
    assert "&lt;b&gt;" in msg and "&amp;" in msg
    assert 'outlet="aaj-tak"' in msg and "<excerpt>सोमवार को मतदान</excerpt>" in msg


def test_analyzer_parses_forced_tool_call():
    analyzer = Analyzer.__new__(Analyzer)
    analyzer.model = "test-model"
    captured = {}

    def fake_create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            stop_reason="tool_use",
            content=[SimpleNamespace(type="tool_use", name="record_story_analysis", input=GOOD)],
            usage=SimpleNamespace(input_tokens=900, output_tokens=400),
        )

    analyzer._client = SimpleNamespace(messages=SimpleNamespace(create=fake_create))
    result = analyzer.analyze(ARTICLES)
    assert captured["tool_choice"] == {"type": "tool", "name": "record_story_analysis"}
    assert result.input_tokens == 900 and result.content["same_event"] is True
    assert [f["outlet"] for f in result.content["outlet_framing"]] == ["the-hindu"]


def test_debate_keeps_only_attributed_arguments():
    debate = {
        "contested": True,
        "question": {"en": "Should state agencies be exempt?", "hi": "क्या सरकारी एजेंसियों को छूट मिलनी चाहिए?"},
        "for": [
            {"en": "The government says it speeds up security work.", "hi": "सरकार कहती है...", "outlets": ["the-hindu"]},
            {"en": "Invented, unattributed.", "hi": "गढ़ा हुआ।", "outlets": ["made-up-outlet"]},
        ],
        "against": [
            {"en": "The opposition says it weakens privacy.", "hi": "विपक्ष कहता है...", "outlets": ["aaj-tak", "aaj-tak"]},
        ],
    }
    out = validate_analysis({**GOOD, "debate": debate}, {"the-hindu", "aaj-tak"})
    assert out["debate"]["question"]["en"].startswith("Should")
    assert [p["outlets"] for p in out["debate"]["for"]] == [["the-hindu"]]
    assert out["debate"]["against"][0]["outlets"] == ["aaj-tak"]


@pytest.mark.parametrize(
    "debate",
    [
        None,
        {"contested": False},
        {"contested": True, "question": {"en": "Q?", "hi": "प्र?"}, "for": [], "against": []},
        {"contested": True, "for": [{"en": "a", "hi": "b", "outlets": ["the-hindu"]}]},  # no question
    ],
)
def test_uncontested_or_empty_debates_become_none(debate):
    assert validate_analysis({**GOOD, "debate": debate}, {"the-hindu"})["debate"] is None


def test_one_sided_coverage_is_kept_and_visible():
    debate = {
        "contested": True,
        "question": {"en": "Was the arrest lawful?", "hi": "क्या गिरफ़्तारी वैध थी?"},
        "for": [{"en": "Police say it followed procedure.", "hi": "पुलिस कहती है...", "outlets": ["the-hindu"]}],
        "against": [],
    }
    out = validate_analysis({**GOOD, "debate": debate}, {"the-hindu"})
    assert out["debate"]["for"] and out["debate"]["against"] == []


@pytest.mark.parametrize("value,expected", [("false", False), ("True", True), (None, False), (False, False)])
def test_facts_disputed_accepts_string_or_missing(value, expected):
    data = {**GOOD, "facts_disputed": value}
    assert validate_analysis(data, {"the-hindu", "aaj-tak"})["facts_disputed"] is expected


def test_nonsense_flags_are_still_rejected():
    with pytest.raises(ValueError):
        validate_analysis({**GOOD, "same_event": "maybe"}, {"the-hindu"})



def test_claims_keep_only_attributed_well_formed_entries():
    claims = [
        {"claim": {"en": "The US struck first.", "hi": "पहले अमेरिका ने हमला किया।"},
         "claimed_by": {"en": "Iranian government", "hi": "ईरान सरकार"},
         "outlets": ["aaj-tak", "aaj-tak"], "status": "one_sided"},
        {"claim": {"en": "Explosions were heard.", "hi": "धमाके सुने गए।"},
         "claimed_by": {"en": "Witnesses", "hi": "गवाह"}, "outlets": ["the-hindu"], "status": "confirmed"},
        {"claim": {"en": "Made up", "hi": "गढ़ा"}, "claimed_by": {"en": "x", "hi": "y"},
         "outlets": ["ghost"], "status": "confirmed"},                      # nobody in the story said it
        {"claim": {"en": "Bad status", "hi": "ग़लत"}, "claimed_by": {"en": "x", "hi": "y"},
         "outlets": ["the-hindu"], "status": "true"},                       # not an allowed status
    ]
    out = validate_analysis({**GOOD, "claims": claims}, {"the-hindu", "aaj-tak"})
    assert [c["status"] for c in out["claims"]] == ["one_sided", "confirmed"]
    assert out["claims"][0]["outlets"] == ["aaj-tak"]


def test_claims_missing_is_an_empty_list():
    assert validate_analysis(dict(GOOD), {"the-hindu"})["claims"] == []


def test_articles_carry_country_and_ownership_into_the_prompt():
    from datetime import datetime, timezone

    from nazariya.analyze import build_user_message

    msg = build_user_message([{
        "outlet_slug": "press-tv", "outlet_name": "Press TV", "outlet_country": "IR",
        "outlet_ownership": "state", "language": "en", "title": "Headline", "excerpt": None,
        "published_at": datetime(2026, 9, 30, tzinfo=timezone.utc),
    }])
    assert 'country="IR"' in msg and 'ownership="state"' in msg



DEBATE = {
    "contested": True,
    "question": {"en": "Was the captain's call right?", "hi": "क्या कप्तान का फ़ैसला सही था?"},
    "for": [{"en": "Commentators call it bold.", "hi": "टिप्पणीकार इसे साहसी कहते हैं।", "outlets": ["the-hindu"]}],
    "against": [],
}


def test_stances_and_category_are_validated():
    data = {
        **GOOD,
        "category": "sports",
        "debate": DEBATE,
        "stances": [
            {"outlet": "the-hindu", "stance": "for", "reason": {"en": "Calls it 'bold'.", "hi": "इसे 'साहसी' कहता है।"}},
            {"outlet": "the-hindu", "stance": "against", "reason": {"en": "dup", "hi": "dup"}},   # one per outlet
            {"outlet": "aaj-tak", "stance": "maybe", "reason": {"en": "x", "hi": "y"}},        # bad stance
            {"outlet": "ghost", "stance": "for", "reason": {"en": "x", "hi": "y"}},           # not in story
        ],
    }
    out = validate_analysis(data, {"the-hindu", "aaj-tak"})
    assert out["category"] == "sports"
    assert [(s["outlet"], s["stance"]) for s in out["stances"]] == [("the-hindu", "for")]


def test_no_debate_means_no_stances_and_unknown_category_is_other():
    out = validate_analysis({**GOOD, "category": "gossip", "debate": {"contested": False},
                             "stances": [{"outlet": "the-hindu", "stance": "for", "reason": {"en": "a", "hi": "b"}}]},
                            {"the-hindu"})
    assert out["category"] == "other" and out["stances"] == []

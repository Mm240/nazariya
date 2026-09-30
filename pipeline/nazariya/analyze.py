"""Ask Claude to compare how outlets covered one story.

Claude only sees headlines and short RSS excerpts, and is told to use nothing
else. Output is forced into a JSON schema via tool use, in English and Hindi.
"""

from __future__ import annotations

import html
import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)

TOOL_NAME = "record_story_analysis"

SYSTEM_PROMPT = """You compare how different news outlets covered the same event. \
You receive headlines and short excerpts, in any language, that an automatic system \
grouped together because they seem to describe one event. Each article says which \
country its outlet is based in and who owns it (private, public broadcaster, or state).

Rules:
1. Use only the text provided. Do not add facts, background or context from your own \
knowledge, even if you believe it is true; it may be outdated.
2. Describe what the coverage does, not what the outlets are. Never label an outlet's \
politics or motives (no "pro-government", "left-leaning", "biased", "propaganda"). \
Write observable things instead, e.g. "leads with the opposition's walkout" or \
"calls it a crackdown where others say raid".
3. If the headlines are near-identical (for example the same agency copy), say the \
differences are minimal. Never invent contrasts to fill the list.
4. Emphasis is not the same as disagreement. Set facts_disputed to true only when \
outlets report incompatible facts (numbers, who did what, outcomes).
5. If the articles clearly describe different events, set same_event to false and \
keep the other fields short.
6. Two sides. Decide whether the event involves a contested question: a decision, policy, \
allegation, verdict or claim that people argue about. If it does, set debate.contested to true, \
phrase the question neutrally so it can be answered yes or no (e.g. "Should state agencies be \
exempt from the data law?"), and list the arguments FOR (yes) and AGAINST (no) that appear in \
the provided coverage, including arguments the outlets attribute to people or groups \
("the government says...", "the opposition argues..."). Say who makes each argument. Every \
point must be supported by the listed outlets' text; list their slugs. Never invent or \
strengthen an argument to balance the sides: if a side has no argument in the coverage, \
leave it empty. If the event is simply factual (an accident, a result, the weather), set \
debate.contested to false and leave the rest empty. Look for disputes in every kind of \
story, not only politics: a team selection or umpiring decision people argue over, a \
film's reception or a celebrity controversy, a company decision, a court ruling. A match \
result, an award list or a release date has no debate.
7. Claims. List the main factual claims in the coverage (at most 6), especially where \
parties give competing accounts (e.g. who attacked first, casualty numbers). For each, \
say who makes it ("Iranian government", "US military", "witnesses", "police") and which \
outlets carry it, then choose a status from the sourcing alone, never from your own view \
of what is true:
   - "confirmed": reported as fact, not as someone's claim, by outlets based in at least \
two different countries (or two unrelated owners for a domestic story), with no outlet \
contradicting it.
   - "one_sided": asserted by one party and carried only as that party's claim, or only by \
outlets from that party's country or side.
   - "disputed": outlets give incompatible versions (different numbers, opposite accounts).
   State-owned media repeating its own government's claim does not make that claim confirmed.
   Never decide which side is right.
8. Stances, only when debate.contested is true. For each outlet, classify its own \
headline and excerpt against debate.question as "for" (leans yes), "against" (leans no) \
or "neutral" (just reports, or gives both sides), with a short reason pointing to its own \
wording. Judge only the text given; it is fine for every outlet to be neutral. With no \
debate, leave stances empty: a match result or a release date has no sides.
9. Category: one of politics, world, business, sports, entertainment, technology, \
science, health, crime, other.
10. Write every text field twice: natural English in "en" and natural, standard Hindi \
in Devanagari in "hi" (idiomatic, not word-for-word, never transliterated). Keep names, \
places and numbers consistent between the two.
11. Be brief. Headlines under 14 words. Summary 2-3 sentences. Each list item one sentence."""


def _bilingual(description: str) -> dict:
    return {
        "type": "object",
        "description": description,
        "properties": {
            "en": {"type": "string", "description": "English"},
            "hi": {"type": "string", "description": "Hindi, in Devanagari"},
        },
        "required": ["en", "hi"],
    }


def _argument(description: str) -> dict:
    return {
        "type": "object",
        "description": description,
        "properties": {
            "en": {"type": "string", "description": "English, one sentence, saying who argues it"},
            "hi": {"type": "string", "description": "Hindi, in Devanagari"},
            "outlets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Slugs of the outlets whose text contains this argument.",
            },
        },
        "required": ["en", "hi", "outlets"],
    }


ANALYSIS_TOOL = {
    "name": TOOL_NAME,
    "description": "Record a neutral, bilingual comparison of how outlets covered one news event.",
    "input_schema": {
        "type": "object",
        "properties": {
            "same_event": {
                "type": "boolean",
                "description": "False if these articles clearly describe different events.",
            },
            "neutral_headline": _bilingual("A plain, factual headline for the event, without loaded words."),
            "summary": _bilingual("2-3 sentences on what happened, using only the provided text."),
            "common_ground": {
                "type": "array",
                "maxItems": 4,
                "items": _bilingual("A fact that all or most outlets report."),
            },
            "differences": {
                "type": "array",
                "maxItems": 4,
                "items": _bilingual(
                    "One way the coverage differs (emphasis, framing, word choice or reported facts), "
                    "naming the outlets involved. Empty if coverage is essentially the same."
                ),
            },
            "outlet_framing": {
                "type": "array",
                "description": "One short line per outlet describing its angle.",
                "items": {
                    "type": "object",
                    "properties": {
                        "outlet": {"type": "string", "description": "The outlet slug exactly as given."},
                        "en": {"type": "string"},
                        "hi": {"type": "string"},
                    },
                    "required": ["outlet", "en", "hi"],
                },
            },
            "category": {
                "type": "string",
                "enum": ["politics", "world", "business", "sports", "entertainment", "technology",
                         "science", "health", "crime", "other"],
                "description": "The story's main topic.",
            },
            "facts_disputed": {
                "type": "boolean",
                "description": "True only if outlets report incompatible facts.",
            },
            "stances": {
                "type": "array",
                "description": "Only with a debate: does each outlet's coverage lean yes, no, or just report?",
                "items": {
                    "type": "object",
                    "properties": {
                        "outlet": {"type": "string"},
                        "stance": {"type": "string", "enum": ["for", "against", "neutral"]},
                        "reason": _bilingual("Short reason pointing to the outlet's own wording."),
                    },
                    "required": ["outlet", "stance", "reason"],
                },
            },
            "claims": {
                "type": "array",
                "maxItems": 6,
                "description": "Main factual claims, who makes them, who carries them, and how well sourced.",
                "items": {
                    "type": "object",
                    "properties": {
                        "claim": _bilingual("The claim, stated neutrally in one sentence."),
                        "claimed_by": _bilingual("Who asserts it, e.g. 'Iranian government', 'witnesses'."),
                        "outlets": {"type": "array", "items": {"type": "string"},
                                    "description": "Slugs of outlets that carry this claim."},
                        "status": {"type": "string", "enum": ["confirmed", "one_sided", "disputed"]},
                    },
                    "required": ["claim", "claimed_by", "outlets", "status"],
                },
            },
            "debate": {
                "type": "object",
                "description": "The two sides of a contested question, only as reported in the coverage.",
                "properties": {
                    "contested": {"type": "boolean"},
                    "question": _bilingual("Neutral yes/no question at the heart of the dispute."),
                    "for": {"type": "array", "maxItems": 4, "items": _argument("An argument for (yes).")},
                    "against": {"type": "array", "maxItems": 4, "items": _argument("An argument against (no).")},
                },
                "required": ["contested"],
            },
        },
        "required": [
            "same_event",
            "neutral_headline",
            "summary",
            "common_ground",
            "differences",
            "outlet_framing",
            "facts_disputed",
            "category",
            "stances",
            "claims",
            "debate",
        ],
    },
}


def build_user_message(articles: list[dict]) -> str:
    parts = ["<articles>"]
    for a in articles:
        parts.append(
            f'<article outlet="{a["outlet_slug"]}" outlet_name="{html.escape(a["outlet_name"])}" '
            f'country="{a.get("outlet_country", "IN")}" ownership="{a.get("outlet_ownership", "private")}" '
            f'language="{a["language"]}" published="{a["published_at"]:%Y-%m-%dT%H:%MZ}">'
        )
        parts.append(f"<headline>{html.escape(a['title'])}</headline>")
        if a.get("excerpt"):
            parts.append(f"<excerpt>{html.escape(a['excerpt'])}</excerpt>")
        parts.append("</article>")
    parts.append("</articles>")
    parts.append(f"Record your comparison with the {TOOL_NAME} tool. Use the outlet slugs exactly as given.")
    return "\n".join(parts)


def _text_pair(value: object, field: str) -> dict:
    if not isinstance(value, dict) or not all(isinstance(value.get(k), str) and value[k].strip() for k in ("en", "hi")):
        raise ValueError(f"{field} must have non-empty 'en' and 'hi' strings")
    return {"en": value["en"].strip(), "hi": value["hi"].strip()}


CATEGORY_VALUES = ("politics", "world", "business", "sports", "entertainment", "technology",
                   "science", "health", "crime", "other")


def _flag(value: object, key: str, default: bool) -> bool:
    """Models occasionally send "false" (a string) or leave a flag out; accept those."""
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise ValueError(f"{key} must be a boolean")


def validate_analysis(data: dict, allowed_slugs: set[str]) -> dict:
    """Check the tool output and keep only what the UI can trust."""
    data = {
        **data,
        "same_event": _flag(data.get("same_event"), "same_event", True),
        "facts_disputed": _flag(data.get("facts_disputed"), "facts_disputed", False),
    }
    lists = {}
    for key in ("common_ground", "differences"):
        items = data.get(key)
        if not isinstance(items, list):
            raise ValueError(f"{key} must be a list")
        lists[key] = [_text_pair(item, key) for item in items[:4]]
    framing = []
    for item in data.get("outlet_framing") or []:
        if isinstance(item, dict) and item.get("outlet") in allowed_slugs:
            pair = _text_pair(item, "outlet_framing")
            framing.append({"outlet": item["outlet"], **pair})
    debate = _validate_debate(data.get("debate"), allowed_slugs)
    return {
        # Who leans which way is only meaningful when there is something to disagree about.
        "stances": _validate_stances(data.get("stances"), allowed_slugs) if debate else [],
        "claims": _validate_claims(data.get("claims"), allowed_slugs),
        "debate": debate,
        "same_event": data["same_event"],
        "facts_disputed": data["facts_disputed"],
        "neutral_headline": _text_pair(data.get("neutral_headline"), "neutral_headline"),
        "summary": _text_pair(data.get("summary"), "summary"),
        "common_ground": lists["common_ground"],
        "differences": lists["differences"],
        "outlet_framing": framing,
        "category": data.get("category") if data.get("category") in CATEGORY_VALUES else "other",
    }


def _validate_stances(value: object, allowed_slugs: set[str]) -> list[dict]:
    """One stance per outlet actually in the story."""
    stances, seen = [], set()
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict) or item.get("stance") not in ("for", "against", "neutral"):
            continue
        slug = item.get("outlet")
        if slug not in allowed_slugs or slug in seen:
            continue
        try:
            reason = _text_pair(item.get("reason"), "stances.reason")
        except ValueError:
            continue
        seen.add(slug)
        stances.append({"outlet": slug, "stance": item["stance"], "reason": reason})
    return stances


def _validate_claims(value: object, allowed_slugs: set[str]) -> list[dict]:
    """Keep well-formed claims carried by outlets that are really in the story."""
    claims = []
    for item in (value if isinstance(value, list) else [])[:6]:
        if not isinstance(item, dict) or item.get("status") not in ("confirmed", "one_sided", "disputed"):
            continue
        outlets = list(dict.fromkeys(o for o in item.get("outlets") or [] if o in allowed_slugs))
        try:
            claim = _text_pair(item.get("claim"), "claims.claim")
            by = _text_pair(item.get("claimed_by"), "claims.claimed_by")
        except ValueError:
            continue
        if outlets:
            claims.append({"claim": claim, "claimed_by": by, "outlets": outlets, "status": item["status"]})
    return claims


def _validate_debate(value: object, allowed_slugs: set[str]) -> dict | None:
    """Keep only arguments attributed to outlets that are really in the story.
    Returns None for uncontested stories (or if nothing attributable survives)."""
    if not isinstance(value, dict) or value.get("contested") is not True:
        return None
    try:
        question = _text_pair(value.get("question"), "debate.question")
    except ValueError:
        return None
    sides = {}
    for side in ("for", "against"):
        points = []
        for item in (value.get(side) or [])[:4]:
            if not isinstance(item, dict):
                continue
            outlets = [o for o in item.get("outlets") or [] if o in allowed_slugs]
            try:
                pair = _text_pair(item, f"debate.{side}")
            except ValueError:
                continue
            if outlets:  # an argument nobody in this story made is dropped
                points.append({**pair, "outlets": list(dict.fromkeys(outlets))})
        sides[side] = points
    if not sides["for"] and not sides["against"]:
        return None
    return {"question": question, "for": sides["for"], "against": sides["against"]}


class AnalysisFailed(ValueError):
    """The API call succeeded (and was billed) but the output was unusable."""

    def __init__(self, message: str, input_tokens: int, output_tokens: int):
        super().__init__(message)
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


@dataclass
class AnalysisResult:
    content: dict
    input_tokens: int
    output_tokens: int


class Analyzer:
    def __init__(self, api_key: str, model: str):
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key, max_retries=3)
        self.model = model

    def analyze(self, articles: list[dict]) -> AnalysisResult:
        response = self._client.messages.create(
            model=self.model,
            max_tokens=6000,
            system=SYSTEM_PROMPT,
            tools=[ANALYSIS_TOOL],
            tool_choice={"type": "tool", "name": TOOL_NAME},
            messages=[{"role": "user", "content": build_user_message(articles)}],
        )
        usage = (response.usage.input_tokens, response.usage.output_tokens)
        if response.stop_reason == "max_tokens":
            raise AnalysisFailed("response hit max_tokens; output is incomplete", *usage)
        block = next((b for b in response.content if b.type == "tool_use" and b.name == TOOL_NAME), None)
        if block is None:
            raise AnalysisFailed("model did not call the analysis tool", *usage)
        try:
            content = validate_analysis(block.input, {a["outlet_slug"] for a in articles})
        except ValueError as exc:
            raise AnalysisFailed(str(exc), *usage) from exc
        return AnalysisResult(content, *usage)

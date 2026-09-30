import time
from datetime import datetime, timedelta, timezone

from nazariya.config import Feed
from nazariya.normalize import (
    canonical_url,
    clean_text,
    detect_language,
    embedding_text,
    normalize_entry,
    truncate,
    url_hash,
)

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
FEED_EN = Feed(slug="test-en", name="Test EN", language="en", url="https://example.com/rss")
FEED_HI = Feed(slug="test-hi", name="Test HI", language="hi", url="https://example.com/hi/rss")


def entry(title, link="https://example.com/news/a-story-123", hours_ago=1.0, summary=None):
    published = NOW - timedelta(hours=hours_ago)
    return {
        "title": title,
        "link": link,
        "summary": summary,
        "published_parsed": time.gmtime(published.timestamp()),
    }


def test_clean_text_strips_tags_entities_and_whitespace():
    assert clean_text("<p>Hello&nbsp;<b>world</b></p>\n\n") == "Hello world"
    assert clean_text("Rock &amp;#8217;n roll") == "Rock ’n roll"
    assert clean_text(None) == ""


def test_truncate_cuts_on_word_boundary():
    text = "word " * 100
    out = truncate(text, 50)
    assert len(out) <= 51 and out.endswith("…")
    assert truncate("short", 50) == "short"


def test_canonical_url_drops_tracking_and_fragment():
    a = canonical_url("HTTPS://Example.com/news/story?utm_source=x&id=7&fbclid=abc#comments")
    assert a == "https://example.com/news/story?id=7"
    assert url_hash("https://example.com/a?utm_medium=rss") == url_hash("https://example.com/a")


def test_detect_language_by_script():
    assert detect_language("संसद में विधेयक पारित", "en") == "hi"
    assert detect_language("Parliament passes bill", "hi") == "en"
    assert detect_language("2026: 5-0", "hi") == "hi"  # no letters: fall back to feed language
    assert detect_language("IPL 2026: मुंबई ने चेन्नई को हराया", "en") == "hi"


def test_normalize_entry_happy_path():
    c = normalize_entry(entry("Parliament passes data protection bill", summary="<p>The bill was passed on Monday.</p>"),
                        FEED_EN, NOW, 48)
    assert c is not None
    assert c.language == "en" and c.outlet_slug == "test-en"
    assert c.excerpt == "The bill was passed on Monday."
    assert c.published_at == NOW - timedelta(hours=1)


def test_normalize_entry_skips_old_short_and_filtered_items():
    assert normalize_entry(entry("Parliament passes data protection bill", hours_ago=60), FEED_EN, NOW, 48) is None
    assert normalize_entry(entry("Short"), FEED_EN, NOW, 48) is None
    assert normalize_entry(entry("A perfectly fine headline here", link="https://x.com/photos/1"),
                           FEED_EN, NOW, 48, skip_url_patterns=("/photos/",)) is None
    assert normalize_entry(entry("Aaj ka Rashifal: 29 September 2026"), FEED_HI, NOW, 48,
                           skip_title_keywords=("rashifal",)) is None
    assert normalize_entry(entry("No link at all in this one", link=""), FEED_EN, NOW, 48) is None


def test_normalize_entry_removes_headline_repeated_in_summary():
    c = normalize_entry(entry("Parliament passes data protection bill",
                              summary="Parliament passes data protection bill - The bill now goes to the Rajya Sabha."),
                        FEED_EN, NOW, 48)
    assert c.excerpt == "The bill now goes to the Rajya Sabha."


def test_future_dates_are_clamped_to_now():
    c = normalize_entry(entry("Election results announced in the state", hours_ago=-5), FEED_EN, NOW, 48)
    assert c.published_at == NOW


def test_embedding_text():
    assert embedding_text("Headline", None) == "Headline"
    assert embedding_text("Headline", "x" * 500).startswith("Headline. xxx")
    assert len(embedding_text("Headline", "x" * 500)) == len("Headline. ") + 160



def test_non_english_non_hindi_feeds_keep_their_language():
    from datetime import datetime, timezone

    from nazariya.config import Feed
    from nazariya.normalize import normalize_entry

    feed = Feed("bbc-persian", "BBC Persian", "fa", "https://x.example/rss", country="GB", ownership="public")
    now = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
    entry = {"title": "حمله هوایی در شب گذشته", "link": "https://x.example/a", "published_parsed": now.timetuple()}
    c = normalize_entry(entry, feed, now, 48)
    assert c is not None and c.language == "fa"


def test_images_come_from_media_tags_enclosures_or_the_summary():
    from nazariya.normalize import extract_image

    assert extract_image({"media_content": [{"url": "https://img.example/a.jpg", "medium": "image"}]}) == \
        "https://img.example/a.jpg"
    assert extract_image({"media_thumbnail": [{"url": "//img.example/t.jpg"}]}) == "https://img.example/t.jpg"
    assert extract_image({"enclosures": [{"href": "https://img.example/e.png", "type": "image/png"}]}) == \
        "https://img.example/e.png"
    assert extract_image({"summary": '<p><img src="https://img.example/s.webp?a=1&amp;b=2"> text</p>'}) == \
        "https://img.example/s.webp?a=1&b=2"
    assert extract_image({"media_content": [{"url": "https://v.example/clip.mp4", "medium": "video"}]}) is None
    assert extract_image({"summary": "no pictures here"}) is None

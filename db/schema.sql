-- Nazariya database schema
-- Requires PostgreSQL 15+ with the pgvector extension (0.5.0 or newer).
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per news outlet we follow (seeded from pipeline/feeds.yaml on every run).
CREATE TABLE IF NOT EXISTS outlets (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  language    TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  homepage    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added after the first release; ADD COLUMN IF NOT EXISTS upgrades older databases in place.
-- media_group: the ownership group, so sister outlets in different languages can be compared.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS media_group TEXT;
-- active: false once an outlet is removed from feeds.yaml (its old articles stay until pruned).
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- A story is one real-world event, covered by one or more articles.
CREATE TABLE IF NOT EXISTS stories (
  id                     BIGSERIAL PRIMARY KEY,
  -- Sum of the (unit-length) embeddings of every article in the story.
  -- Cosine distance ignores vector length, so the sum points the same way
  -- as the mean and can be recomputed with pgvector's sum() aggregate.
  centroid               vector(384) NOT NULL,
  article_count          INT NOT NULL DEFAULT 0,
  outlet_count           INT NOT NULL DEFAULT 0,
  languages              TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at          TIMESTAMPTZ NOT NULL,
  last_article_at        TIMESTAMPTZ NOT NULL,
  -- outlet_count at the time of the last AI analysis; a story is re-analysed
  -- when new outlets pick it up.
  analyzed_outlet_count  INT NOT NULL DEFAULT 0,
  analyzed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stories_last_article_idx ON stories (last_article_at DESC);
-- Used by the API's "related stories" nearest-neighbour query.
CREATE INDEX IF NOT EXISTS stories_centroid_hnsw ON stories USING hnsw (centroid vector_cosine_ops);

-- One row per article pulled from an RSS feed. We keep the headline, a short
-- excerpt (max 300 characters) and the link, never the full article text.
CREATE TABLE IF NOT EXISTS articles (
  id            BIGSERIAL PRIMARY KEY,
  outlet_id     INT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  story_id      BIGINT REFERENCES stories(id) ON DELETE SET NULL,
  url           TEXT NOT NULL,
  url_hash      TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  excerpt       TEXT,
  language      TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  published_at  TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding     vector(384)
);

CREATE INDEX IF NOT EXISTS articles_story_idx ON articles (story_id);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC);
-- Articles that were stored but not yet clustered (e.g. a run crashed half-way).
CREATE INDEX IF NOT EXISTS articles_unclustered_idx ON articles (published_at) WHERE story_id IS NULL;

-- The latest AI comparison for a story (bilingual JSON, see pipeline/nazariya/analyze.py).
CREATE TABLE IF NOT EXISTS story_analyses (
  story_id       BIGINT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  model          TEXT NOT NULL,
  content        JSONB NOT NULL,
  input_tokens   INT,
  output_tokens  INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- When two stories merge, the absorbed story's id keeps working as a link.
CREATE TABLE IF NOT EXISTS story_redirects (
  from_id     BIGINT PRIMARY KEY,
  to_id       BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per pipeline run, for monitoring.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  feeds_ok        INT NOT NULL DEFAULT 0,
  feeds_failed    INT NOT NULL DEFAULT 0,
  articles_new    INT NOT NULL DEFAULT 0,
  stories_new     INT NOT NULL DEFAULT 0,
  stories_merged  INT NOT NULL DEFAULT 0,
  analyses        INT NOT NULL DEFAULT 0,
  input_tokens    INT NOT NULL DEFAULT 0,
  output_tokens   INT NOT NULL DEFAULT 0,
  errors          JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ---------- International coverage ----------
-- scope: 'indian' outlets vs 'international' ones (BBC, Al Jazeera...).
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'indian';
-- section of the feed an article came from: 'india' or 'world'.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'india';
-- A story is 'world' when most of its articles came from world feeds.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'india';
CREATE INDEX IF NOT EXISTS stories_section_idx ON stories (section, last_article_at DESC);

-- ---------- Reader engagement ----------
-- Readers are anonymous. The browser sends a random id; only its salted hash is stored.
CREATE TABLE IF NOT EXISTS comments (
  id           BIGSERIAL PRIMARY KEY,
  story_id     BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  visitor      TEXT NOT NULL,
  name         TEXT NOT NULL,
  body         TEXT NOT NULL,
  upvotes      INT NOT NULL DEFAULT 0,
  reports      INT NOT NULL DEFAULT 0,
  hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_story_idx ON comments (story_id, created_at DESC);

-- One upvote or report per reader per comment.
CREATE TABLE IF NOT EXISTS comment_actions (
  comment_id  BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('upvote', 'report')),
  PRIMARY KEY (comment_id, visitor, action)
);

-- "Where do you stand?" on a story's two sides: one vote per reader, changeable.
CREATE TABLE IF NOT EXISTS story_votes (
  story_id    BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('for', 'against', 'unsure')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, visitor)
);

-- "Something wrong?" reports about a story page.
CREATE TABLE IF NOT EXISTS story_feedback (
  id          BIGSERIAL PRIMARY KEY,
  story_id    BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  visitor     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  note        TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_feedback_open_idx ON story_feedback (created_at DESC) WHERE NOT resolved;

-- ---------- Global coverage ----------
-- Any language now, not only English and Hindi (ISO 639-1 codes: en, hi, ar, fa, ur, fr...).
ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_language_check;
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_language_check;
-- Where an outlet is based (ISO 3166 code) and who owns it: 'private', 'public'
-- (publicly funded broadcaster with an editorial-independence charter) or 'state'
-- (run or funded by a government). Factual ownership, applied the same way to every country.
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'IN';
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS ownership TEXT NOT NULL DEFAULT 'private';

-- ---------- Sections, triage, headline edits ----------
-- Section of the feed an article came from (sports, entertainment…), when the feed has one.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category TEXT;
-- Story section: from its feeds' sections, or from the AI triage.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS category TEXT;
-- Triage verdict: does this story have two sides worth comparing? NULL = not triaged yet.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS contested BOOLEAN;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS stories_category_idx ON stories (category, last_article_at DESC);

-- Headlines that outlets changed after publishing ("stealth edits").
CREATE TABLE IF NOT EXISTS headline_edits (
  id          BIGSERIAL PRIMARY KEY,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  old_title   TEXT NOT NULL,
  new_title   TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS headline_edits_recent_idx ON headline_edits (seen_at DESC);
CREATE INDEX IF NOT EXISTS headline_edits_article_idx ON headline_edits (article_id);

-- ---------- Pictures, categories, headline edits ----------
-- The image the outlet published with the item in its own feed (hotlinked, credited, linked back).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT;
-- Topic of the feed the article came from: politics, business, sports, entertainment,
-- technology, science, health or general.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS stories_category_idx ON stories (category, last_article_at DESC);

-- Outlets sometimes change a headline after publishing. Every change seen in a feed is kept.
CREATE TABLE IF NOT EXISTS headline_edits (
  id          BIGSERIAL PRIMARY KEY,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  old_title   TEXT NOT NULL,
  new_title   TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS headline_edits_article_idx ON headline_edits (article_id);

# Nazariya (नज़रिया)

**Same news. Different story.** Nazariya reads English and Hindi Indian newsrooms every 15 minutes, groups headlines about the same event across both languages, and shows where coverage agrees and where it differs, outlet by outlet.

### 🌐 [Live site: nazariya-six.vercel.app](https://nazariya-six.vercel.app)

**API docs:** [nazariya-api.onrender.com/api/docs](https://nazariya-api.onrender.com/api/docs) · **Status:** news refreshed every 15 minutes by GitHub Actions

> The API runs on a free plan that sleeps when idle, so the first visit can take up to a minute to wake it.

It never labels outlets as left, right or biased. It puts what each one published side by side and lets the reader compare.

Link: https://nazariya-six.vercel.app/

## What it does

- **Cross-language story clustering.** A Hindi headline and an English headline about the same event land in the same story, using a multilingual embedding model trained so that translations sit close together in vector space.
- **Framing comparison.** Once three or more outlets cover a story, Claude writes, in both English and Hindi, a neutral headline, what everyone reports, where coverage differs, and one line on how each outlet framed it. Output is forced into a JSON schema and validated before it is stored.
- **Two sides.** When a story is a real dispute, the AI states the question neutrally and lists the arguments for and against, but only arguments the outlets actually carried, each credited to its sources. Unattributed arguments are dropped in validation, nothing is invented to balance the sides, and when coverage presents only one side the page says so.
- **Live updates.** The pipeline runs every 15 minutes; an open page checks once a minute and offers the new stories without reloading under the reader.
- **Readers take part.** A "Where do you stand?" poll under every debate (one changeable vote per reader), a discussion thread with upvotes, and a "Something wrong on this page?" form whose reports double as labelled data for improving clustering and summaries.
- **Moderation built in.** No accounts: readers get a random browser id, stored only as a salted hash. Comments can't contain links, a hidden honeypot field catches bots, writes are rate-limited per address and per reader, comments hide themselves after three reports, and a token-protected `/admin` page lets the maintainer restore, hide or delete comments and close problem reports.
- **India and the world.** World sections of Indian outlets plus BBC News, Al Jazeera and The Guardian, so international stories show how Indian newsrooms framed them next to the wider world.
- **Language blindspots.** Stories that at least three outlets in one language covered and none in the other.
- **Sister-outlet comparison.** Outlets are tagged with their media group (NDTV / NDTV India, News18 / News18 Hindi, India Today / Aaj Tak…), so you can see how one owner frames a story for two audiences.
- **A bilingual site.** Full English and Hindi interface, dark mode, search in both scripts, coverage-over-time charts, related stories (pgvector nearest neighbours), share links, social previews, and a cold-start notice for the free API tier.

## Architecture

```mermaid
flowchart LR
  subgraph GitHub Actions, every 15 min
    A[RSS feeds<br/>13 English, 10 Hindi] --> B[fetch + normalise<br/>httpx, feedparser]
    B --> C[embed<br/>fastembed, multilingual MiniLM]
    C --> D[online clustering<br/>+ merge pass]
    D --> E[Claude analysis<br/>forced tool use, bilingual]
  end
  D --> F[(Neon Postgres<br/>+ pgvector)]
  E --> F
  F --> G[NestJS API<br/>Render]
  G --> H[React site<br/>Vercel]
```

| Part | Stack | Where it runs |
|---|---|---|
| `pipeline/` | Python 3.12, httpx, feedparser, fastembed (ONNX, CPU), numpy, psycopg 3, Anthropic SDK | GitHub Actions cron |
| `db/` | PostgreSQL 16 + pgvector (HNSW index) | Neon (free) |
| `api/` | NestJS 11, TypeScript, node-postgres, cache-manager, throttler, Swagger; read API plus comments, votes, reports and moderation | Render (free) |
| `web/` | React 19, TypeScript, Vite, React Router, Recharts | Vercel (free) |

## How clustering works

Articles are processed in publish order. Each one is compared, by cosine similarity, with the centroid of every story active in the last 36 hours:

1. If the story already contains the article's language, it must clear `SAME_LANG_THRESHOLD` (0.66); otherwise the lower `CROSS_LANG_THRESHOLD` (0.58), because multilingual models score translations slightly lower than same-language paraphrases.
2. It joins the story with the largest margin above its threshold, or starts a new story.
3. A merge pass joins stories whose centroids are very close (`MERGE_THRESHOLD`), repairing fragmentation such as a Hindi report that arrived before any English one. Merged story ids keep working as links (`story_redirects`).

4. **Anti-snowball.** A growing story's centroid drifts toward its general topic ("Indian politics") and starts pulling in unrelated headlines. So the bar rises by 0.025 each time a story doubles past two articles (capped at +0.10). Genuine coverage still joins, because members of a tight story score *higher* against a larger, less noisy centroid.
5. **AI as a verifier.** Each analysis also answers "are these articles about the same event?". When the answer is no, the pipeline re-clusters that story's articles with stricter thresholds and splits it, and the API keeps flagged stories out of every list until then. A clustering error found by the language model is fixed by the clustering code, with no human in the loop.

Centroids are stored as the *sum* of unit embeddings: cosine distance ignores length, and the sum can be recomputed exactly in SQL with pgvector's `sum()` aggregate, so the database is always self-consistent.

The clustering module is pure numpy, so the same code runs in production and in offline evaluation.

## Measuring it

```bash
cd pipeline
python -m nazariya.evaluate export --hours 6 --out labels.csv   # export recent articles
# hand-correct the gold_story column so same-event articles share a value
python -m nazariya.evaluate score labels.csv                    # B-cubed P/R/F1 + cross-lingual pair P/R
python -m nazariya.evaluate sweep labels.csv                    # replay with a threshold grid
```

**Cross-lingual pair precision** (of the Hindi–English pairs placed in the same story, how many really are the same event) is the number that shows whether multilingual clustering works. Label a few hundred articles and report it.

## Cost

Only stories covered by 3+ outlets are analysed, re-analysis happens only when new outlets join (with a 3-hour cooldown), and `DAILY_ANALYSIS_LIMIT` (default 30) is a hard cap per rolling 24 hours. With Claude Haiku 4.5 ($1 / $5 per million input / output tokens) a bilingual analysis (including the two sides) costs roughly one cent, so the default cap keeps the bill to a few dollars a month. The live figure is on the site's *How it works* page and at `/api/stats`. Everything else runs on free tiers.

## Run it locally

Prerequisites: Docker, Python 3.12, Node 22.

```bash
docker compose up -d db                       # Postgres + pgvector, schema applied

cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql://nazariya:nazariya@localhost:5432/nazariya
export ANTHROPIC_API_KEY=sk-ant-...           # optional: without it, stories cluster but aren't analysed
python -m nazariya.check_feeds                # which feeds respond from your network
python -m nazariya.run --init-db              # one full run (first run downloads a ~220 MB model)

cd ../api
npm install
DATABASE_URL=$DATABASE_URL npm run dev        # http://localhost:3000/api/docs

cd ../web
npm install
npm run dev                                   # http://localhost:5173
```

## Tests

```bash
# pipeline: 34 tests (unit + end-to-end against real Postgres/pgvector)
cd pipeline && TEST_DATABASE_URL=postgresql://... python -m pytest
# api: unit tests, then 11 end-to-end tests against a real database
cd api && npm test && TEST_DATABASE_URL=postgresql://... npm run test:e2e
# web: type-check and production build
cd web && npm run build
```

CI (`.github/workflows/ci.yml`) runs all three on every push, with a pgvector service container.

## Project layout

```
db/schema.sql                  tables, indexes (HNSW), story redirects
pipeline/feeds.yaml            outlets and feed URLs: edit freely
pipeline/nazariya/             fetch, normalize, embed, cluster, analyze, run, evaluate, check_feeds
api/src/stories/               list, detail, related (pgvector), search, blindspots
api/src/meta/                  health, outlets, stats
web/src/                       pages, components, bilingual copy (i18n.tsx), design system (styles.css)
.github/workflows/             pipeline cron + CI
render.yaml                    Render blueprint for the API
```

## Limitations

- Comparisons use headlines and RSS excerpts, not full articles, so they capture emphasis and wording, not everything a piece says.
- Clustering sometimes merges two similar events or splits one. The AI flags stories where the articles don't describe the same event.
- AI output can be wrong; the site labels it, dates it and always shows the original headlines beside it.
- Which outlets to follow is an editorial choice. The list spans ownership groups and editorial positions and lives in `pipeline/feeds.yaml`.
- Feeds break without notice. `check_feeds` and the Outlets page show which have gone quiet.

## Roadmap

- Message Batches API for analyses (50% cheaper; results arrive by the next run)
- More languages (the embedding model already covers Marathi, Bengali, Tamil and more)
- Redis for the API cache if it ever runs on more than one instance
- Entity overlap as a second clustering signal for look-alike events (two different accidents)

## Licence

MIT. Headlines belong to their publishers; Nazariya stores only headlines, short excerpts and links, and sends every reader to the source.

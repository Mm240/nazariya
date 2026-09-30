# Deploying Nazariya for free

About 30–40 minutes. You'll end up with:

| Piece | Service | Cost |
|---|---|---|
| Database (Postgres + pgvector) | Neon | free |
| News pipeline, every 15 min | GitHub Actions | free for public repos |
| API | Render | free |
| Website | Vercel | free |
| AI comparisons | Anthropic API | a few dollars a month, capped |

Do the steps in order: each one needs a value from the one before.

---

## 1. Put the code on GitHub

Create an empty **public** repository (e.g. `nazariya`), then from the project folder:

```bash
git init -b main
git add .
git commit -m "Nazariya: English/Hindi news framing comparison"
git remote add origin https://github.com/<your-username>/nazariya.git
git push -u origin main
```

Keep it public: Actions minutes are free and unlimited for public repositories. A private repo gets 2,000 free minutes a month, which a 15-minute schedule would exceed; if you go private, change the cron in `.github/workflows/pipeline.yml` to `"7 * * * *"` (hourly).

Also update `VITE_REPO_URL` (step 6) and the author line in `web/src/config.ts` if needed.

## 2. Create the database on Neon

1. Sign up at neon.com and create a project. Pick the region closest to your API; **AWS Asia Pacific (Singapore)** pairs with Render's Singapore region.
2. On the project dashboard, open **Connect** and copy two connection strings:
   - **Direct** (host without `-pooler`) → for the pipeline.
   - **Pooled** (host contains `-pooler`) → for the API.
3. Optional but recommended: in the compute settings, set the size to **0.25 CU**. The free plan gives 100 CU-hours a month per project; at 0.25 CU that's about 400 hours of awake time, and Neon sleeps after 5 idle minutes.

You don't need to create tables: the pipeline applies `db/schema.sql` on every run (it's idempotent). pgvector is included on Neon.

## 3. Get an Anthropic API key and cap spending

1. At console.anthropic.com, create an API key.
2. Under billing, **set a monthly spend limit** (e.g. $10). The pipeline also caps itself with `DAILY_ANALYSIS_LIMIT` (default 30 analyses per rolling 24 hours), but a console limit is your hard backstop.

The site works without a key: stories still cluster and display; they just don't get AI comparisons.

## 4. Turn on the pipeline (GitHub Actions)

In your repository: **Settings → Secrets and variables → Actions**.

**Secrets:**

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **direct** connection string |
| `ANTHROPIC_API_KEY` | your key |

**Variables** (optional):

| Name | Default | Why change it |
|---|---|---|
| `DAILY_ANALYSIS_LIMIT` | `30` | raise or lower the AI cost ceiling |
| `ANALYSIS_MODEL` | `claude-haiku-4-5-20251001` | Anthropic lists Haiku 4.5's retirement as *not sooner than* 15 Oct 2026. If runs log a `NotFoundError`, set this to the current cheapest Claude model. |

Then **Actions → News pipeline → Run workflow**. The first run downloads the embedding model (~220 MB, cached afterwards) and takes 2–4 minutes. When it finishes, the run page shows a summary table: feeds reachable, new articles, stories, analyses, estimated cost.

After that it runs by itself every 15 minutes, and open pages offer the new stories within a minute of each run.

**If some feeds fail:** the summary lists them. Run `python -m nazariya.check_feeds` on your own machine. If a feed works locally but fails on Actions, the publisher is blocking GitHub's servers: set `enabled: false` for it in `pipeline/feeds.yaml`. If it fails everywhere, its URL has changed: find the new one on the outlet's RSS page.

## 5. Deploy the API on Render

1. Sign up at render.com with GitHub.
2. **New → Blueprint**, pick your repository. Render reads `render.yaml` and proposes `nazariya-api` (free plan, Singapore).
3. It asks for two values:
   - `DATABASE_URL`: Neon **pooled** connection string
   - `CORS_ORIGINS`: put `*` for now; you'll tighten it in step 7
   Render also generates `VISITOR_SALT` and `ADMIN_TOKEN` for you. Copy `ADMIN_TOKEN` from the service's **Environment** tab: it opens your moderation page at `https://<your-site>/admin`. Keep it secret.
4. Deploy. When it's live, open `https://<your-service>.onrender.com/api/health` (should say `ok`) and `/api/docs` (Swagger).

Free Render services sleep after 15 minutes without traffic and take up to a minute to wake. The website shows a "waking the server" notice when that happens, so first visits still make sense.

## 6. Deploy the website on Vercel

1. Sign up at vercel.com with GitHub → **Add New → Project** → import the repository.
2. Set **Root Directory** to `web`. Vercel detects Vite.
3. Environment variables:
   - `VITE_API_URL` = your Render URL, e.g. `https://nazariya-api.onrender.com` (no trailing slash, no `/api`)
   - `VITE_REPO_URL` = your GitHub repository URL
4. Deploy. `web/vercel.json` already handles client-side routes, so links like `/story/42` work on refresh.

## 7. Lock down CORS

Back on Render → your service → **Environment**: set `CORS_ORIGINS` to your Vercel URL, e.g. `https://nazariya.vercel.app` (comma-separate several; add `http://localhost:5173` if you develop against the live API). Save; Render redeploys.

## 8. Check everything

- The home page shows stories and "Last checked … ago".
- A story page shows the English/Hindi framing columns and the coverage chart.
- `/api/stats` shows the last run and today's AI cost.
- Share a story link in WhatsApp or LinkedIn: the preview card uses `web/public/og-image.png`.

Then put the live URL at the top of `README.md`.

---

## Keeping it running

- **GitHub pauses scheduled workflows after 60 days without repository activity.** Push a commit (or re-enable the workflow under Actions) at least every couple of months.
- **Scheduled runs can be delayed** when GitHub is busy. That's normal; a late run just picks up more articles.
- **Watch Neon usage** on its dashboard. A 15-minute schedule keeps the database awake roughly 10 hours a day (about 70–80 of the 100 free CU-hours a month at 0.25 CU). If you near the limit, change the cron to every 30 minutes: `"7,37 * * * *"`.
- **Storage** stays small: articles older than 14 days (`RETENTION_DAYS`) are deleted each run.
- **Render free hours** (750 a month per workspace) cover one always-on-when-used service; don't run a second free service in the same workspace all month.

## Moderating comments

Open `https://<your-site>/admin` and paste your `ADMIN_TOKEN`. You'll see open "Something wrong?" reports (mark them fixed) and recent comments, hidden ones first (restore, hide or delete). Comments hide themselves after three reader reports, so you only need to check in now and then.

## Custom domain (optional)

Vercel → Project → **Settings → Domains**. Add the domain there, then add it to `CORS_ORIGINS` on Render.

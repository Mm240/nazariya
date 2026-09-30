import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface OutletActivity {
  slug: string;
  name: string;
  language: string;
  homepage: string | null;
  mediaGroup: string | null;
  scope: 'indian' | 'international';
  country: string;
  ownership: 'private' | 'public' | 'state';
  articles24h: number;
  lastArticleAt: string | null;
}

export interface PipelineStats {
  outlets: { total: number; en: number; hi: number; other: number; countries: number; languages: number };
  headlineEdits24h: number;
  articles24h: number;
  activeStories: number;
  crossLanguageStories: number;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    feedsOk: number;
    feedsFailed: number;
    articlesNew: number;
    storiesNew: number;
    storiesMerged: number;
    analyses: number;
  } | null;
  ai: {
    runs24h: number;
    analyses24h: number;
    inputTokens24h: number;
    outputTokens24h: number;
    estimatedCost24hUsd: number;
    averageCostPerAnalysisUsd: number | null;
  };
}

@Injectable()
export class MetaService {
  // Default prices are Claude Haiku 4.5's list prices (USD per million tokens).
  private readonly inputPrice = Number(process.env.INPUT_PRICE_PER_MTOK ?? 1);
  private readonly outputPrice = Number(process.env.OUTPUT_PRICE_PER_MTOK ?? 5);

  constructor(private readonly db: DatabaseService) {}

  async ping(): Promise<void> {
    await this.db.query('SELECT 1');
  }

  outlets(): Promise<OutletActivity[]> {
    return this.db.query<OutletActivity>(
      `SELECT o.slug, o.name, o.language, o.homepage, o.media_group AS "mediaGroup", o.scope, o.country, o.ownership,
              count(a.id) FILTER (WHERE a.published_at > now() - interval '24 hours') AS "articles24h",
              max(a.published_at) AS "lastArticleAt"
       FROM outlets o LEFT JOIN articles a ON a.outlet_id = o.id
       WHERE o.active
       GROUP BY o.id
       ORDER BY o.language, o.name`,
    );
  }

  async stats(): Promise<PipelineStats> {
    const [[counts], [lastRun], [ai]] = await Promise.all([
      this.db.query<{
        total: number; en: number; hi: number; other: number; countries: number; languages: number; edits24h: number; articles24h: number; activeStories: number; crossLanguageStories: number;
      }>(
        `SELECT
           (SELECT count(*) FROM outlets WHERE active) AS total,
           (SELECT count(*) FROM outlets WHERE active AND language = 'en') AS en,
           (SELECT count(*) FROM outlets WHERE active AND language = 'hi') AS hi,
           (SELECT count(*) FROM outlets WHERE active AND language NOT IN ('en', 'hi')) AS other,
           (SELECT count(DISTINCT country) FROM outlets WHERE active) AS countries,
           (SELECT count(DISTINCT language) FROM outlets WHERE active) AS languages,
           (SELECT count(*) FROM headline_edits WHERE seen_at > now() - interval '24 hours') AS "edits24h",
           (SELECT count(*) FROM articles WHERE published_at > now() - interval '24 hours') AS "articles24h",
           (SELECT count(*) FROM stories
             WHERE last_article_at > now() - interval '48 hours' AND outlet_count >= 2) AS "activeStories",
           (SELECT count(*) FROM stories
             WHERE last_article_at > now() - interval '48 hours'
               AND languages @> ARRAY['en','hi']::text[]) AS "crossLanguageStories"`,
      ),
      this.db.query<NonNullable<PipelineStats['lastRun']>>(
        `SELECT started_at AS "startedAt", finished_at AS "finishedAt", feeds_ok AS "feedsOk",
                feeds_failed AS "feedsFailed", articles_new AS "articlesNew", stories_new AS "storiesNew",
                stories_merged AS "storiesMerged", analyses
         FROM pipeline_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`,
      ),
      this.db.query<{ runs: number; analyses: number; inputTokens: number; outputTokens: number }>(
        `SELECT count(*) AS runs, coalesce(sum(analyses), 0) AS analyses,
                coalesce(sum(input_tokens), 0) AS "inputTokens", coalesce(sum(output_tokens), 0) AS "outputTokens"
         FROM pipeline_runs WHERE started_at > now() - interval '24 hours'`,
      ),
    ]);
    const cost = (ai.inputTokens * this.inputPrice + ai.outputTokens * this.outputPrice) / 1_000_000;
    return {
      outlets: { total: counts.total, en: counts.en, hi: counts.hi, other: counts.other, countries: counts.countries, languages: counts.languages },
      headlineEdits24h: counts.edits24h,
      articles24h: counts.articles24h,
      activeStories: counts.activeStories,
      crossLanguageStories: counts.crossLanguageStories,
      lastRun: lastRun ?? null,
      ai: {
        runs24h: ai.runs,
        analyses24h: ai.analyses,
        inputTokens24h: ai.inputTokens,
        outputTokens24h: ai.outputTokens,
        estimatedCost24hUsd: round(cost, 4),
        averageCostPerAnalysisUsd: ai.analyses > 0 ? round(cost / ai.analyses, 5) : null,
      },
    };
  }
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

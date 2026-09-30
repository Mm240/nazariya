import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ListStoriesQuery } from './stories.dto';
import { mapClaims, mapDebate, mapFraming, mapStances, SummaryRow, toSummary } from './story.mapper';
import {
  AnalysisContent,
  Blindspots,
  HeadlineRef,
  RelatedStory,
  StoryDetail,
  StorySummary,
  TimelinePoint,
} from './story.types';

/** Ranking: outlets covering the story, decayed by age (e-folding time 12 hours). */
const SCORE_SQL = `(s.outlet_count * exp(-extract(epoch FROM (now() - s.last_article_at)) / 43200.0))::float8`;

/** Newest article per outlet as JSON, shared by every query that returns story cards. */
const HEADLINES_SQL = `
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'title', x.title, 'url', x.url, 'language', x.language, 'publishedAt', x.published_at,
           'outlet', jsonb_build_object('slug', x.slug, 'name', x.name, 'language', x.olang,
                                        'mediaGroup', x.media_group, 'scope', x.scope,
                                        'country', x.country, 'ownership', x.ownership)
         ) ORDER BY x.published_at DESC), '[]'::jsonb) AS headlines
  FROM (
    SELECT DISTINCT ON (a.outlet_id) a.title, a.url, a.language, a.published_at,
           o.slug, o.name, o.language AS olang, o.media_group, o.scope, o.country, o.ownership
    FROM articles a JOIN outlets o ON o.id = a.outlet_id
    WHERE a.story_id = p.id
    ORDER BY a.outlet_id, a.published_at DESC
  ) x`;

/** Stories the AI judged to mix different events are kept out of lists until the pipeline splits them. */
const NOT_MIXED_SQL = `coalesce(sa.content->>'same_event', 'true') <> 'false'`;

/** Blindspot = at least this many outlets in one language and none in the other. */
export const BLINDSPOT_MIN_OUTLETS = 3;

@Injectable()
export class StoriesService {
  constructor(private readonly db: DatabaseService) {}

  async list(q: ListStoriesQuery): Promise<{ items: StorySummary[]; limit: number; offset: number }> {
    const params: unknown[] = [q.hours, q.minOutlets];
    let where = `s.last_article_at > now() - make_interval(hours => $1) AND s.outlet_count >= $2 AND ${NOT_MIXED_SQL}`;
    if (q.filter === 'both-languages') where += ` AND s.languages @> ARRAY['en','hi']::text[]`;
    if (q.section !== 'all') {
      params.push(q.section);
      where += ` AND s.section = $${params.length}`;
    }
    if (q.category) {
      params.push(q.category);
      where += ` AND coalesce(nullif(sa.content->>'category', 'other'), nullif(s.category, 'general')) = $${params.length}`;
    }
    if (q.debated) where += ` AND sa.content->'debate' IS NOT NULL AND sa.content->'debate' <> 'null'::jsonb`;
    const items = await this.summaries(where, params, 'score DESC, id DESC', q.limit, q.offset);
    return { items, limit: q.limit, offset: q.offset };
  }

  /** Case-insensitive match on original headlines (any language) and the AI's neutral headline. */
  async search(q: string, limit = 20): Promise<StorySummary[]> {
    const pattern = `%${q.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const where = `s.last_article_at > now() - interval '14 days' AND (
        EXISTS (SELECT 1 FROM articles a2 WHERE a2.story_id = s.id AND a2.title ILIKE $1)
        OR sa.content->'neutral_headline'->>'en' ILIKE $1
        OR sa.content->'neutral_headline'->>'hi' ILIKE $1)`;
    return this.summaries(where, [pattern], 'outlet_count DESC, last_article_at DESC, id DESC', limit, 0);
  }

  async blindspots(limit = 12): Promise<Blindspots> {
    // Language blindspots are about Indian news: a Brazilian election the Hindi press skips isn't one.
    const where = `s.last_article_at > now() - interval '48 hours' AND s.section = 'india'
                   AND s.languages = ARRAY[$1]::text[] AND s.outlet_count >= $2 AND ${NOT_MIXED_SQL}`;
    const order = 'outlet_count DESC, last_article_at DESC, id DESC';
    const [onlyHindi, onlyEnglish] = await Promise.all([
      this.summaries(where, ['hi', BLINDSPOT_MIN_OUTLETS], order, limit, 0),
      this.summaries(where, ['en', BLINDSPOT_MIN_OUTLETS], order, limit, 0),
    ]);
    return { minOutlets: BLINDSPOT_MIN_OUTLETS, onlyHindi, onlyEnglish };
  }

  /** Returns null when the story does not exist (or was pruned). */
  async get(requestedId: number): Promise<StoryDetail | null> {
    // A story merged into another keeps working as a link (see story_redirects in db/schema.sql).
    const [{ id }] = await this.db.query<{ id: number }>(
      `SELECT coalesce((SELECT to_id FROM story_redirects WHERE from_id = $1), $1)::bigint AS id`,
      [requestedId],
    );
    const outletJson = `jsonb_build_object('slug', o.slug, 'name', o.name, 'language', o.language,
      'mediaGroup', o.media_group, 'scope', o.scope, 'country', o.country, 'ownership', o.ownership)`;
    const [summaryRows, meta, articles, timeline, edits, firsts] = await Promise.all([
      this.summaryRows('s.id = $1', [id], 'id', 1, 0),
      this.db.query<{ model: string; created_at: Date; analyzed_outlet_count: number; content: AnalysisContent }>(
        `SELECT sa.model, sa.created_at, s.analyzed_outlet_count, sa.content
         FROM story_analyses sa JOIN stories s ON s.id = sa.story_id WHERE sa.story_id = $1`,
        [id],
      ),
      this.db.query<{ item: HeadlineRef }>(
        `SELECT jsonb_build_object(
                  'title', a.title, 'url', a.url, 'language', a.language, 'publishedAt', a.published_at,
                  'outlet', jsonb_build_object('slug', o.slug, 'name', o.name, 'language', o.language,
                                               'mediaGroup', o.media_group, 'scope', o.scope,
                                               'country', o.country, 'ownership', o.ownership)) AS item
         FROM articles a JOIN outlets o ON o.id = a.outlet_id
         WHERE a.story_id = $1 ORDER BY a.published_at DESC LIMIT 200`,
        [id],
      ),
      this.db.query<{ hour: Date; en: number; hi: number }>(
        `SELECT date_trunc('hour', published_at) AS hour,
                count(*) FILTER (WHERE language = 'en') AS en,
                count(*) FILTER (WHERE language = 'hi') AS hi
         FROM articles WHERE story_id = $1 GROUP BY 1 ORDER BY 1`,
        [id],
      ),
      this.db.query<{ item: StoryDetail['headlineEdits'][number] }>(
        `SELECT jsonb_build_object('outlet', ${outletJson}, 'url', a.url, 'oldTitle', he.old_title,
                                   'newTitle', he.new_title, 'seenAt', he.seen_at) AS item
         FROM headline_edits he JOIN articles a ON a.id = he.article_id JOIN outlets o ON o.id = a.outlet_id
         WHERE a.story_id = $1 ORDER BY he.seen_at DESC LIMIT 50`,
        [id],
      ),
      this.db.query<{ item: StoryDetail['firstReports'][number] }>(
        `SELECT jsonb_build_object('language', x.language, 'outlet', x.outlet, 'publishedAt', x.published_at) AS item
         FROM (SELECT DISTINCT ON (a.language) a.language, a.published_at, ${outletJson} AS outlet
               FROM articles a JOIN outlets o ON o.id = a.outlet_id
               WHERE a.story_id = $1 ORDER BY a.language, a.published_at) x
         ORDER BY x.published_at`,
        [id],
      ),
    ]);
    if (summaryRows.length === 0) return null;

    const summary = toSummary(summaryRows[0]);
    const analysisRow = meta[0];
    return {
      ...summary,
      requestedId,
      analysis: analysisRow
        ? {
            sameEvent: analysisRow.content.same_event,
            factsDisputed: analysisRow.content.facts_disputed,
            commonGround: analysisRow.content.common_ground ?? [],
            differences: analysisRow.content.differences ?? [],
            framing: mapFraming(analysisRow.content, summary.outlets),
            debate: mapDebate(analysisRow.content, summary.outlets),
            claims: mapClaims(analysisRow.content, summary.outlets),
            stances: mapStances(analysisRow.content, summary.outlets),
            model: analysisRow.model,
            analyzedAt: analysisRow.created_at.toISOString(),
            outletCountAtAnalysis: analysisRow.analyzed_outlet_count,
          }
        : null,
      articles: articles.map((r) => r.item),
      headlineEdits: edits.map((r) => r.item),
      firstReports: firsts.map((r) => r.item),
      timeline: timeline.map<TimelinePoint>((t) => ({ hour: t.hour.toISOString(), en: t.en, hi: t.hi })),
    };
  }

  /** Nearest stories by centroid (pgvector cosine distance over the HNSW index). */
  async related(requestedId: number, limit = 5): Promise<RelatedStory[]> {
    const neighbours = await this.db.query<{ id: number; similarity: number }>(
      `WITH ref AS (
         SELECT id, centroid FROM stories
         WHERE id = coalesce((SELECT to_id FROM story_redirects WHERE from_id = $1), $1)
       )
       SELECT s.id, (1 - (s.centroid <=> ref.centroid))::float8 AS similarity
       FROM stories s, ref
       WHERE s.id <> ref.id AND s.outlet_count >= 2
       ORDER BY s.centroid <=> ref.centroid
       LIMIT $2`,
      [requestedId, limit],
    );
    // Below this, "related" is mostly noise for this embedding model.
    const close = neighbours.filter((n) => n.similarity >= 0.35);
    if (close.length === 0) return [];
    const rows = await this.summaryRows('s.id = ANY($1::bigint[])', [close.map((n) => n.id)], 'id', close.length, 0);
    const byId = new Map(rows.map((r) => [r.id, toSummary(r)]));
    return close.flatMap((n) => {
      const story = byId.get(n.id);
      return story ? [{ story, similarity: Math.round(n.similarity * 1000) / 1000 }] : [];
    });
  }

  private async summaries(
    where: string,
    params: unknown[],
    order: string,
    limit: number,
    offset: number,
  ): Promise<StorySummary[]> {
    return (await this.summaryRows(where, params, order, limit, offset)).map(toSummary);
  }

  /**
   * `where` filters stories (alias s); `order` may use the output columns
   * score, id, outlet_count, last_article_at. Values always go through params.
   */
  private summaryRows(
    where: string,
    params: unknown[],
    order: string,
    limit: number,
    offset: number,
  ): Promise<SummaryRow[]> {
    const n = params.length;
    return this.db.query<SummaryRow>(
      `WITH picked AS (
         SELECT s.id, s.article_count, s.outlet_count, s.languages, s.first_seen_at, s.last_article_at,
                sa.content AS analysis, ${SCORE_SQL} AS score, s.section,
                (SELECT count(*) FROM comments c WHERE c.story_id = s.id AND NOT c.hidden) AS comment_count,
                (SELECT jsonb_build_object(
                          'for', count(*) FILTER (WHERE v.side = 'for'),
                          'against', count(*) FILTER (WHERE v.side = 'against'),
                          'unsure', count(*) FILTER (WHERE v.side = 'unsure'))
                   FROM story_votes v WHERE v.story_id = s.id) AS votes,
                s.category,
                (SELECT jsonb_build_object('url', a.image_url, 'outlet', o.name, 'articleUrl', a.url)
                   FROM articles a JOIN outlets o ON o.id = a.outlet_id
                   WHERE a.story_id = s.id AND a.image_url IS NOT NULL
                   ORDER BY a.published_at DESC LIMIT 1) AS image,
                EXISTS (SELECT 1 FROM headline_edits he JOIN articles a ON a.id = he.article_id
                        WHERE a.story_id = s.id) AS headline_edited
         FROM stories s LEFT JOIN story_analyses sa ON sa.story_id = s.id
         WHERE ${where}
         ORDER BY ${order}
         LIMIT $${n + 1} OFFSET $${n + 2}
       )
       SELECT p.*, h.headlines
       FROM picked p CROSS JOIN LATERAL (${HEADLINES_SQL}) h
       ORDER BY ${order}`,
      [...params, limit, offset],
    );
  }
}

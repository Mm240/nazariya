import {
  AnalysisContent,
  Debate,
  HeadlineRef,
  Lang,
  OutletFraming,
  OutletRef,
  StorySummary,
  VoteCounts,
} from './story.types';

export interface SummaryRow {
  id: number;
  article_count: number;
  outlet_count: number;
  languages: Lang[];
  first_seen_at: Date;
  last_article_at: Date;
  analysis: AnalysisContent | null;
  /** Newest article per outlet, newest first (built in SQL). */
  headlines: HeadlineRef[];
  section: 'india' | 'world';
  comment_count: number;
  votes: VoteCounts;
}

const LANGS: Lang[] = ['en', 'hi'];

/**
 * Pick up to `max` headlines from different outlets, alternating languages so a
 * story covered in both English and Hindi always shows both on its card.
 * The better-covered language goes first; within a language, newest first.
 */
export function pickSampleHeadlines(headlines: HeadlineRef[], max = 4): HeadlineRef[] {
  const byLang = new Map<Lang, HeadlineRef[]>(LANGS.map((l) => [l, []]));
  for (const h of headlines) byLang.get(h.language)?.push(h);
  const order = [...LANGS].sort((a, b) => byLang.get(b)!.length - byLang.get(a)!.length);
  const picked: HeadlineRef[] = [];
  let round = 0;
  while (picked.length < max && order.some((l) => byLang.get(l)!.length > round)) {
    for (const lang of order) {
      const next = byLang.get(lang)![round];
      if (next && picked.length < max) picked.push(next);
    }
    round += 1;
  }
  return picked;
}

export function outletsOf(headlines: HeadlineRef[]): OutletRef[] {
  const seen = new Map<string, OutletRef>();
  for (const h of headlines) if (!seen.has(h.outlet.slug)) seen.set(h.outlet.slug, h.outlet);
  // English outlets first, then Hindi; alphabetical within each. Stable for the UI's coverage bar.
  return [...seen.values()].sort(
    (a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name),
  );
}

export function toSummary(row: SummaryRow): StorySummary {
  const headlines = row.headlines ?? [];
  const outlets = outletsOf(headlines);
  const analysis = row.analysis;
  return {
    id: row.id,
    headline: analysis?.neutral_headline ?? null,
    summary: analysis?.summary ?? null,
    leadHeadline: headlines[0] ?? null,
    sampleHeadlines: pickSampleHeadlines(headlines),
    outlets,
    coverage: {
      en: outlets.filter((o) => o.language === 'en').length,
      hi: outlets.filter((o) => o.language === 'hi').length,
    },
    articleCount: row.article_count,
    outletCount: row.outlet_count,
    languages: row.languages,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastArticleAt: row.last_article_at.toISOString(),
    analyzed: analysis !== null,
    factsDisputed: analysis ? analysis.facts_disputed : null,
    debate: analysis?.debate
      ? {
          question: analysis.debate.question,
          forCount: analysis.debate.for.length,
          againstCount: analysis.debate.against.length,
        }
      : null,
    section: row.section ?? 'india',
    commentCount: row.comment_count ?? 0,
    votes: row.votes ?? { for: 0, against: 0, unsure: 0 },
  };
}

/** Resolve outlet slugs on each argument; drop arguments whose outlets have all left the story. */
export function mapDebate(content: AnalysisContent, outlets: OutletRef[]): Debate | null {
  const d = content.debate;
  if (!d) return null;
  const bySlug = new Map(outlets.map((o) => [o.slug, o]));
  const side = (points: { en: string; hi: string; outlets: string[] }[]) =>
    points.flatMap((p) => {
      const refs = p.outlets.flatMap((slug) => bySlug.get(slug) ?? []);
      return refs.length ? [{ text: { en: p.en, hi: p.hi }, outlets: refs }] : [];
    });
  return { question: d.question, for: side(d.for ?? []), against: side(d.against ?? []) };
}

/** Attach full outlet details to each framing line; drop lines for outlets no longer in the story. */
export function mapFraming(content: AnalysisContent, outlets: OutletRef[]): OutletFraming[] {
  const bySlug = new Map(outlets.map((o) => [o.slug, o]));
  return (content.outlet_framing ?? []).flatMap((f) => {
    const outlet = bySlug.get(f.outlet);
    return outlet ? [{ outlet, text: { en: f.en, hi: f.hi } }] : [];
  });
}

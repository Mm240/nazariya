// Mirrors api/src/stories/story.types.ts and api/src/meta/meta.service.ts.
/** Interface languages. */
export type Lang = 'en' | 'hi';
/** Any article language code: 'en', 'hi', 'ar', 'fa', 'ur', 'fr'… */
export type ContentLang = string;

export interface Bilingual {
  en: string;
  hi: string;
}

export type Ownership = 'private' | 'public' | 'state';

export interface OutletRef {
  slug: string;
  name: string;
  language: ContentLang;
  mediaGroup: string | null;
  scope?: 'indian' | 'international';
  country?: string;
  ownership?: Ownership;
}

export interface HeadlineRef {
  title: string;
  url: string;
  language: ContentLang;
  publishedAt: string;
  outlet: OutletRef;
}

export interface StorySummary {
  id: number;
  headline: Bilingual | null;
  summary: Bilingual | null;
  leadHeadline: HeadlineRef | null;
  sampleHeadlines: HeadlineRef[];
  outlets: OutletRef[];
  coverage: { en: number; hi: number; other: number };
  articleCount: number;
  outletCount: number;
  languages: ContentLang[];
  firstSeenAt: string;
  lastArticleAt: string;
  analyzed: boolean;
  factsDisputed: boolean | null;
  debate: { question: Bilingual; forCount: number; againstCount: number } | null;
  section: 'india' | 'world';
  commentCount: number;
  votes: VoteCounts;
  image: { url: string; outlet: string; articleUrl: string } | null;
  category: string | null;
  headlineEdited: boolean;
}

export interface VoteCounts {
  for: number;
  against: number;
  unsure: number;
}

export type Side = keyof VoteCounts;

export interface VoteSummary extends VoteCounts {
  mine: Side | null;
}

export interface CommentView {
  id: number;
  name: string;
  body: string;
  upvotes: number;
  createdAt: string;
  upvotedByMe: boolean;
  reportedByMe: boolean;
}

export interface Claim {
  claim: Bilingual;
  claimedBy: Bilingual;
  outlets: OutletRef[];
  status: 'confirmed' | 'one_sided' | 'disputed';
}

export interface Argument {
  text: Bilingual;
  outlets: OutletRef[];
}

export interface StoryDetail extends StorySummary {
  requestedId: number;
  analysis: {
    sameEvent: boolean;
    factsDisputed: boolean;
    commonGround: Bilingual[];
    differences: Bilingual[];
    framing: { outlet: OutletRef; text: Bilingual }[];
    debate: { question: Bilingual; for: Argument[]; against: Argument[] } | null;
    claims: Claim[];
    stances: { outlet: OutletRef; stance: 'for' | 'against' | 'neutral'; reason: Bilingual }[];
    model: string;
    analyzedAt: string;
    outletCountAtAnalysis: number;
  } | null;
  articles: HeadlineRef[];
  timeline: { hour: string; en: number; hi: number }[];
  headlineEdits: { outlet: OutletRef; url: string; oldTitle: string; newTitle: string; seenAt: string }[];
  firstReports: { language: string; outlet: OutletRef; publishedAt: string }[];
}

export interface StoryList {
  items: StorySummary[];
  limit: number;
  offset: number;
}

export interface RelatedStory {
  story: StorySummary;
  similarity: number;
}

export interface Blindspots {
  minOutlets: number;
  onlyHindi: StorySummary[];
  onlyEnglish: StorySummary[];
}

export interface OutletActivity {
  slug: string;
  name: string;
  language: ContentLang;
  homepage: string | null;
  mediaGroup: string | null;
  scope: 'indian' | 'international';
  country: string;
  ownership: Ownership;
  articles24h: number;
  lastArticleAt: string | null;
}

export interface Stats {
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

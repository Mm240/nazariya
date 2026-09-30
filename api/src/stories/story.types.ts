/** ISO 639-1 code: 'en', 'hi', 'ar', 'fa', 'ur', 'fr'… (the interface itself is English/Hindi). */
export type Lang = string;

export interface Bilingual {
  en: string;
  hi: string;
}

export interface OutletRef {
  slug: string;
  name: string;
  language: Lang;
  mediaGroup: string | null;
  scope?: 'indian' | 'international';
  /** Where the outlet is based (ISO 3166). */
  country?: string;
  /** 'private', 'public' (public broadcaster) or 'state'. */
  ownership?: 'private' | 'public' | 'state';
}

export interface HeadlineRef {
  title: string;
  url: string;
  language: Lang;
  publishedAt: string;
  outlet: OutletRef;
}

export interface StorySummary {
  id: number;
  /** Neutral headline written by the AI comparison, once the story has been analysed. */
  headline: Bilingual | null;
  summary: Bilingual | null;
  /** The newest original headline; the display title until the story is analysed. */
  leadHeadline: HeadlineRef | null;
  /** Up to four original headlines from different outlets, mixing languages. */
  sampleHeadlines: HeadlineRef[];
  outlets: OutletRef[];
  /** Number of outlets covering the story, per language. */
  coverage: { en: number; hi: number; other: number };
  articleCount: number;
  outletCount: number;
  languages: Lang[];
  firstSeenAt: string;
  lastArticleAt: string;
  analyzed: boolean;
  factsDisputed: boolean | null;
  /** Set when the AI found a contested question in the coverage. */
  debate: DebateBrief | null;
  /** 'world' when most coverage came from world sections or international outlets. */
  section: 'india' | 'world';
  commentCount: number;
  /** Readers' answers to the two-sides question. */
  votes: VoteCounts;
  /** The picture an outlet published with its article, credited to that outlet. */
  image: { url: string; outlet: string; articleUrl: string } | null;
  /** politics, business, sports, entertainment, technology, science, health, crime… or null. */
  category: string | null;
  /** True when any outlet changed its headline after publishing. */
  headlineEdited: boolean;
}

export interface VoteCounts {
  for: number;
  against: number;
  unsure: number;
}

export interface DebateBrief {
  question: Bilingual;
  forCount: number;
  againstCount: number;
}

export interface Argument {
  text: Bilingual;
  /** Outlets whose coverage contains this argument. */
  outlets: OutletRef[];
}

export interface Claim {
  claim: Bilingual;
  claimedBy: Bilingual;
  outlets: OutletRef[];
  status: 'confirmed' | 'one_sided' | 'disputed';
}

export interface Debate {
  question: Bilingual;
  for: Argument[];
  against: Argument[];
}

export interface OutletFraming {
  outlet: OutletRef;
  text: Bilingual;
}

export interface StoryAnalysis {
  sameEvent: boolean;
  factsDisputed: boolean;
  commonGround: Bilingual[];
  differences: Bilingual[];
  framing: OutletFraming[];
  /** For and against, only as reported in the coverage; null for uncontested stories. */
  debate: Debate | null;
  /** Who claims what, who carries it, and how well it is sourced. */
  claims: Claim[];
  /** With a debate: which side each outlet's own coverage leans to, and why. */
  stances: { outlet: OutletRef; stance: 'for' | 'against' | 'neutral'; reason: Bilingual }[];
  model: string;
  analyzedAt: string;
  /** How many outlets had covered the story when it was analysed. */
  outletCountAtAnalysis: number;
}

export interface TimelinePoint {
  hour: string;
  en: number;
  hi: number;
}

export interface StoryDetail extends StorySummary {
  /** The id the client asked for; differs from `id` when that story was merged into this one. */
  requestedId: number;
  analysis: StoryAnalysis | null;
  articles: HeadlineRef[];
  timeline: TimelinePoint[];
  /** Headlines outlets changed after publishing, newest first. */
  headlineEdits: { outlet: OutletRef; url: string; oldTitle: string; newTitle: string; seenAt: string }[];
  /** The first outlet to publish, overall and per language. */
  firstReports: { language: string; outlet: OutletRef; publishedAt: string }[];
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

/** Shape of story_analyses.content, written by pipeline/nazariya/analyze.py. */
export interface AnalysisContent {
  same_event: boolean;
  facts_disputed: boolean;
  neutral_headline: Bilingual;
  summary: Bilingual;
  common_ground: Bilingual[];
  differences: Bilingual[];
  outlet_framing: { outlet: string; en: string; hi: string }[];
  category?: string;
  stances?: { outlet: string; stance: 'for' | 'against' | 'neutral'; reason: Bilingual }[];
  claims?: { claim: Bilingual; claimed_by: Bilingual; outlets: string[]; status: Claim['status'] }[];
  /** Absent in analyses written before this field existed. */
  debate?: {
    question: Bilingual;
    for: { en: string; hi: string; outlets: string[] }[];
    against: { en: string; hi: string; outlets: string[] }[];
  } | null;
}

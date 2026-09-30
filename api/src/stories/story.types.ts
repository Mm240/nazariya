export type Lang = 'en' | 'hi';

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
  coverage: Record<Lang, number>;
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
  /** Absent in analyses written before this field existed. */
  debate?: {
    question: Bilingual;
    for: { en: string; hi: string; outlets: string[] }[];
    against: { en: string; hi: string; outlets: string[] }[];
  } | null;
}

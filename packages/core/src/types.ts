export type LanguageCode = "my" | "en" | "mixed" | "unknown";

export type SourceType = "text" | "voice";

export type StageName =
  | "language"
  | "translation"
  | "topics"
  | "emotionalContext"
  | "entities"
  | "embedding";

export type StageStatus = "succeeded" | "failed" | "skipped" | "pending";

export type TopicMatch = {
  slug: string;
  label: string;
  confidence: number;
};

export type EmotionalTheme =
  | "Stress"
  | "Relief"
  | "Accomplishment"
  | "Joy"
  | "Sadness";

export type EntityMention = {
  text: string;
  type: "hashtag" | "date" | "name" | "term";
};

export type SearchMode = "hybrid" | "keyword" | "semantic";

export type SearchDocument = {
  id: string;
  content: string;
  createdAt: string;
  language: LanguageCode | null;
  topics: string[];
  tags: string[];
  embedding: number[] | null;
  sourceType: SourceType;
};

export type SearchFilters = {
  topic?: string;
  tag?: string;
  language?: LanguageCode;
  from?: string;
  to?: string;
  mode?: SearchMode;
  limit?: number;
};

export type SearchHit = {
  id: string;
  score: number;
  keywordScore: number;
  semanticScore: number;
  createdAt: string;
  excerpt: string;
};

export type MemorySource = {
  entryId: string;
  createdAt: string;
  excerpt: string;
};

export type MemoryAnswer = {
  answer: string;
  sources: MemorySource[];
  confidence: number;
  retrievalMetadata: {
    intent: "first" | "list" | "question";
    candidateCount: number;
    usedCount: number;
    expandedTerms: string[];
  };
};

export type PipelineInput = {
  originalContent: string;
  emotionalContextEnabled: boolean;
  translationTarget?: "en" | "my";
  failStages?: StageName[];
};

export type PipelineResult = {
  originalContent: string;
  language: {
    status: StageStatus;
    value?: LanguageCode;
    segments?: { text: string; language: LanguageCode }[];
  };
  translation: {
    status: StageStatus;
    text?: string;
    language?: "en" | "my";
    quality?: "high" | "approximate";
    provider?: string;
  };
  topics: { status: StageStatus; items?: TopicMatch[] };
  emotionalContext: {
    status: StageStatus;
    label?: "Detected emotional themes";
    themes?: EmotionalTheme[];
  };
  entities: { status: StageStatus; items?: EntityMention[] };
  embedding: { status: StageStatus; vector?: number[]; model?: string };
  suggestedTags: string[];
};

export const INSUFFICIENT_EVIDENCE =
  "I couldn't find enough evidence in your journal to answer that confidently.";

export const EMOTIONAL_CONTEXT_LABEL = "Detected emotional themes" as const;

export const EMBEDDING_MODEL = "echo-hash-v1";

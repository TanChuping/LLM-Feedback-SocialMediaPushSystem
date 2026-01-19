
export interface LocalizedContent {
  en: string;
  zh: string;
}

export interface Post {
  id: string;
  title: LocalizedContent;
  content: LocalizedContent;
  author: string;
  tags: string[];
  tagWeights?: Record<string, number>; // NEW: Specific weight for tags in this post (e.g., Gaming: 2.0, Social: 0.5)
  imageUrl: string;
  likes: number;
  score?: number; // Calculated recommendation score
  debugReason?: string; // Why it was scored this way
}

export interface WeightedTag {
  tag: string;
  weight: number;
}

export interface UserProfile {
  id: string;
  name: string;
  bio: string;
  interests: WeightedTag[]; // Replaces likeTags
  dislikes: WeightedTag[];  // Replaces dislikeTags
}

export interface SystemLog {
  id: string;
  timestamp: string;
  type: 'FEEDBACK' | 'LLM_ANALYSIS' | 'PROFILE_UPDATE' | 'RE_RANK';
  title: string;
  details: any;
}

export interface TagAdjustment {
  tag: string;
  category: 'interest' | 'dislike';
  delta: number; // e.g. +5.0 or -2.5
}

export type PreferenceTargetType = 'entity' | 'aspect' | 'topic';
export type PreferencePolarity = 'like' | 'dislike';

export interface PreferenceTarget {
  type: PreferenceTargetType;
  value: string; // e.g. "DeepSeek", "Adele", "低质量评测", "AI/ML"
  polarity: PreferencePolarity;
  strength: 1 | 2 | 3; // 1=light, 3=strong
}

export interface FeedbackAnalysisResult {
  adjustments: TagAdjustment[];
  user_note: string;
  explicit_search_query?: string | null; // NEW: Capture explicit user intent (e.g. "Show me jobs")
  // NEW: When user dislikes an aspect (framing/conduct) but not the topic itself,
  // we store a "soft downrank" query so the deterministic ranker can push down
  // matching posts WITHOUT killing the topic tag.
  dislike_scope?: 'topic' | 'aspect';
  soft_downrank_query?: string | null; // free-text keywords/phrase to downrank (e.g. "irresponsible pet ownership")
  soft_downrank_strength?: number; // 1-3 (light -> strong)
  preference_targets?: PreferenceTarget[]; // NEW: explicit targets (entity/aspect/topic) to avoid collateral damage
}

export interface UserPersona {
  description: string;  // 文字描述的用户画像（legacy / fallback）
  descriptionEn?: string;
  descriptionZh?: string;
  emojiFusion: string[]; // emoji组合数组，固定2个
  lastUpdated?: number;  // 最后更新时间戳
  userTraits?: string[]; // 用户稳定特征（最多5条）
  userTraitsEn?: string[];
  userTraitsZh?: string[];
  redFlags?: string[]; // 用户雷点（最多5条）
  redFlagsEn?: string[];
  redFlagsZh?: string[];
  redFlagKeywords?: string[]; // 用于排序匹配的关键词（最多5条）
  nicknameEn?: string;
  nicknameZh?: string;
}
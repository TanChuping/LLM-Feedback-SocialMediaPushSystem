
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

export interface FeedbackAnalysisResult {
  adjustments: TagAdjustment[];
  user_note: string;
  explicit_search_query?: string | null; // NEW: Capture explicit user intent (e.g. "Show me jobs")
}

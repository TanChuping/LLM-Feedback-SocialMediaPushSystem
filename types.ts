export interface Post {
  id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  imageUrl: string;
  likes: number;
  score?: number; // Calculated recommendation score
  debugReason?: string; // Why it was scored this way
}

export interface UserProfile {
  id: string;
  name: string;
  bio: string;
  likeTags: string[];
  dislikeTags: string[];
}

export interface SystemLog {
  id: string;
  timestamp: string;
  type: 'FEEDBACK' | 'LLM_ANALYSIS' | 'PROFILE_UPDATE' | 'RE_RANK';
  title: string;
  details: any;
}

export interface FeedbackAnalysisResult {
  dislike_tags: string[];
  user_note: string;
}

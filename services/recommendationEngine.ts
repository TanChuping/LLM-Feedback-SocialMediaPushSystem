import { Post, UserProfile } from '../types';

/**
 * Calculates a relevance score for a post based on the user profile.
 * High score = high relevance.
 */
export const calculateRelevanceScore = (post: Post, profile: UserProfile): { score: number, reason: string } => {
  let score = 0;
  const reasons: string[] = [];

  // Base score for recency/popularity simulation
  score += Math.log10(post.likes) * 5; 

  // Check for dislikes (Penalty is very high to effectively filter them out/push them down)
  const matchedDislikes = post.tags.filter(tag => profile.dislikeTags.includes(tag));
  if (matchedDislikes.length > 0) {
    score -= 500 * matchedDislikes.length;
    reasons.push(`❌ Hit dislike tags: ${matchedDislikes.join(', ')}`);
  }

  // Check for likes (Reward)
  const matchedLikes = post.tags.filter(tag => profile.likeTags.includes(tag));
  if (matchedLikes.length > 0) {
    score += 100 * matchedLikes.length;
    reasons.push(`✅ Hit interest tags: ${matchedLikes.join(', ')}`);
  }

  // Add a small random factor to simulate exploration (so order isn't identical every ms)
  // In a real system, this is Bandit algorithms.
  score += Math.random() * 5;

  return {
    score: Math.round(score),
    reason: reasons.length > 0 ? reasons.join(' | ') : 'neutral content'
  };
};

export const rankPosts = (posts: Post[], profile: UserProfile): Post[] => {
  return posts.map(post => {
    const { score, reason } = calculateRelevanceScore(post, profile);
    return { ...post, score, debugReason: reason };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};

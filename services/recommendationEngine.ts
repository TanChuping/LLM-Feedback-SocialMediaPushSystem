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

  // Check for dislikes (Penalty)
  // UPDATED: Reduced multiplier from 20 to 12 to prevent "poison pills".
  // If a user loves "Visa" but hates "Anxiety", a post with both should still have a fighting chance.
  post.tags.forEach(postTag => {
    const dislikeMatch = profile.dislikes.find(d => d.tag === postTag);
    if (dislikeMatch) {
      const penalty = dislikeMatch.weight * 12; 
      score -= penalty;
      reasons.push(`❌ Dislike '${postTag}' (-${penalty.toFixed(0)})`);
    }
  });

  // Check for interests (Reward)
  // UPDATED: Increased multiplier from 5 to 10.
  // Strong interests should overpower mild dislikes.
  post.tags.forEach(postTag => {
    const interestMatch = profile.interests.find(i => i.tag === postTag);
    if (interestMatch) {
      const reward = interestMatch.weight * 10; 
      score += reward;
      reasons.push(`✅ Interest '${postTag}' (+${reward.toFixed(0)})`);
    }
  });

  // Add a small random factor to simulate exploration
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
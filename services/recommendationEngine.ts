import { Post, UserProfile } from '../types';

/**
 * Calculates a relevance score for a post based on the user profile.
 * High score = high relevance.
 */
export const calculateRelevanceScore = (post: Post, profile: UserProfile): { score: number, reason: string } => {
  let score = 0;
  const reasons: string[] = [];

  // --- 1. Popularity Base Score ---
  // Logarithmic scale prevents viral posts from overpowering personal interests completely.
  // 10 likes -> +5 pts
  // 100 likes -> +10 pts
  // 1000 likes -> +15 pts
  score += Math.log10(post.likes + 1) * 5; 

  // --- 2. Dislike Penalty (With Saturation) ---
  // Logic: Accumulate penalties from all matching tags, but CAP the total penalty.
  // This prevents a post with 10 minor dislikes from vanishing into the abyss if it has strong redeeming qualities.
  let totalDislikeWeight = 0;
  
  post.tags.forEach(postTag => {
    const dislikeMatch = profile.dislikes.find(d => d.tag === postTag);
    if (dislikeMatch) {
      totalDislikeWeight += dislikeMatch.weight;
      reasons.push(`${postTag} (-${(dislikeMatch.weight * 5).toFixed(0)})`);
    }
  });

  // Cap total dislike weight impact. 
  // Even if a post hits every dislike, we calculate based on a max effective weight summation of roughly 20.
  const effectiveDislikePenalty = Math.min(totalDislikeWeight * 5, 100); 
  score -= effectiveDislikePenalty;

  // --- 3. Interest Bonus ---
  let totalInterestWeight = 0;
  post.tags.forEach(postTag => {
    const interestMatch = profile.interests.find(i => i.tag === postTag);
    if (interestMatch) {
      totalInterestWeight += interestMatch.weight;
      reasons.push(`${postTag} (+${interestMatch.weight.toFixed(0)})`);
    }
  });

  // Add interest weight to score
  score += totalInterestWeight;

  return { 
    score: parseFloat(score.toFixed(2)), 
    reason: reasons.length > 0 ? reasons.slice(0, 3).join(', ') : 'Trending' 
  };
};

export const rankPosts = (posts: Post[], profile: UserProfile): Post[] => {
  return posts.map(post => {
    const { score, reason } = calculateRelevanceScore(post, profile);
    return { ...post, score, debugReason: reason };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};
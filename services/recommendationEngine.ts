import { Post, UserProfile } from '../types';

/**
 * Calculates a relevance score for a post based on the user profile.
 * High score = high relevance.
 */
export const calculateRelevanceScore = (post: Post, profile: UserProfile): { score: number, reason: string } => {
  let score = 0;
  const reasons: string[] = [];

  // --- CONFIGURATION KNOBS ---
  const POPULARITY_WEIGHT = 0.05; 
  const INTEREST_MULTIPLIER = 4.0; 
  const SYNERGY_BONUS = 15.0;
  
  // NEW: A dislike only triggers a VETO if (UserWeight * PostTagWeight) exceeds this.
  // Example: User hates Gaming (20). 
  // If Post has Gaming (2.0) -> 40 > 25 -> VETO.
  // If Post has Gaming (0.5) -> 10 < 25 -> NO VETO (Just penalty).
  const VETO_THRESHOLD = 25.0; 

  // --- 1. Popularity Base Score ---
  score += Math.log10(post.likes + 1) * POPULARITY_WEIGHT; 

  // --- 2. Interest Calculation ---
  let totalInterestWeight = 0;
  let hitCount = 0; 

  post.tags.forEach(postTag => {
    const interestMatch = profile.interests.find(i => i.tag === postTag);
    if (interestMatch) {
      // DEFAULT to 1.0 if not defined in post
      const postTagImpact = post.tagWeights?.[postTag] ?? 1.0;
      
      const weightedScore = interestMatch.weight * postTagImpact;
      totalInterestWeight += weightedScore;
      hitCount++;
      reasons.push(`${postTag}`);
    }
  });

  score += totalInterestWeight * INTEREST_MULTIPLIER;

  // Synergy Bonus (Keep as is, good for dense matches)
  if (hitCount > 1) {
    const synergy = (hitCount - 1) * SYNERGY_BONUS;
    score += synergy;
    if (synergy > 0) reasons.push(`🔥Synergy (+${synergy})`);
  }

  // --- 3. Dislike Penalty & REFINED VETO ---
  let isVetoed = false;
  let vetoReason = '';

  post.tags.forEach(postTag => {
    const dislikeMatch = profile.dislikes.find(d => d.tag === postTag);
    if (dislikeMatch) {
      const postTagImpact = post.tagWeights?.[postTag] ?? 1.0;
      const effectiveDislike = dislikeMatch.weight * postTagImpact;

      // Standard Penalty
      score -= effectiveDislike * 5.0; 
      
      // SMART VETO CHECK
      if (effectiveDislike >= VETO_THRESHOLD) {
        isVetoed = true;
        vetoReason = `${postTag} (Impact: ${postTagImpact})`;
      }
      reasons.push(`${postTag} ⛔`); 
    }
  });

  // Apply Veto
  if (isVetoed) {
    score = -1000 - (score * 0.1); 
    reasons.unshift(`🚫 BLOCKED by ${vetoReason}`);
  }

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
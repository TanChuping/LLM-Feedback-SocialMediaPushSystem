import { Post, UserProfile } from '../types';

/**
 * Normalizes a tag string by removing emojis and converting to lowercase.
 * This allows "📝 Writing" to match "✍️ Writing".
 */
export const normalizeTag = (tag: string): string => {
  return tag
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '') // Remove Emojis
    .replace(/[^\w\s\u4e00-\u9fa5]/g, '') // Keep words, spaces, and Chinese characters
    .trim()
    .toLowerCase();
};

/**
 * Generates a random initial user profile to simulate cold start diversity.
 * Picks 2-5 random tags with weights between 1.0 and 5.0.
 */
export const generateRandomProfile = (allTags: string[]): UserProfile => {
  const count = Math.floor(Math.random() * 4) + 2; // 2 to 5 tags
  const shuffled = [...allTags].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);

  return {
    id: `user_${Date.now()}`,
    name: 'New Explorer',
    bio: 'Exploring...',
    interests: selected.map(tag => ({
      tag,
      weight: parseFloat((Math.random() * 4 + 1).toFixed(1)) // 1.0 to 5.0
    })),
    dislikes: []
  };
};

/**
 * Deterministic "Dead" Algorithm for Keyword Search.
 * Returns posts matching the query string in Title or Tags.
 */
export const searchContent = (posts: Post[], query: string): Post[] => {
  if (!query || query.trim().length === 0) return [];
  
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  
  return posts.map(post => {
    let hits = 0;
    const searchableText = `${post.title.en} ${post.title.zh} ${post.tags.join(' ')}`.toLowerCase();
    
    tokens.forEach(token => {
      if (searchableText.includes(token)) hits += 1;
    });
    
    return { ...post, score: hits }; // Temporary score for sorting
  })
  .filter(p => (p.score || 0) > 0)
  .sort((a, b) => (b.score || 0) - (a.score || 0));
};

/**
 * STAGE 1.5: Hybrid Retrieval
 * Combines Weighted Interest Feed (Algo) + Explicit Search Feed (Dead Algo).
 * 
 * Logic:
 * - If NO explicit query: Return top 25 from Interest Rank.
 * - If explicit query: 
 *    1. Take Top 15 from Interest Rank.
 *    2. Take Top 10 from Search Rank.
 *    3. Merge and Deduplicate.
 *    4. Return combined list (up to 25) for Stage 2 LLM Reranking.
 */
export const getHybridFeed = (
  allPosts: Post[], 
  profile: UserProfile, 
  explicitQuery?: string | null
): Post[] => {
  
  // 1. Always Calculate Interest Scores for everyone (Background Baseline)
  const interestRanked = rankPosts(allPosts, profile);

  if (!explicitQuery) {
    // Scenario A: Pure Algo Feed
    return interestRanked.slice(0, 25);
  }

  // Scenario B: Hybrid Injection
  console.log(`[Hybrid] Injecting search results for: "${explicitQuery}"`);
  
  // Pool A: Top 15 Algo
  const poolA = interestRanked.slice(0, 15);
  const poolAIds = new Set(poolA.map(p => p.id));

  // Pool B: Top 10 Search (excluding ones already in Pool A)
  const searchResults = searchContent(allPosts, explicitQuery);
  const poolB: Post[] = [];
  
  for (const post of searchResults) {
    if (!poolAIds.has(post.id)) {
      poolB.push(post);
      if (poolB.length >= 10) break;
    }
  }

  // Merge
  // Note: We don't sort here. Stage 2 LLM will sort them.
  // We just provide the candidate bag.
  return [...poolA, ...poolB];
};

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
  const SYNERGY_BONUS = 5.0;
  const VETO_THRESHOLD = 25.0; 

  // --- 1. Popularity Base Score ---
  score += Math.log10(post.likes + 1) * POPULARITY_WEIGHT; 

  // --- 2. Interest Calculation ---
  let totalInterestWeight = 0;
  let hitCount = 0; 

  post.tags.forEach(postTag => {
    // FUZZY MATCH: Normalize both tags to ensure hits even if emojis differ
    const normPostTag = normalizeTag(postTag);
    
    // Find the best match in user interests (in case of duplicates after normalization, take max)
    const interestMatch = profile.interests.find(i => normalizeTag(i.tag) === normPostTag || normPostTag.includes(normalizeTag(i.tag)));
    
    if (interestMatch) {
      // DEFAULT to 1.0 if not defined in post
      const postTagImpact = post.tagWeights?.[postTag] ?? 1.0;
      
      const weightedScore = interestMatch.weight * postTagImpact;
      totalInterestWeight += weightedScore;
      hitCount++;
      // Use the User's tag name for the reason so they recognize it
      reasons.push(`${interestMatch.tag}`);
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
    const normPostTag = normalizeTag(postTag);
    const dislikeMatch = profile.dislikes.find(d => normalizeTag(d.tag) === normPostTag || normPostTag.includes(normalizeTag(d.tag)));
    
    if (dislikeMatch) {
      const postTagImpact = post.tagWeights?.[postTag] ?? 1.0;
      const effectiveDislike = dislikeMatch.weight * postTagImpact;

      // Standard Penalty
      score -= effectiveDislike * 5.0; 
      
      // SMART VETO CHECK
      if (effectiveDislike >= VETO_THRESHOLD) {
        isVetoed = true;
        vetoReason = `${dislikeMatch.tag}`;
      }
      reasons.push(`${dislikeMatch.tag} ⛔`); 
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
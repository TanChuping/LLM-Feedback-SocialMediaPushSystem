import { FeedbackAnalysisResult, Post, UserProfile, TagAdjustment, WeightedTag } from "../types";
import { AVAILABLE_EMOJIS } from "../data/availableEmojis";
import { getCombinationsForEmoji, getCombinationsListForPrompt, getFusionUrl } from "./emojiCombinations";

// Groq Configuration
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile"; 
const DEFAULT_KEY = " ";

/**
 * Generic Groq Fetch Wrapper with Retry Logic for 429s
 */
async function callGroqWithRetry(
  apiKey: string, 
  messages: any[], 
  tag: string,
  jsonMode: boolean = true,
  retries: number = 3,
  options?: { temperature?: number; maxTokens?: number }
): Promise<any> {
  const effectiveKey = apiKey || DEFAULT_KEY;

  if (!effectiveKey || effectiveKey.trim().length === 0) {
    console.error(`[${tag}] ❌ No Groq API Key provided. apiKey:`, apiKey ? `Present (${apiKey.length} chars)` : 'Missing', 'DEFAULT_KEY:', DEFAULT_KEY ? 'Present' : 'Missing');
    throw new Error("No Groq API Key provided.");
  }
  
  console.log(`[${tag}] 🔑 Using API key:`, effectiveKey ? `Present (${effectiveKey.length} chars)` : 'Missing');

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Prevent "infinite hang" if the request stalls (common cause of UI stuck at "analyzing").
      const controller = new AbortController();
      const timeoutMs = 25000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${effectiveKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: messages,
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxTokens ?? 2048, // default 2048 avoids truncation for long prompts
          response_format: jsonMode ? { type: "json_object" } : undefined,
        }),
      });
      clearTimeout(timeoutId);

      if (response.status === 429) {
        const errorText = await response.text();
        console.warn(`[${tag}] Rate Limit (429) hit. Attempt ${attempt + 1}/${retries}. Retrying...`);
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${tag}] Groq API Error (${response.status}):`, errorText.substring(0, 500));
        
        // 检查是否是 token 相关错误
        if (response.status === 400 && (errorText.includes('token') || errorText.includes('length'))) {
          throw new Error(`Token limit exceeded or invalid request. Status: ${response.status}`);
        }
        
        throw new Error(`Groq API Error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      // 记录 token 使用情况（如果有）
      if (data.usage) {
        console.log(`[${tag}] Token usage:`, {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens
        });
      }

      if (!content) throw new Error("Empty response from Groq");

      return jsonMode ? JSON.parse(content) : content;

    } catch (error: any) {
      // If aborted due to timeout, retry like other transient errors
      if (error?.name === 'AbortError') {
        console.warn(`[${tag}] Request timed out. Attempt ${attempt + 1}/${retries}. Retrying...`);
      }
      if (attempt === retries - 1) {
        console.error(`[${tag}] Groq Call Failed after ${retries} attempts:`, error);
        throw error;
      }
    }
  }
}

// --- STAGE 1: HIGH-EQ INTENT ANALYSIS ---
export const analyzeFeedback = async (
  feedbackText: string,
  contentContext: string,
  userProfile: UserProfile, 
  providedKey: string,
  availableTags: string[] 
): Promise<FeedbackAnalysisResult & { rawResponse?: any }> => {
  
  const profileInterests = userProfile.interests.map(i => `${i.tag}(${i.weight.toFixed(1)})`).join(', ');
  const profileDislikes = userProfile.dislikes.map(d => `${d.tag}(${d.weight.toFixed(1)})`).join(', ');

  // Validate availableTags
  if (!availableTags || availableTags.length === 0) {
    console.error('[analyzeFeedback] ⚠️ CRITICAL: availableTags is empty or undefined!', {
      availableTags,
      type: typeof availableTags,
      isArray: Array.isArray(availableTags)
    });
    return {
      adjustments: [],
      user_note: 'Analysis Failed: Tag vocabulary not loaded. Please refresh the page.',
      explicit_search_query: null,
      dislike_scope: 'aspect',
      soft_downrank_query: null,
      soft_downrank_strength: 1
    };
  }

  // Limit vocabulary size to prevent context overflow, but keep enough for variety
  // IMPORTANT: availableTags is already deduplicated and ordered (EXPLICIT_TAGS first, then POST_DERIVED_TAGS)
  // So the first 300 tags will include all explicit tags plus the most common post-derived tags
  const vocabularyList = availableTags.slice(0, 300).join('", "');
  
  // Log which tags are included/excluded for debugging
  if (availableTags.length > 300) {
    console.log(`[analyzeFeedback] Using first 300 of ${availableTags.length} tags. Excluded: ${availableTags.slice(300, 310).join(', ')}...`);
  }
  
  // Log for debugging
  if (vocabularyList.length === 0) {
    console.error('[analyzeFeedback] ⚠️ vocabularyList is empty after processing!', {
      availableTagsLength: availableTags.length,
      availableTagsSample: availableTags.slice(0, 5)
    });
  } else {
    console.log(`[analyzeFeedback] ✅ Vocabulary loaded: ${availableTags.length} tags, using first ${Math.min(300, availableTags.length)}`);
  }

  // Check if profile is empty to provide better context to LLM
  const isProfileEmpty = !profileInterests || profileInterests.trim().length === 0;
  const profileStatusNote = isProfileEmpty 
    ? "⚠️ NOTE: User profile is currently EMPTY (no interests). You MUST add new tags based on their feedback. This is normal for new users or after profile cleanup."
    : "";

  const systemPrompt = `
    You are a Precision Recommendation Tuner. 
    Your goal is to parse user feedback and output specific, *weighted* adjustments to their profile tags.

    VOCABULARY_SAMPLE: ["${vocabularyList}"]

    CRITICAL INSTRUCTIONS:
    1. **HIERARCHY IS KING**: 
       - **PRIMARY Signal (The core topic/intent):** Delta 6 to 9.
       - **SECONDARY Context (Related topics):** Delta 1 to 3.
       - **NOISE:** Delta 0 (Ignore).

    2. **CORRECT THE PROFILE**: 
       - Look at the "CURRENT_PROFILE". 
       - If the user hates something currently in "Interests", output a 'dislike' adjustment to Flip it.
       - If the user loves something in "Dislikes", output an 'interest' adjustment.
       - **IMPORTANT**: If LIKES is empty, you MUST still add tags based on user feedback. Empty profile is normal and requires you to build it from scratch.

    3. **EXPLICIT SEARCH INTENT**:
       - If the user explicitly says "Show me X", "I want to see Y", "Search for Z", extract "X Y Z" as a keyword string.
       - If they just say "I like this" or "This sucks", search intent is null.
       - Even if the user says "看看X" or "推荐X" (Chinese), extract "X" as explicit_search_query.

    4. **TOPIC vs FRAMING vs CONDUCT (principle, not patch)**:
       - First decide: are they attacking the subject, the framing/bias, or the conduct shown?
       - If they object to framing/bias (“性别歧视的猫帖”, “新闻标题党/偏见”), DO NOT punish the subject tag (cats / community college / topic)。调整到讨论/偏见类标签（"🤝 Discussion", "🧠 Opinions", "📰 News Bias", "🔥 Hot Takes"）。
       - 如果他们谴责的是**不当行为**（虐待/工具化/不尊重宠物等），不要下砸主题标签；标记为行为问题，可轻微提高“伦理/讨论”类标签，留给后续排序层降权该具体内容。
       - 若用户同时表达“喜欢该主体”但“讨厌不当行为”（如“喜欢猫但讨厌不负责/虐猫/玩弄”），保持主体为 interest 或不变，不要给 dislike；仅对行为/讨论类小幅调整。
       - “只在网上看X”表示偏好“观看而非拥有/线下接触”，不等于讨厌该主题；保持兴趣，避免 dislike 主题。
       - 只有在用户明确“讨厌某主体本身”（explicit “hate cats/dogs/X”）时，才对主体打强烈 dislike。
       - 若有歧义，宁可小幅调整讨论/伦理标签，也不要对主体给高强度 dislike。

    5. **ENTITY vs CATEGORY (important)**:
       - If the feedback targets a SPECIFIC entity (artist/celebrity/person/character/brand/school) rather than the whole category:
         Example: “这个明星我不喜欢/这人唱歌像电锯/辣耳朵” + title contains “Adele”.
         Then treat it as aspect-level: set dislike_scope="aspect", set soft_downrank_query to that ENTITY NAME (e.g., "Adele"), and DO NOT downweight broad tags like "🎶 Music".
       - Only set dislike_scope="topic" and downweight broad category tags when the user explicitly rejects the category itself (e.g., “不要再给我看音乐/I hate music”). 

    6. **DISLIKE SCOPE (important)**:
       - Set dislike_scope = "topic" ONLY when the user dislikes the topic itself (e.g., "I hate cats", "不要再给我看猫").
       - Set dislike_scope = "aspect" when the user dislikes the *way* it is presented or the *behavior* shown (bias, irresponsibility, clickbait, toxicity, etc.).
       - If dislike_scope = "aspect", you SHOULD avoid outputting strong 'dislike' adjustments for the subject tag. Instead, use soft_downrank_query to describe what to push down.

    7. **PREFERENCE TARGETS (structure)**:
       - Output preference_targets (max 3) to explicitly label what the feedback targets:
         - type="entity": specific product/person/character/brand/school (e.g., "DeepSeek", "Adele", "散兵")
         - type="aspect": content angle/quality/toxicity/clickbait (e.g., "低质量评测", "标题党", "糊弄小白")
         - type="topic": broad category only when explicitly rejected (e.g., "AI/ML", "Music")
       - Use polarity like/dislike and strength 1-3.
       - For rants like “DeepSeek垃圾 ai比不上gpt”，create entity dislike ("DeepSeek") + aspect dislike ("低质量评测/糊弄小白") and AVOID topic dislike unless explicit stop-words.

    8. **OUTPUT FORMAT**:
       JSON: { 
         "adjustments": [{ "tag": string, "category": "interest"|"dislike", "delta": number }], 
         "explicit_search_query": string | null,
         "dislike_scope": "topic" | "aspect",
         "soft_downrank_query": string | null,
         "soft_downrank_strength": 1 | 2 | 3,
          "preference_targets": [{ "type": "entity"|"aspect"|"topic", "value": string, "polarity": "like"|"dislike", "strength": 1|2|3 }],
         "user_note": string 
       }
       - Do NOT output keys like "primary_driver" or "secondary_contexts". Use ONLY the schema above.
       
       **CRITICAL**: The "tag" field MUST be an EXACT match from the VOCABULARY_SAMPLE above. 
       - DO NOT use just emoji (e.g., "🎵") - use the full tag (e.g., "🎶 Music" or "🎵 Kpop")
       - DO NOT invent new tags - only use tags that exist in VOCABULARY_SAMPLE
       
       **TAG SELECTION RULES**:
       - For general "music" requests, ALWAYS use "🎶 Music" (NOT "🎵 Kpop" unless user specifically mentions Kpop)
       - "🎵 Kpop" is ONLY for K-pop/Korean pop music specifically
       - "🎶 Music" is the general music tag - use this when user says "音乐", "music", "songs", etc.
       - If user says "不是kpop" or "not kpop", they want "🎶 Music" not "🎵 Kpop"
       - For dating/relationships: 
         * Use "💘 Dating" for casual dating, dating apps, dating advice
         * Use "💑 Relationships" for serious relationships, relationship advice, long-term partnerships
         * Use "💔 Heartbreak" for breakups, heartbreak, emotional pain from relationships
       - For cars/vehicles, use "🚗 Cars" (not just "🚗")
       - For money/finance, use "💸 Money" or more specific tags like "💸 Cost of Living", "💸 Money Saving"
       - Always use the FULL tag name from VOCABULARY_SAMPLE, never just emoji or just text

    9. **SCALING**:
       - "I love this": Primary +6, Secondary +2
       - "Show me more": Primary +4
       - "I hate this": Dislike +8 (Strong filter)
       - "Not for me": Dislike +4
       - **MAX DELTA IS 10.**

    10. **EMPTY PROFILE HANDLING**:
       - If CURRENT_PROFILE shows empty LIKES, treat this as a fresh start.
       - You MUST output adjustments based on the feedback, even if profile is empty.
       - Do NOT return empty adjustments array just because profile is empty.
  `;

  const userPrompt = `
    CONTENT_CONTEXT: "${contentContext}"
    CURRENT_PROFILE: 
      - LIKES: [${profileInterests || "(empty - new user or profile reset)"}]
      - DISLIKES: [${profileDislikes || "(empty)"}]
    ${profileStatusNote}
    
    USER_FEEDBACK: "${feedbackText}"
    
    TASK: Output the required JSON object with:
    - adjustments: [{ tag, category, delta }]
    - explicit_search_query (or null)
    - dislike_scope ("topic" or "aspect")
    - soft_downrank_query (or null)
    - soft_downrank_strength (1-3)
    - user_note (string)
    ${isProfileEmpty ? "Since profile is empty, you MUST add tags based on this feedback." : ""}
  `;

  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/geminiService.ts:analyzeFeedback:pre-call',message:'Stage1 analyzeFeedback starting callGroqWithRetry',data:{feedbackLen:feedbackText?.length||0,contentContextLen:contentContext?.length||0,availableTagsLen:availableTags?.length||0,profileInterestsLen:userProfile?.interests?.length||0,profileDislikesLen:userProfile?.dislikes?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      "Analysis"
    );

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/geminiService.ts:analyzeFeedback:post-call',message:'Stage1 analyzeFeedback got raw result',data:{resultKeys:Object.keys(result||{}),hasAdjustments:Array.isArray(result?.adjustments),adjustmentsType:typeof result?.adjustments,explicit_search_query:result?.explicit_search_query??null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    // Defensive defaults: model might omit new fields; don't let callers crash.
    const dislike_scope = result?.dislike_scope === 'topic' ? 'topic' : 'aspect';
    const soft_downrank_query = typeof result?.soft_downrank_query === 'string' ? result.soft_downrank_query : null;
    const soft_downrank_strength_raw = Number(result?.soft_downrank_strength ?? 1);
    const soft_downrank_strength = Math.max(1, Math.min(3, soft_downrank_strength_raw || 1));

    const normalizeTargets = (v: any) => {
      if (!Array.isArray(v)) return [];
      return v
        .map((t: any) => {
          const type = t?.type;
          const value = typeof t?.value === 'string' ? t.value.trim() : '';
          const polarity = t?.polarity;
          const strengthRaw = Number(t?.strength ?? 1);
          const strength = Math.max(1, Math.min(3, strengthRaw || 1)) as 1 | 2 | 3;
          if (!value) return null;
          if (type !== 'entity' && type !== 'aspect' && type !== 'topic') return null;
          if (polarity !== 'like' && polarity !== 'dislike') return null;
          return { type, value, polarity, strength };
        })
        .filter(Boolean)
        .slice(0, 3);
    };

    const normalized = {
      ...result,
      // Ensure adjustments is always an array to avoid runtime crashes; log proves whether LLM schema drift is happening.
      adjustments: Array.isArray(result?.adjustments) ? result.adjustments : [],
      dislike_scope,
      soft_downrank_query,
      soft_downrank_strength,
      preference_targets: normalizeTargets(result?.preference_targets),
      rawResponse: result
    };

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8426c041-d03a-4909-996a-91157fbebdcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/geminiService.ts:analyzeFeedback:normalized',message:'Stage1 analyzeFeedback normalized output',data:{normalizedKeys:Object.keys(normalized||{}),adjustmentsIsArray:Array.isArray(normalized.adjustments),adjustmentsLen:normalized.adjustments?.length??null,dislike_scope:normalized.dislike_scope,soft_downrank_query:normalized.soft_downrank_query??null,soft_downrank_strength:normalized.soft_downrank_strength,targetsLen:(normalized.preference_targets||[]).length},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    return normalized;

  } catch (error: any) {
    return { 
        adjustments: [], 
        user_note: `Analysis Failed. Error: ${error.message}`,
        explicit_search_query: null,
        dislike_scope: 'aspect',
        soft_downrank_query: null,
        soft_downrank_strength: 1
    };
  }
};

// --- STAGE 2: LEAN RE-RANKING (IDs Only) ---
export const rerankFeed = async (
  topPosts: Post[],
  userProfile: UserProfile,
  providedKey: string,
  language: 'en' | 'zh',
  explicitIntent?: string
): Promise<{ orderedIds: string[], rawResponse?: any }> => {
  
  if (topPosts.length === 0) return { orderedIds: [] };

  const candidates = topPosts
    .map(p => `ID:${p.id} | Title:${p.title[language]} | Tags:${(p.tags || []).join(', ')}`)
    .join('\n');

  // Parse deterministic soft-avoid signal (embedded by App.tsx) so Stage 2 can respect it.
  const avoidMatch = explicitIntent?.match(/SOFT_AVOID \(aspect\):\s*"([^"]+)"\s*\(strength:(\d+)\)/i);
  const avoidText = (avoidMatch?.[1] || '').trim();
  const avoidStrength = Math.max(1, Math.min(3, Number(avoidMatch?.[2] || 1)));
  
  const topInterests = userProfile.interests
    .sort((a,b) => b.weight - a.weight)
    .slice(0, 5)
    .map(i => i.tag)
    .join(', ');

  const systemPrompt = `
    You are a ranking engine. Re-order the provided posts based on the User's Profile and Explicit Request.
    
    USER PROFILE TOP INTERESTS: ${topInterests}
    ${explicitIntent ? `CURRENT USER REQUEST: "${explicitIntent}"` : ''}
    ${avoidText ? `AVOID_KEYWORDS (aspect-level, downrank only): "${avoidText}" (strength:${avoidStrength})` : ''}

    CONTEXT:
    The candidate list provided may be a MIX of:
    1. Posts that match the user's long-term interests (Weights).
    2. Posts that match a SPECIFIC KEYWORD SEARCH the user just made (if applicable).

    RULES:
    1. If the User Request is specific (e.g. "Show me jobs"), prioritize the posts that match that topic ABOVE general interests.
    2. Ensure the feed flows logically.
    3. AVOIDANCE (important):
       - If AVOID_KEYWORDS is present, you MUST push posts whose Title or Tags match the avoid phrase/tokens toward the bottom of the list.
       - Treat strength 3 as strong: put matching posts in the bottom ~20% unless the explicit request is *to see that topic*.
    4. Output strictly a JSON object: { "ids": ["id1", "id2", ...] }.
    5. Include ALL provided IDs.
  `;

  try {
    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `CANDIDATE POSTS (Mix of Algo & Search):\n${candidates}` }
      ],
      "Rerank"
    );

    return { orderedIds: result.ids || [], rawResponse: result };

  } catch (error: any) {
    console.error("Rerank Error", error);
    return { 
      orderedIds: topPosts.map(p => p.id), 
      rawResponse: `Error: ${error.message}` 
    };
  }
};

// --- STAGE 3: BACKGROUND CLEANUP (DECAY & DEDUPLICATION) ---
export const pruneUserProfile = async (
  history: string[],
  userProfile: UserProfile,
  providedKey: string
): Promise<{ adjustments: TagAdjustment[], reason: string }> => {
  
  // CRITICAL: Only run cleanup if we have enough feedback history (at least 3 items)
  // This prevents premature tag decay when user just started
  if (history.length < 3) {
    console.log(`[pruneUserProfile] Skipping cleanup: history too short (${history.length} items, need at least 3)`);
    return { adjustments: [], reason: `History too short (${history.length} items). Need at least 3 feedbacks before cleanup.` };
  }
  
  if (userProfile.interests.length < 3) return { adjustments: [], reason: "Profile too small" };

  const latestFeedback = history[history.length - 1] || "";
  // Pass deeper history to detect contradictions over time
  const historyStr = history.slice(-8).join(" | ");
  
  // Format current tags with weights to help LLM decide what to kill
  const currentTags = userProfile.interests.map(i => `${i.tag} (Weight:${i.weight.toFixed(1)})`).join(', ');

  const systemPrompt = `
    You are a profile maintenance garbage collector.
    Your job is to identify "Decay" (negative delta) for tags by analyzing the User's FEEDBACK HISTORY against their CURRENT TAGS.

    CURRENT TAGS: [${currentTags}]
    LATEST FEEDBACK: "${latestFeedback}"
    FULL FEEDBACK HISTORY: "${historyStr}"
    FEEDBACK COUNT: ${history.length}

    OUTPUT JSON: { "decay": [{ "tag": string, "delta": number }], "reason": string }
    
    CRITICAL RULES:
    1. **RELEVANCE CHECK (PRIMARY)**: For each tag in CURRENT TAGS, check if it's mentioned or related to ANY feedback in the history.
       - If a tag is NOT mentioned in the last 3-4 feedbacks AND is unrelated to the user's recent interests, apply decay (-1 to -3).
       - Example: If user talks about "nightlife, dating, KTV" but has "Computer Science" tag, decay Computer Science.
    
    2. **Contradiction Check**: If the user EXPLICITLY said they hate/dislike something, decay it heavily (-3 to -5).
    
    3. **Semantic Deduplication**: If tags are TRULY redundant (e.g., "Coding" and "Computer Science" with same meaning), decay the lower weight one slightly (-1 to -2).
    
    4. **Time-based Decay (ACTIVE)**: Apply time-based decay if:
       - Feedback history has at least 5+ items (reduced from 8)
       - Tag hasn't been mentioned or boosted in the last 3+ feedbacks
       - Tag is unrelated to recent feedback topics
       - Apply -1 to -3 based on how irrelevant it is
    
    5. **Delta Range**: Must be negative (-1 to -5). 
       - Mild irrelevance: -1 to -2
       - Clear irrelevance: -2 to -3
       - Strong contradiction: -3 to -5
    
    6. **ACTIVE CLEANUP**: You MUST identify at least 1-2 tags that are clearly irrelevant to recent feedback and decay them. Don't be too conservative.
  `;

  try {
    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analyze profile history and output decay adjustments." }
      ],
      "Prune"
    );

    console.log(`[pruneUserProfile] LLM raw response:`, {
      decay_count: result.decay?.length || 0,
      decay: result.decay,
      reason: result.reason
    });

    const adjustments: TagAdjustment[] = (result.decay || []).map((d: any) => ({
      tag: d.tag,
      category: 'interest',
      delta: d.delta < 0 ? d.delta : -Math.abs(d.delta) // Ensure negative
    }));

    console.log(`[pruneUserProfile] Processed adjustments:`, adjustments);

    return { adjustments, reason: result.reason || "Routine cleanup" };

  } catch (error: any) {
    console.error(`[pruneUserProfile] Error:`, error);
    return { adjustments: [], reason: `Error: ${error.message}` };
  }
};

// --- STAGE 4A: USER PERSONA DESCRIPTION (Text Only) ---
export const generateUserNickname = async (
  feedbackHistory: string[],
  providedKey: string,
  existingNickname?: string
): Promise<{ nickname: string; rawResponse?: any }> => {
  
  if (feedbackHistory.length === 0) {
    return { 
      nickname: "New Explorer"
    };
  }

  const recentHistory = feedbackHistory.slice(-10).join(" | ");
  const existingName = existingNickname || "New Explorer";

  // 简洁的 prompt，生成友好、有趣的用户名字
  const systemPrompt = `生成友好、有趣的用户昵称（最多3个单词，英文）。基于用户反馈，突出兴趣/风格/心情，避免冒犯。

示例：
- 爱吃美食 → "ramen explorer", "pizza chaser", "snack seeker"
- 科技/学习 → "robot tinkerer", "curious coder", "calm learner"
- 运动/夜生活 → "nightlife mixer", "gym runner", "dance friend"
- 旅行/探索 → "sunset chaser", "city hopper", "weekend trekker"

规则：
1. 最多3个单词，简短有力
2. 语气轻松、风趣，但保持尊重
3. 基于用户最新反馈和整体形象
4. 如果现有名字已经很准确，可以保持或微调

输出JSON: { "nickname": "名字（最多3个单词）" }`;

  const limitedHistory = recentHistory.length > 500 
    ? recentHistory.substring(0, 500) + '...' 
    : recentHistory;
  
  const userPrompt = `
    用户反馈历史（最近10条）：
    ${limitedHistory}
    
    现有名字：${existingName}
    
    任务：生成或更新一个友好、有趣但不冒犯的用户昵称，突出兴趣/风格/心情。
  `;

  try {
    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      "UserNickname",
      true,
      3,
    );

    // 验证并清理名字（确保最多3个单词）
    const nickname = result.nickname || existingName;
    const words = nickname.trim().split(/\s+/).slice(0, 3).join(' ');
    
    return {
      nickname: words || existingName,
      rawResponse: result
    };

  } catch (error: any) {
    console.error("User Nickname Generation Error", error);
    return { 
      nickname: existingNickname || "New Explorer", 
      rawResponse: `Error: ${error.message}`
    };
  }
};

// --- STAGE 4a: FAST PERSONA SIGNALS (for Stage 2 refine rerank) ---
export const generateUserPersonaSignals = async (
  feedbackHistory: string[],
  providedKey: string
): Promise<{ userTraits: string[]; redFlags: string[]; redFlagKeywords: string[]; rawResponse?: any }> => {
  if (!feedbackHistory || feedbackHistory.length === 0) {
    return { userTraits: [], redFlags: [], redFlagKeywords: [] };
  }

  const recent = feedbackHistory.slice(-10).join('\n');

  const systemPrompt = `你是一个“用户反馈画像信号提取器”。只输出可用于推荐排序的结构化信号，不写长文，不写昵称，不写emoji。\n\n输入是用户最近的反馈（可能中英混杂）。\n\n你需要输出三组列表（每组最多5条，越短越好）：\n1) user_traits：稳定偏好/特征（尽量客观、有证据）\n2) red_flags：用户雷点/排斥点（通常是“喜欢X但讨厌Y角度/行为/质量”）\n3) red_flag_keywords：用于确定性匹配的短关键词/短语（最多5条），用来把相似内容在排序中压下去。\n\nred_flag_keywords 规则：\n- 必须短、可命中标题/正文/标签，不写长句\n- 中英文都可以\n- 优先输出“命名实体”的原样字符串（明星/歌手/角色/品牌/学校/公司/人名），例如标题出现的 \"Adele\"、\"DeepSeek\"。\n- 如果是内容质量/角度类，输出常见短语，如“标题党/低质量评测/刻板印象/糊弄小白/不尊重宠物”。\n\n输出JSON（字段必须存在）:\n{\n  \"user_traits\": [\"...\"],\n  \"red_flags\": [\"...\"],\n  \"red_flag_keywords\": [\"...\"]\n}`;

  const userPrompt = `最近反馈（最多10条，按时间从旧到新）：\n${recent}`;

  try {
    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      'STAGE4A_PERSONA_SIGNALS',
      true,
      2,
      { temperature: 0.1, maxTokens: 512 }
    );

    const toStringArray = (v: any): string[] => {
      if (!Array.isArray(v)) return [];
      return v
        .map(x => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .slice(0, 5);
    };

    return {
      userTraits: toStringArray(result.user_traits),
      redFlags: toStringArray(result.red_flags),
      redFlagKeywords: toStringArray(result.red_flag_keywords),
      rawResponse: result
    };
  } catch (error: any) {
    console.error('[generateUserPersonaSignals] Error', error);
    return { userTraits: [], redFlags: [], redFlagKeywords: [], rawResponse: `Error: ${error.message}` };
  }
};

export const generateUserPersonaDescription = async (
  feedbackHistory: string[],
  providedKey: string,
  existingDescription?: string
): Promise<{ description: string; userTraits: string[]; redFlags: string[]; redFlagKeywords: string[]; rawResponse?: any }> => {
  
  if (feedbackHistory.length === 0) {
    return { 
      description: "新用户，等待更多反馈来描绘画像...",
      userTraits: [],
      redFlags: [],
      redFlagKeywords: []
    };
  }

  const recentHistory = feedbackHistory.slice(-10).join(" | ");
  const existingDesc = existingDescription || "无";

  // Stage 4: 输出画像 + 可用于排序的“雷点/特征”摘要（不额外增加调用，只改变输出结构）
  const systemPrompt = `生成用户画像描述（200-400字）。只基于反馈文本和帖子内容，不涉及标签/emoji/技术。

你还需要总结两类列表（每类最多5条）：
1) user_traits：稳定特征/偏好（尽量客观、有证据）
2) red_flags：用户“雷点/排斥点”，常见形式是“虽然喜欢X，但讨厌Y类型内容/角度/行为”

同时输出 red_flag_keywords：每条是一个用于确定性匹配的短关键词/短语（最多5条），用于把相似内容在排序中压下去。
关键词要求：短、可命中标题/正文/标签；不要写长句；可以是中文短语或英文token。

命名实体要求（很重要）：
- 如果 red_flags 涉及具体对象（明星/歌手/角色/品牌/学校/公司/人名），必须直接写出名字（从帖子标题或反馈里提取）。
- red_flag_keywords 优先包含该名字的“原样字符串”（例如标题里出现的 "Adele"），这样排序层可以稳定命中标题。

示例（仅示意）：
- red_flags: ["喜欢猫但讨厌拿猫取乐/不负责的养宠内容"]
- red_flag_keywords: ["拿猫取乐", "不尊重宠物", "虐待宠物"]
- red_flags: ["社区大学转学但讨厌低质量速成广告/刻板印象内容"]
- red_flag_keywords: ["速成托福", "GPA2", "低级广告"]
- red_flags: ["玩原神但讨厌散兵相关内容"]
- red_flag_keywords: ["散兵"]

输出JSON（字段必须存在）:
{
  "description": "描述文本",
  "user_traits": ["..."],
  "red_flags": ["..."],
  "red_flag_keywords": ["..."]
}`;

  // 限制反馈历史长度，避免 token 过多
  const limitedHistory = recentHistory.length > 1000 
    ? recentHistory.substring(0, 1000) + '...' 
    : recentHistory;
  const limitedDesc = existingDesc.length > 200 
    ? existingDesc.substring(0, 200) + '...' 
    : existingDesc;
  
  const userPrompt = `
    用户反馈历史（最近10条，已截断）：
    ${limitedHistory}
    
    现有画像描述：${limitedDesc}
    
    任务：基于新反馈更新/生成用户画像的文字描述。只关注反馈内容和帖子本身，不要考虑其他技术性因素。
  `;

  try {
    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      "PersonaDescription",
      true, // jsonMode
      3,    // retries
    );

    const toStringArray = (v: any): string[] => {
      if (!Array.isArray(v)) return [];
      return v
        .map(x => (typeof x === 'string' ? x.trim() : ''))
        .filter(s => s.length > 0)
        .slice(0, 5);
    };

    return {
      description: result.description || existingDescription || "画像生成中...",
      userTraits: toStringArray(result.user_traits),
      redFlags: toStringArray(result.red_flags),
      redFlagKeywords: toStringArray(result.red_flag_keywords),
      rawResponse: result
    };

  } catch (error: any) {
    console.error("Persona Description Generation Error", error);
    return { 
      description: existingDescription || "画像分析失败",
      userTraits: [],
      redFlags: [],
      redFlagKeywords: [],
      rawResponse: `Error: ${error.message}`
    };
  }
};

// --- STAGE 4B: EMOJI FUSION (Playful, Non-offensive) ---
export const generateEmojiFusion = async (
  feedbackHistory: string[],
  providedKey: string
): Promise<{ emojiFusion: string[]; fusionUrl: string | null; rawResponse?: any }> => {
  
  if (feedbackHistory.length === 0) {
    // 默认组合
    try {
      const defaultUrl = await getFusionUrl('😀', '😁');
      return { 
        emojiFusion: ['😀', '😁'],
        fusionUrl: defaultUrl
      };
    } catch {
      return {
        emojiFusion: ['😀', '😁'],
        fusionUrl: null
      };
    }
  }

  const recentHistory = feedbackHistory.slice(-10).join(" | ");
  const latestFeedback = feedbackHistory[feedbackHistory.length - 1] || '';
  const feedbackLower = latestFeedback.toLowerCase();

  // 记录最近一次组合，避免重复
  const getLastFusion = (): string[] | null => {
    try {
      const raw = localStorage.getItem('lastEmojiFusion');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 2) return arr;
      }
    } catch {}
    return null;
  };
  const saveFusion = (pair: string[]) => {
    try { localStorage.setItem('lastEmojiFusion', JSON.stringify(pair)); } catch {}
  };

  // 简单词面映射，若用户直接提及具体物品/情绪，则直接用对应 emoji
  const literalMap: Array<[string | RegExp, string]> = [
    [/狗|dog/, '🐶'],
    [/猫|cat/, '🐱'],
    [/面包|bread/, '🍞'],
    [/寿司|sushi/, '🍣'],
    [/拉面|ramen/, '🍜'],
    [/披萨|pizza/, '🍕'],
    [/啤酒|beer/, '🍻'],
    [/咖啡|coffee/, '☕'],
    [/鸡|鸡肉|chicken/, '🍗'],
    [/开心|快乐|高兴|happy/, '😄'],
    [/生气|愤怒|angry/, '😡'],
    [/难过|伤心|sad/, '😢'],
    [/爱心|love/, '❤️'],
  ];

  const findLiteralEmoji = (): string | null => {
    for (const [pattern, emoji] of literalMap) {
      if (typeof pattern === 'string') {
        if (feedbackLower.includes(pattern)) return emoji;
      } else if (pattern.test(latestFeedback) || pattern.test(feedbackLower)) {
        return emoji;
      }
    }
    // 如果用户直接输入了 emoji 本身
    for (const ch of latestFeedback) {
      if (AVAILABLE_EMOJIS.includes(ch)) return ch;
    }
    return null;
  };

  // 如果用户直接提到了具体 emoji/物品，直接用真实组合，避免走两次 LLM
  const literalEmoji = findLiteralEmoji();
  if (literalEmoji) {
    const combos = await getCombinationsForEmoji(literalEmoji);
    const last = getLastFusion();
    let chosen = combos.find(c => !(last && c.leftEmoji === last[0] && c.rightEmoji === last[1])) || combos[0];

    if (chosen) {
      const url = await getFusionUrl(chosen.leftEmoji, chosen.rightEmoji);
      if (url) {
        saveFusion([chosen.leftEmoji, chosen.rightEmoji]);
        return {
          emojiFusion: [chosen.leftEmoji, chosen.rightEmoji],
          fusionUrl: url,
          rawResponse: { literal: literalEmoji, note: 'Literal keyword -> direct combo' }
        };
      }
    }
    // 若没有组合，回退自组合
    const fallbackUrl = await getFusionUrl(literalEmoji, literalEmoji);
    saveFusion([literalEmoji, literalEmoji]);
    return {
      emojiFusion: [literalEmoji, literalEmoji],
      fusionUrl: fallbackUrl,
      rawResponse: { literal: literalEmoji, note: 'Literal keyword fallback self' }
    };
  }
  
  // 优先选择常用的、与反馈相关的 emoji，确保包含食物、情绪等常用类别
  // 先提取常用的食物、情绪、活动类 emoji
  const foodEmojis = ['🍕', '🍔', '🍟', '🌮', '🌯', '🍗', '🍖', '🍝', '🍜', '🍲', '🍱', '🍣', '🍤', '🍙', '🍚', '🍛', '🍞', '🍩', '🍪', '🍰', '🍫', '🍬', '🍭', '🍮', '🍯'];
  const emotionEmojis = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '😗', '😙', '😚', '😛', '😜', '😝', '😞', '😟', '😠', '😡', '😢', '😣', '😤', '😥', '😦', '😧', '😨', '😩', '😪', '😫', '😬', '😭', '😮', '😯', '😰', '😱', '😲', '😳', '😴', '😵', '😶', '😷', '🤐', '🤑', '🤒', '🤓', '🤔', '🤕', '🤗', '🤠', '🤡', '🤢', '🤣', '🤤', '🤥', '🤧', '🤨', '🤩', '🤪', '🤫', '🤬', '🤭', '🤮', '🤯'];
  const activityEmojis = ['🏃', '💪', '🎮', '📚', '✏️', '🎵', '🎸', '✈️', '🌍', '🍻', '💃', '💼', '⏰', '💸', '🪙', '🪞', '👑'];
  const animalEmojis = ['🐷', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊'];
  
  // 合并并去重，然后补充其他 emoji
  const priorityEmojis = [...new Set([...foodEmojis, ...emotionEmojis, ...activityEmojis, ...animalEmojis])];
  const otherEmojis = AVAILABLE_EMOJIS.filter(e => !priorityEmojis.includes(e));
  const mainEmojiCandidates = [...priorityEmojis, ...otherEmojis].slice(0, 200).join(' ');

  // 优化后的 prompt，更明确地强调要根据反馈内容选择（友好、无冒犯）
  const systemPrompt = `选择一个主 emoji，表达用户当前的兴趣或情绪。从候选列表选一个：${mainEmojiCandidates}

规则映射（根据反馈内容选择）：
- 食物/想吃/饿了 → 🍕🍔🍟🌮🌯🍗🍜🍣
- 情绪积极/开心 → 😄😊😍
- 情绪低落/压力/焦虑 → 😢😰😱
- 游戏/宅/技术 → 🤓🎮💻🤖
- 社交/派对/聚会 → 🍻💃🎉
- 理财/预算/省钱 → 💸🪙💰
- 工作/忙碌 → 💼⏰📊
- 运动/健身 → 🏃💪🏋️
- 学习/读书 → 📚✏️📖
- 音乐/艺术 → 🎵🎸🎨
- 旅行/探索 → ✈️🌍🗺️
- 宠物/动物 → 🐶🐱🐻🐼

重要：
1. **仔细阅读用户最新反馈**，根据反馈的具体内容选择最相关的 emoji
2. 如果反馈提到具体食物或物品，优先选择对应 emoji
3. 保持多样化，避免总是相同选择
4. 选择的 emoji 必须在候选列表中，语气轻松友好

输出JSON: { "mainEmoji": "emoji字符" }`;

  // 限制反馈历史长度，但确保最新反馈完整
  const limitedHistory = recentHistory.length > 800 
    ? recentHistory.substring(0, 800) + '...' 
    : recentHistory;
  
  const userPrompt = `
    用户最新反馈（最重要）："${latestFeedback}"
    
    用户反馈历史（最近10条）：
    ${limitedHistory}
    
    任务：根据最新反馈选择一个主 emoji，轻松、有趣、无冒犯；如反馈提到食物（如"想吃披萨"），优先选食物相关 emoji（🍕🍔等）。
  `;

  try {
    // 第一步：让 LLM 选择主 emoji
    const step1Result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      "EmojiFusionStep1",
      true,
      3,
    );

    const mainEmoji = step1Result.mainEmoji || '';
    console.log(`[EmojiFusion] Step1 result:`, { mainEmoji, raw: step1Result });
    
    // 验证主 emoji 在支持列表中，如果不在，尝试从规则中查找
    let validMainEmoji = AVAILABLE_EMOJIS.includes(mainEmoji) ? mainEmoji : null;
    
    // 如果不在列表中，尝试根据反馈内容智能匹配
    if (!validMainEmoji && latestFeedback) {
      const feedbackLower = latestFeedback.toLowerCase();
      // 检查是否提到食物
      if (feedbackLower.includes('披萨') || feedbackLower.includes('pizza') || feedbackLower.includes('想吃') || feedbackLower.includes('饿了')) {
        validMainEmoji = AVAILABLE_EMOJIS.includes('🍕') ? '🍕' : (AVAILABLE_EMOJIS.includes('🍔') ? '🍔' : null);
        console.log(`[EmojiFusion] Auto-selected food emoji based on feedback: ${validMainEmoji}`);
      }
    }
    
    // 如果还是找不到，使用第一个可用的 emoji
    if (!validMainEmoji) {
      validMainEmoji = AVAILABLE_EMOJIS[0];
      console.warn(`[EmojiFusion] Main emoji ${mainEmoji} not in list, using fallback: ${validMainEmoji}`);
    }

    // 第二步：获取主 emoji 的所有可能组合（增加数量提供更多选择）
    const combinationsList = await getCombinationsListForPrompt(validMainEmoji, 50); // 从 20 增加到 50
    
    if (!combinationsList || combinationsList.includes('没有找到')) {
      // 如果主 emoji 没有组合，尝试主 emoji 和自己组合
      console.log(`[EmojiFusion] No combinations found for ${validMainEmoji}, trying self-combination`);
      const selfUrl = await getFusionUrl(validMainEmoji, validMainEmoji);
      if (selfUrl) {
        return {
          emojiFusion: [validMainEmoji, validMainEmoji],
          fusionUrl: selfUrl,
          rawResponse: { step1: step1Result, note: 'Using self-combination' }
        };
      }
      // 如果自己组合也不行，使用默认
      const defaultUrl = await getFusionUrl('😀', '😁');
      return {
        emojiFusion: ['😀', '😁'],
        fusionUrl: defaultUrl,
        rawResponse: { step1: step1Result, note: 'No combinations found, using default' }
      };
    }

    // 第三步：让 LLM 从组合列表中选择（限制组合列表长度）
    const limitedCombinationsList = combinationsList.length > 2000 
      ? combinationsList.substring(0, 2000) + '\n... (更多组合已省略)'
      : combinationsList;
    const limitedHistory = recentHistory.length > 800 
      ? recentHistory.substring(0, 800) + '...' 
      : recentHistory;
    
    // 优化后的简洁 prompt，强调多样化和根据最新反馈选择
    const step2SystemPrompt = `从真实组合里选择一个最契合用户反馈的 emoji 组合，轻松有趣但不冒犯；保持多样化，避免总是相同选择。

主emoji: ${validMainEmoji}
组合列表（真实存在，共${limitedCombinationsList.split('\n').length}个选项）：
${limitedCombinationsList}

重要提示：
- 根据用户最新反馈选择最合适的组合
- 要多样化，避免重复选择相同的组合
- 如果用户状态有明显变化，选择能反映变化的组合

输出JSON: { "selectedCombination": "emoji1 + emoji2" }`;

    const step2Result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: step2SystemPrompt },
        { role: "user", content: `用户反馈：${limitedHistory}\n\n选择一个最贴合反馈且不冒犯的组合。` }
      ],
      "EmojiFusionStep2",
      true,
      3,
    );

    // 解析选择的组合（支持多种格式）
    const selected = step2Result.selectedCombination || '';
    console.log(`[EmojiFusion] Step2 result:`, { selected, raw: step2Result });
    
    // 尝试多种解析方式
    let emojis: string[] = [];
    
    // 方式1: "emoji1 + emoji2"
    if (selected.includes('+')) {
      emojis = selected.split('+').map((e: string) => e.trim()).filter((e: string) => e && e.length > 0);
    }
    // 方式2: "emoji1 emoji2" (空格分隔)
    else if (selected.includes(' ')) {
      emojis = selected.split(' ').map((e: string) => e.trim()).filter((e: string) => e && e.length > 0);
    }
    // 方式3: 直接是两个 emoji 连在一起
    else if (selected.length >= 2) {
      // 尝试提取前两个 emoji（简单方法，可能不准确）
      const match = selected.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu);
      if (match && match.length >= 2) {
        emojis = [match[0], match[1]];
      }
    }
    
    // 验证 emoji 是否在支持列表中
    emojis = emojis.filter(e => AVAILABLE_EMOJIS.includes(e));
    
    if (emojis.length >= 2) {
      console.log(`[EmojiFusion] Parsed emojis:`, emojis);
      let finalPair: string[] = [emojis[0], emojis[1]];
      let finalUrl = await getFusionUrl(finalPair[0], finalPair[1]);

      const last = getLastFusion();
      if (last && last[0] === finalPair[0] && last[1] === finalPair[1]) {
        console.log('[EmojiFusion] Detected same as last fusion, trying alternative...');
        const combos = await getCombinationsForEmoji(validMainEmoji);
        const alt = combos.find(c => !(c.leftEmoji === last[0] && c.rightEmoji === last[1]));
        if (alt) {
          const altUrl = await getFusionUrl(alt.leftEmoji, alt.rightEmoji);
          if (altUrl) {
            finalPair = [alt.leftEmoji, alt.rightEmoji];
            finalUrl = altUrl;
            console.log('[EmojiFusion] Switched to alternate fusion to avoid repeat:', finalPair);
          }
        }
      }

      if (finalUrl) {
        saveFusion(finalPair);
        return {
          emojiFusion: finalPair,
          fusionUrl: finalUrl,
          rawResponse: { step1: step1Result, step2: step2Result }
        };
      } else {
        console.warn(`[EmojiFusion] Fusion URL not found for ${finalPair[0]} + ${finalPair[1]}`);
      }
    } else {
      console.warn(`[EmojiFusion] Failed to parse emojis from: "${selected}", parsed:`, emojis);
    }

    // 回退：使用主 emoji 的第一个组合
    const fallbackUrl = await getFusionUrl(validMainEmoji, validMainEmoji);
    saveFusion([validMainEmoji, validMainEmoji]);
    return {
      emojiFusion: [validMainEmoji, validMainEmoji],
      fusionUrl: fallbackUrl,
      rawResponse: { step1: step1Result, step2: step2Result, note: 'Fallback to self-combination' }
    };

  } catch (error: any) {
    console.error("Emoji Fusion Generation Error", error);
    const defaultUrl = await getFusionUrl('😀', '😁');
    return { 
      emojiFusion: ['😀', '😁'],
      fusionUrl: defaultUrl,
      rawResponse: `Error: ${error.message}`
    };
  }
};
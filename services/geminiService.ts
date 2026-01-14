import { FeedbackAnalysisResult, Post, UserProfile, TagAdjustment, WeightedTag } from "../types";
import { AVAILABLE_EMOJIS } from "../data/availableEmojis";
import { getCombinationsListForPrompt, getFusionUrl } from "./emojiCombinations";

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
  retries: number = 3
): Promise<any> {
  const effectiveKey = apiKey || DEFAULT_KEY;

  if (!effectiveKey) {
    throw new Error("No Groq API Key provided.");
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${effectiveKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: messages,
          temperature: 0.1, 
          max_tokens: 2048, // 增加到 2048 避免截断
          response_format: jsonMode ? { type: "json_object" } : undefined,
        }),
      });

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
      explicit_search_query: null
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

    4. **OUTPUT FORMAT**:
       JSON: { 
         "adjustments": [{ "tag": string, "category": "interest"|"dislike", "delta": number }], 
         "explicit_search_query": string | null,
         "user_note": string 
       }
       
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

    5. **SCALING**:
       - "I love this": Primary +6, Secondary +2
       - "Show me more": Primary +4
       - "I hate this": Dislike +8 (Strong filter)
       - "Not for me": Dislike +4
       - **MAX DELTA IS 10.**

    6. **EMPTY PROFILE HANDLING**:
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
    
    TASK: Identify Primary Driver, Secondary Contexts, and any Explicit Search Keywords. ${isProfileEmpty ? "Since profile is empty, you MUST add tags based on this feedback." : ""}
  `;

  try {
    const result = await callGroqWithRetry(
      providedKey,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      "Analysis"
    );

    return { ...result, rawResponse: result };

  } catch (error: any) {
    return { 
        adjustments: [], 
        user_note: `Analysis Failed. Error: ${error.message}` 
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

  const candidates = topPosts.map(p => `ID:${p.id} | Title:${p.title[language]}`).join('\n');
  
  const topInterests = userProfile.interests
    .sort((a,b) => b.weight - a.weight)
    .slice(0, 5)
    .map(i => i.tag)
    .join(', ');

  const systemPrompt = `
    You are a ranking engine. Re-order the provided posts based on the User's Profile and Explicit Request.
    
    USER PROFILE TOP INTERESTS: ${topInterests}
    ${explicitIntent ? `CURRENT USER REQUEST: "${explicitIntent}"` : ''}

    CONTEXT:
    The candidate list provided may be a MIX of:
    1. Posts that match the user's long-term interests (Weights).
    2. Posts that match a SPECIFIC KEYWORD SEARCH the user just made (if applicable).

    RULES:
    1. If the User Request is specific (e.g. "Show me jobs"), prioritize the posts that match that topic ABOVE general interests.
    2. Ensure the feed flows logically.
    3. Output strictly a JSON object: { "ids": ["id1", "id2", ...] }.
    4. Include ALL provided IDs.
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

  // 简洁的 prompt，生成嘲讽的用户名字
  const systemPrompt = `生成嘲讽的用户昵称（最多3个单词，英文）。基于用户反馈，用毒舌、搞笑、冒犯的方式。

示例：
- 爱约会/感情问题 → "dating weeb", "heartbreak hero", "simp master"
- 程序员/技术宅 → "horny programmer", "code monkey", "debug daddy"
- 健身/肌肉 → "muscle musician", "gym bro", "protein prince"
- 好人/老好人 → "Mr.nice guy", "yes man", "people pleaser"
- 游戏/宅 → "gaming gremlin", "anime addict", "console cowboy"
- 吃货 → "pizza person", "foodie fool", "snack seeker"

规则：
1. 最多3个单词，简短有力
2. 要嘲讽、冒犯、搞笑
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
    
    任务：生成或更新嘲讽的用户昵称。要毒舌、搞笑、冒犯。
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

export const generateUserPersonaDescription = async (
  feedbackHistory: string[],
  providedKey: string,
  existingDescription?: string
): Promise<{ description: string; rawResponse?: any }> => {
  
  if (feedbackHistory.length === 0) {
    return { 
      description: "新用户，等待更多反馈来描绘画像..."
    };
  }

  const recentHistory = feedbackHistory.slice(-10).join(" | ");
  const existingDesc = existingDescription || "无";

  // 优化后的简洁 prompt（保持功能但减少 token）
  const systemPrompt = `生成用户画像文字描述（200-400字）。只基于反馈文本和帖子内容，不涉及标签/emoji/技术。

内容：性格特征、生活经历、兴趣爱好、价值观、雷点、当前心理状态。可适度冒犯和幽默，但要基于证据。如有新发现要大胆更新。

输出JSON: { "description": "描述文本" }`;

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

    return {
      description: result.description || existingDescription || "画像生成中...",
      rawResponse: result
    };

  } catch (error: any) {
    console.error("Persona Description Generation Error", error);
    return { 
      description: existingDescription || "画像分析失败", 
      rawResponse: `Error: ${error.message}`
    };
  }
};

// --- STAGE 4B: EMOJI FUSION (Roasting/Satirical) ---
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

  // 优化后的 prompt，更明确地强调要根据反馈内容选择
  const systemPrompt = `选择主emoji来嘲讽用户。从候选列表选一个：${mainEmojiCandidates}

规则映射（根据反馈内容选择）：
- 提到食物/想吃/饿了 → 🍕🍔🍟🌮🌯🍗（优先选择食物相关）
- 肥胖/体重 → 🐷🍕
- 失恋/舔狗/感情问题 → 🤡💔
- 焦虑/压力/紧张 → 😰😱😨
- 宅/游戏/技术 → 🤓🎮💻
- 社交/派对/聚会 → 🍻💃🎉
- 穷/省钱/经济 → 💸🪙💰
- 自恋/炫耀 → 🪞👑✨
- 工作狂/忙碌 → 💼⏰📊
- 运动/健身 → 🏃💪🏋️
- 学习/读书 → 📚✏️📖
- 音乐/艺术 → 🎵🎸🎨
- 旅行/探索 → ✈️🌍🗺️

重要：
1. **仔细阅读用户最新反馈**，根据反馈的具体内容选择最相关的 emoji
2. 如果反馈提到"想吃披萨"，必须选择 🍕 或相关食物 emoji
3. 不要总是选相同的 emoji，要根据反馈内容变化
4. 选择的 emoji 必须在候选列表中

输出JSON: { "mainEmoji": "emoji字符" }`;

  // 限制反馈历史长度，但确保最新反馈完整
  const limitedHistory = recentHistory.length > 800 
    ? recentHistory.substring(0, 800) + '...' 
    : recentHistory;
  
  const userPrompt = `
    用户最新反馈（最重要）："${latestFeedback}"
    
    用户反馈历史（最近10条）：
    ${limitedHistory}
    
    任务：根据最新反馈选择一个主 emoji 来嘲讽用户。要毒舌、搞笑、冒犯。
    特别注意：如果最新反馈提到食物（如"想吃披萨"），必须选择食物相关的 emoji（🍕🍔等）。
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
    const step2SystemPrompt = `选择最嘲讽的emoji组合。根据用户最新反馈选择，要多样化，不要总是选相同的组合。

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
        { role: "user", content: `用户反馈：${limitedHistory}\n\n选择一个最嘲讽的组合。` }
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
      const fusionUrl = await getFusionUrl(emojis[0], emojis[1]);
      if (fusionUrl) {
        return {
          emojiFusion: [emojis[0], emojis[1]],
          fusionUrl: fusionUrl,
          rawResponse: { step1: step1Result, step2: step2Result }
        };
      } else {
        console.warn(`[EmojiFusion] Fusion URL not found for ${emojis[0]} + ${emojis[1]}`);
      }
    } else {
      console.warn(`[EmojiFusion] Failed to parse emojis from: "${selected}", parsed:`, emojis);
    }

    // 回退：使用主 emoji 的第一个组合
    const fallbackUrl = await getFusionUrl(validMainEmoji, validMainEmoji);
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
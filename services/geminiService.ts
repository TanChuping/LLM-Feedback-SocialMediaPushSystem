import { FeedbackAnalysisResult, Post, UserProfile, TagAdjustment } from "../types";

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
          max_tokens: 1024,
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
        throw new Error(`Groq API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

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

  // Limit vocabulary size to prevent context overflow, but keep enough for variety
  const vocabularyList = availableTags.slice(0, 300).join('", "');

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

    3. **EXPLICIT SEARCH INTENT**:
       - If the user explicitly says "Show me X", "I want to see Y", "Search for Z", extract "X Y Z" as a keyword string.
       - If they just say "I like this" or "This sucks", search intent is null.

    4. **OUTPUT FORMAT**:
       JSON: { 
         "adjustments": [{ "tag": string, "category": "interest"|"dislike", "delta": number }], 
         "explicit_search_query": string | null,
         "user_note": string 
       }

    5. **SCALING**:
       - "I love this": Primary +6, Secondary +2
       - "Show me more": Primary +4
       - "I hate this": Dislike +8 (Strong filter)
       - "Not for me": Dislike +4
       - **MAX DELTA IS 10.**
  `;

  const userPrompt = `
    CONTENT_CONTEXT: "${contentContext}"
    CURRENT_PROFILE: 
      - LIKES: [${profileInterests}]
      - DISLIKES: [${profileDislikes}]
    
    USER_FEEDBACK: "${feedbackText}"
    
    TASK: Identify Primary Driver, Secondary Contexts, and any Explicit Search Keywords.
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

    OUTPUT JSON: { "decay": [{ "tag": string, "delta": number }], "reason": string }
    
    RULES:
    1. **Contradiction Check**: If the user said "I hate gaming" 5 messages ago, but "Gaming" is still a high weight tag, decay it heavily.
    2. **Semantic Deduplication**: If "Coding" and "Computer Science" both exist, decay the lower weight one slightly to consolidate.
    3. **Short-term vs Long-term**: Prioritize recent feedback. If they liked "Cats" 10 messages ago but haven't mentioned it since, apply a small decay (-1).
    4. **Delta Range**: Must be negative (-1 to -8).
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

    const adjustments: TagAdjustment[] = (result.decay || []).map((d: any) => ({
      tag: d.tag,
      category: 'interest',
      delta: d.delta < 0 ? d.delta : -Math.abs(d.delta) // Ensure negative
    }));

    return { adjustments, reason: result.reason || "Routine cleanup" };

  } catch (error: any) {
    return { adjustments: [], reason: `Error: ${error.message}` };
  }
};
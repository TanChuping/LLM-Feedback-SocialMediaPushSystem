import { GoogleGenAI, Type, Schema } from "@google/genai";
import { FeedbackAnalysisResult } from "../types";

export const analyzeFeedback = async (
  feedbackText: string,
  contentContext: string,
  providedKey: string,
  availableTags: string[] 
): Promise<FeedbackAnalysisResult> => {
  
  const apiKey = providedKey || process.env.API_KEY || '';
  
  if (!apiKey) {
    console.error("API Key missing");
    return {
      adjustments: [{ tag: "Error: Key Missing", delta: 0, category: "dislike" }],
      user_note: "Please paste your API Key in the top right input box."
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelId = "gemini-3-flash-preview"; 

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      adjustments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            tag: { type: Type.STRING, description: "The tag name to adjust." },
            category: { type: Type.STRING, enum: ["interest", "dislike"], description: "Whether this modifies the Interest list or the Dislike list." },
            delta: { type: Type.NUMBER, description: "The amount to add or subtract (e.g., 20.0, -5.0)." },
          },
          required: ["tag", "category", "delta"]
        },
        description: "List of tags and how their weights should change.",
      },
      user_note: {
        type: Type.STRING,
        description: "A brief analysis of the user's psychological profile or intent.",
      },
    },
    required: ["adjustments", "user_note"],
  };

  const prompt = `
    You are a recommendation system alignment engine.
    
    Context:
    User provided feedback on a post via the 'More' menu.
    Post Details: "${contentContext}"
    User Feedback: "${feedbackText}"
    
    *** AVAILABLE TAG POOL ***
    ${availableTags.join(', ')}
    **************************
    
    CRITICAL INSTRUCTION ON TAG TYPES:
    1. **TOPIC Tags** (Specific Subject): Gaming, AI/ML, CS, Cars, Fashion, Kpop, Politics.
    2. **VIBE Tags** (General Atmosphere): Social Life, Party, Fun, Rant, Discussion, Advice.
    
    LOGIC RULES:
    1. **Precision Targeting**:
       - If feedback is NEGATIVE ("Not interested", "Hate this"): Target the **TOPIC Tag** in the Dislike list.
         - Example: Dislike "Gaming Party" -> Dislike "Gaming" (+20). Do not punish "Party" unless explicitly stated.
       - If feedback is POSITIVE ("More like this", "Love it"): Target the **TOPIC Tag** in the Interest list.
         - Example: Like "Gaming Party" -> Interest "Gaming" (+20).

    2. **Veto Logic (For Dislikes)**: If user expresses strong hate ("Hate this", "Remove", "Not this"), give a HUGE delta (20+) to the Disliked Topic. The system uses a Veto mechanism for weights >= 10.

    3. **Cross-Cleaning**: If user wants "Fun" but hates "Gaming", you must:
       - Interest: Fun, Social Life, Party (+15)
       - Dislike: Gaming (+20)
       - This ensures "Fun" stays high, but "Gaming" gets vetoed.

    Analyze the user's feedback and generate adjustments.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    
    return JSON.parse(text) as FeedbackAnalysisResult;

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return {
      adjustments: [],
      user_note: "Failed to analyze. Please check if your API Key is valid."
    };
  }
};
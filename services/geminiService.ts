import { GoogleGenAI, Type, Schema } from "@google/genai";
import { FeedbackAnalysisResult } from "../types";

export const analyzeFeedback = async (
  feedbackText: string,
  contentContext: string,
  providedKey: string,
  availableTags: string[] // NEW: Pass the Tag Pool
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
            tag: { type: Type.STRING, description: "The tag name to adjust. MUST exist in the provided 'Available Tags' list unless absolutely necessary." },
            category: { type: Type.STRING, enum: ["interest", "dislike"], description: "Whether this modifies the Interest list or the Dislike list." },
            delta: { type: Type.NUMBER, description: "The amount to add or subtract (e.g., 5.0, -3.5). Positive numbers increase the weight." },
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
    User clicked 'Not Interested' on a post.
    Post Details: "${contentContext}"
    User Feedback: "${feedbackText}"
    
    *** AVAILABLE TAG POOL (READ ONLY) ***
    ${availableTags.join(', ')}
    **************************************
    
    Task:
    Analyze user intent and output tag adjustments.
    
    CRITICAL RULES:
    1. **STRICT TAG MATCHING**: You MUST use tags from the "AVAILABLE TAG POOL" above whenever possible. Only create a new tag if the concept is completely missing from the pool.
    2. **Skill Gap vs. Dislike**: 
       - If user says "Too hard" or "I don't understand":
       - Dislike tags like 'Advanced', 'Hardcore', 'Theory'.
       - Interest tags like 'Beginner Friendly', 'Guide', 'Tutorial'.
    3. **Tone Matching**: 
       - If user dislikes "Rant" or "Negative" content, downrank those tags and uprank "Inspirational" or "Practical".
       - If user hates "Clickbait", punish that tag.
    4. **Solution Seeking (CRITICAL)**:
       - If the user expresses worry but asks for solutions (e.g., "Is there a fix?", "How to solve?", "I'm worried too"), this is a STRONG signal.
       - You MUST Apply a **LARGE** positive delta (+15.0 or more) to the core Topic tags (e.g., 'Visa', 'H1B', 'Career').
       - You MUST Apply a positive delta to solution-oriented tags (e.g., 'Guide', 'Strategy', 'Advice').
       - You SHOULD Apply a dislike delta to 'Anxiety' or 'Rant' if the user seems tired of complaining.
    
    Example 1 (User finds it too hard):
    Input: "I don't understand the math."
    Output: 
    [
      { "tag": "Beginner Friendly", "category": "interest", "delta": 10.0 },
      { "tag": "Math Heavy", "category": "dislike", "delta": 8.0 },
      { "tag": "Theory", "category": "dislike", "delta": 5.0 }
    ]
    
    Example 2 (Solution Seeking):
    Input: "This is scary, do we have other options?" (Context: H1B Rant)
    Output:
    [
       { "tag": "Visa", "category": "interest", "delta": 15.0 },
       { "tag": "Strategy", "category": "interest", "delta": 10.0 },
       { "tag": "Anxiety", "category": "dislike", "delta": 8.0 }
    ]

    Be precise with deltas.
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
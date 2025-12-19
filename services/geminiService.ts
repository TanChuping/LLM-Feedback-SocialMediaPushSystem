import { GoogleGenAI, Type, Schema } from "@google/genai";
import { FeedbackAnalysisResult } from "../types";

export const analyzeFeedback = async (
  feedbackText: string,
  contentContext: string,
  providedKey?: string // Allow passing key from UI
): Promise<FeedbackAnalysisResult> => {
  
  // Use the key provided from UI, or fallback to env if available
  const apiKey = providedKey || process.env.API_KEY || '';
  
  if (!apiKey) {
    console.error("API Key missing");
    return {
      dislike_tags: ["Error: Key Missing"],
      user_note: "Please paste your API Key in the top right input box."
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  // Using Gemini 3 Flash Preview as the recommended fast model
  const modelId = "gemini-3-flash-preview"; 

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      dislike_tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "A list of precise tags inferred from the feedback that the user dislikes.",
      },
      user_note: {
        type: Type.STRING,
        description: "A brief analysis of the user's psychological profile or intent based on the feedback.",
      },
    },
    required: ["dislike_tags", "user_note"],
  };

  const prompt = `
    You are a recommendation system alignment assistant.
    The user is browsing a social media feed about education and career growth.
    
    Context: The user clicked 'Not Interested' on a post with these details: "${contentContext}".
    User Feedback: "${feedbackText}"
    
    Task:
    1. Analyze the feedback to understand *why* the user disliked it.
    2. Extract new 'dislike_tags'.
    3. Provide a 'user_note'.

    Output: JSON
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
      dislike_tags: ["API Error"],
      user_note: "Failed to analyze. Please check if your API Key is valid."
    };
  }
};
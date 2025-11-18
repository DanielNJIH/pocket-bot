import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logError } from '../../utils/logger.js';

function normalizeModelName(name) {
  if (!name) return 'gemini-1.5-flash';
  return name.replace(/-latest$/, '');
}

const client = new GoogleGenerativeAI(env.geminiApiKey);
const modelName = normalizeModelName(env.geminiModel);
const model = client.getGenerativeModel({ model: modelName });

export async function generateResponse(prompt) {
  try {
    const result = await model.generateContent([{ text: prompt }]);
    return result.response.text().trim();
  } catch (err) {
    logError('Gemini generateContent failed', err);
    throw err;
  }
}

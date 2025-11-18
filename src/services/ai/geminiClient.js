import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';

const client = new GoogleGenerativeAI(env.geminiApiKey);
const model = client.getGenerativeModel({ model: env.geminiModel });

export async function generateResponse(prompt) {
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

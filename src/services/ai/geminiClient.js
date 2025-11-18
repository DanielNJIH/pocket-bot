import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';

const client = new GoogleGenerativeAI(env.geminiApiKey);
const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function generateResponse(prompt) {
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

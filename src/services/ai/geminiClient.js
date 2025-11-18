import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logError } from '../../utils/logger.js';

const client = new GoogleGenerativeAI(env.geminiApiKey);

function buildModelCandidates(modelName) {
  const names = [];

  if (modelName) {
    names.push(modelName);
    if (!/-latest$/.test(modelName)) {
      names.push(`${modelName}-latest`);
    }
  }

  if (!names.length) {
    names.push('gemini-2.0-flash');
  }

  return [...new Set(names)];
}

async function attemptGeneration(modelName, prompt) {
  const model = client.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([{ text: prompt }]);
  return result.response.text().trim();
}

export async function generateResponse(prompt) {
  const candidates = buildModelCandidates(env.geminiModel);
  let lastError;

  for (const name of candidates) {
    try {
      return await attemptGeneration(name, prompt);
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const message = err?.message || '';
      const isNotFound = status === 404 || /not found/i.test(message);
      lastError = err;

      if (!isNotFound) {
        logError(`Gemini generateContent failed for model ${name}`, err);
        throw err;
      }

      logError(`Gemini model ${name} unavailable, trying next candidate`, { status, message });
    }
  }

  throw lastError || new Error(`All Gemini model attempts failed: ${candidates.join(', ')}`);
}

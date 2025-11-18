import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logError } from '../../utils/logger.js';

const client = new GoogleGenerativeAI(env.geminiApiKey);

function buildModelCandidates(modelName) {
  const names = [];

  if (modelName) {
    names.push(modelName);
    // If the configured model omits the "-latest" alias, try adding it as a fallback.
    if (!/-latest$/.test(modelName)) {
      names.push(`${modelName}-latest`);
    }
  }

  // Always include sensible defaults last.
  names.push(
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-latest'
  );

  // Deduplicate while preserving order.
  return [...new Set(names)];
}

async function attemptGeneration(modelName, prompt) {
  const model = client.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([{ text: prompt }]);
  return result.response.text().trim();
}

export async function generateResponse(prompt) {
  const candidates = buildModelCandidates(env.geminiModel);

  for (const name of candidates) {
    try {
      return await attemptGeneration(name, prompt);
    } catch (err) {
      // Retry on model lookup errors, rethrow everything else.
      const status = err?.status || err?.response?.status;
      const message = err?.message || '';
      const isNotFound = status === 404 || /not found/i.test(message);

      logError(`Gemini generateContent failed for model ${name}`, err);

      if (!isNotFound) {
        throw err;
      }
    }
  }

  throw new Error(`All Gemini model attempts failed: ${candidates.join(', ')}`);
}

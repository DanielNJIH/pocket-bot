import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logError } from '../../utils/logger.js';
import { getActiveGeminiKeys, maskGeminiKey } from './geminiKeyService.js';

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

async function attemptGeneration(client, modelName, prompt) {
  const model = client.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([{ text: prompt }]);
  return result.response.text().trim();
}

function isModelNotFound(err) {
  const status = err?.status || err?.response?.status;
  const message = err?.message || '';
  return status === 404 || /not found/i.test(message);
}

function isAuthError(err) {
  const status = err?.status || err?.response?.status;
  return status === 401 || status === 403;
}

export async function generateResponse(prompt, pool) {
  const candidates = buildModelCandidates(env.geminiModel);
  const keys = await getActiveGeminiKeys(pool);

  if (!keys.length) {
    throw new Error('No Gemini API keys configured.');
  }

  let lastError;

  for (const key of keys) {
    const client = new GoogleGenerativeAI(key);

    for (const name of candidates) {
      try {
        return await attemptGeneration(client, name, prompt);
      } catch (err) {
        lastError = err;
        const status = err?.status || err?.response?.status;
        const message = err?.message || '';

        if (isModelNotFound(err)) {
          logError(`Gemini model ${name} unavailable, trying next candidate`, { status, message });
          continue;
        }

        if (isAuthError(err)) {
          logError('Gemini API key rejected, trying fallback', {
            status,
            message,
            key: maskGeminiKey(key)
          });
          break;
        }

        logError(`Gemini generateContent failed for model ${name}`, err);
        break;
      }
    }
  }

  throw lastError || new Error(`All Gemini model attempts failed: ${candidates.join(', ')}`);
}

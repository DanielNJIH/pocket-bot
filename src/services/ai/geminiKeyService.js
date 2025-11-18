import { env } from '../../config/env.js';

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function maskGeminiKey(key) {
  return maskKey(key);
}

export async function getActiveGeminiKeys(pool) {
  const [rows] = await pool.query('SELECT api_key FROM gemini_api_keys WHERE active = 1 ORDER BY id ASC');
  const keys = rows.map((row) => row.api_key).filter(Boolean);

  if (env.geminiApiKey && !keys.includes(env.geminiApiKey)) {
    keys.unshift(env.geminiApiKey);
  }

  return keys;
}

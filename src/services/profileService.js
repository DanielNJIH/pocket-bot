import { logDebug } from '../utils/logger.js';

function parseJson(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (err) {
    return undefined;
  }
}

export async function ensureUserRecord(pool, discordUserId) {
  const [rows] = await pool.query('SELECT * FROM users WHERE discord_user_id = ?', [discordUserId]);
  if (rows.length) {
    return rows[0];
  }
  await pool.query('INSERT INTO users (discord_user_id) VALUES (?)', [discordUserId]);
  logDebug('Created user row', { discordUserId });
  return ensureUserRecord(pool, discordUserId);
}

export async function getUserProfile(pool, discordUserId) {
  const user = await ensureUserRecord(pool, discordUserId);
  return {
    ...user,
    preferences: parseJson(user.preferences),
    codewords: parseJson(user.codewords) || []
  };
}

export async function upsertUserPreference(pool, discordUserId, preferences) {
  await ensureUserRecord(pool, discordUserId);
  await pool.query('UPDATE users SET preferences = ? WHERE discord_user_id = ?', [
    JSON.stringify(preferences || {}),
    discordUserId
  ]);
}

export async function upsertCodewords(pool, discordUserId, codewords) {
  await ensureUserRecord(pool, discordUserId);
  await pool.query('UPDATE users SET codewords = ? WHERE discord_user_id = ?', [
    JSON.stringify(codewords || []),
    discordUserId
  ]);
}

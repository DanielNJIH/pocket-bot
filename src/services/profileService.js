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

export async function getUserProfile(pool, discordUserId, { discordName } = {}) {
  const user = await ensureUserRecord(pool, discordUserId);
  return {
    ...user,
    discord_name: discordName,
    preferences: parseJson(user.preferences),
    codewords: parseJson(user.codewords) || []
  };
}

export async function updateDisplayName(pool, discordUserId, displayName) {
  await ensureUserRecord(pool, discordUserId);
  await pool.query('UPDATE users SET display_name = ? WHERE discord_user_id = ?', [
    displayName,
    discordUserId
  ]);
}

export async function updateAbout(pool, discordUserId, about) {
  await ensureUserRecord(pool, discordUserId);
  await pool.query('UPDATE users SET about = ? WHERE discord_user_id = ?', [about, discordUserId]);
}

export async function updateBirthday(pool, discordUserId, birthday) {
  await ensureUserRecord(pool, discordUserId);
  await pool.query('UPDATE users SET birthday = ? WHERE discord_user_id = ?', [birthday, discordUserId]);
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

export async function findUserByDisplayName(pool, name) {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const [rows] = await pool.query('SELECT * FROM users WHERE LOWER(display_name) = ? LIMIT 1', [normalized]);
  return rows[0] || null;
}

export async function getUserByDiscordId(pool, discordUserId) {
  const [rows] = await pool.query('SELECT * FROM users WHERE discord_user_id = ?', [discordUserId]);
  return rows[0] || null;
}

export async function getGuildUserProfiles(pool, discordGuildId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.*, s.xp, s.level
     FROM users u
     JOIN user_guild_stats s ON s.user_id = u.id
     JOIN guilds g ON g.id = s.guild_id
     WHERE g.discord_guild_id = ?`,
    [discordGuildId]
  );

  return rows.map((row) => ({
    ...row,
    preferences: parseJson(row.preferences),
    codewords: parseJson(row.codewords) || []
  }));
}

export function serializePreferences(preferencesText) {
  if (!preferencesText) return {};
  return { notes: preferencesText };
}

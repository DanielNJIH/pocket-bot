import { logDebug } from '../utils/logger.js';

function parseJson(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (err) {
    return undefined;
  }
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function getOrCreateUser(pool, discordUserId) {
  const [rows] = await pool.query('SELECT * FROM users WHERE discord_user_id = ?', [discordUserId]);
  if (rows.length) {
    return rows[0];
  }
  await pool.query('INSERT INTO users (discord_user_id) VALUES (?)', [discordUserId]);
  logDebug('Created user row', { discordUserId });
  return getOrCreateUser(pool, discordUserId);
}

export async function getUserProfileByDiscordId(pool, discordUserId, { discordName } = {}) {
  const user = await getOrCreateUser(pool, discordUserId);
  return {
    ...user,
    discord_name: discordName,
    preferences: parseJson(user.preferences),
    codewords: parseJson(user.codewords) || []
  };
}

export const getUserProfile = getUserProfileByDiscordId;

export async function updateDisplayName(pool, discordUserId, displayName) {
  await getOrCreateUser(pool, discordUserId);
  await pool.query('UPDATE users SET display_name = ? WHERE discord_user_id = ?', [
    displayName,
    discordUserId
  ]);
}

export async function updateAbout(pool, discordUserId, about) {
  await getOrCreateUser(pool, discordUserId);
  await pool.query('UPDATE users SET about = ? WHERE discord_user_id = ?', [about, discordUserId]);
}

export async function updateBirthday(pool, discordUserId, birthday) {
  await getOrCreateUser(pool, discordUserId);
  await pool.query('UPDATE users SET birthday = ? WHERE discord_user_id = ?', [birthday, discordUserId]);
}

export async function upsertUserPreference(pool, discordUserId, preferences) {
  await getOrCreateUser(pool, discordUserId);
  await pool.query('UPDATE users SET preferences = ? WHERE discord_user_id = ?', [
    JSON.stringify(preferences || {}),
    discordUserId
  ]);
}

export async function upsertCodewords(pool, discordUserId, codewords) {
  await getOrCreateUser(pool, discordUserId);
  await pool.query('UPDATE users SET codewords = ? WHERE discord_user_id = ?', [
    JSON.stringify(codewords || []),
    discordUserId
  ]);
}

export async function findUserByDisplayName(pool, name) {
  if (!name) return null;
  const normalized = name.trim();
  if (!normalized) return null;
  const pattern = `%${escapeLikePattern(normalized)}%`;
  const [rows] = await pool.query(
    `SELECT *
       FROM users
      WHERE display_name IS NOT NULL
        AND LOWER(display_name) LIKE LOWER(?)
      ORDER BY CHAR_LENGTH(display_name) ASC
      LIMIT 1`,
    [pattern]
  );
  return rows[0] || null;
}

export async function findUserProfileByDisplayName(pool, name, options = {}) {
  const user = await findUserByDisplayName(pool, name);
  if (!user) return null;
  return getUserProfileByDiscordId(pool, user.discord_user_id, options);
}

export async function getUserByDiscordId(pool, discordUserId) {
  const [rows] = await pool.query('SELECT * FROM users WHERE discord_user_id = ?', [discordUserId]);
  return rows[0] || null;
}

export async function getGuildUserProfiles(pool, guildId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.*, s.xp, s.level
       FROM users u
       JOIN user_guild_stats s ON s.user_id = u.id
      WHERE s.guild_id = ?`,
    [guildId]
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

export { getOrCreateUser as ensureUserRecord };

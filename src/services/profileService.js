import { logDebug } from '../utils/logger.js';

function parseJson(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (err) {
    return undefined;
  }
}

function parsePersonaSettings(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function normalizePersonaSettings(settings = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!value) continue;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      normalized[key] = trimmed;
    }
  }
  return normalized;
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
    codewords: parseJson(user.codewords) || [],
    persona_settings: parsePersonaSettings(user.persona_settings)
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

export async function getPersonaSettings(pool, discordUserId) {
  const user = await ensureUserRecord(pool, discordUserId);
  return parsePersonaSettings(user.persona_settings);
}

export async function updatePersonaSettings(pool, discordUserId, updates) {
  const user = await ensureUserRecord(pool, discordUserId);
  const current = parsePersonaSettings(user.persona_settings);
  const merged = normalizePersonaSettings({ ...current, ...(updates || {}) });
  const payload = Object.keys(merged).length ? JSON.stringify(merged) : null;
  await pool.query('UPDATE users SET persona_settings = ? WHERE discord_user_id = ?', [payload, discordUserId]);
  return merged;
}

export async function clearPersonaSettings(pool, discordUserId, keys) {
  const user = await ensureUserRecord(pool, discordUserId);
  let current = parsePersonaSettings(user.persona_settings);
  if (Array.isArray(keys) && keys.length) {
    for (const key of keys) {
      delete current[key];
    }
  } else {
    current = {};
  }
  const normalized = normalizePersonaSettings(current);
  const payload = Object.keys(normalized).length ? JSON.stringify(normalized) : null;
  await pool.query('UPDATE users SET persona_settings = ? WHERE discord_user_id = ?', [payload, discordUserId]);
  return normalized;
}

export function summarizePersonaSettings(settings) {
  const normalized = normalizePersonaSettings(settings);
  const entries = Object.entries(normalized);
  if (!entries.length) {
    return 'none';
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join(' | ');
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

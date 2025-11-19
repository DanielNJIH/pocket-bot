import { DEFAULT_LEVEL_THRESHOLDS } from '../config/constants.js';
import { logDebug } from '../utils/logger.js';

export async function getOrCreateGuild(pool, discordGuildId) {
  const [existing] = await pool.query(
    `SELECT g.*, u.discord_user_id AS selected_discord_user_id
       FROM guilds g
       LEFT JOIN users u ON g.selected_user_id = u.id
      WHERE g.discord_guild_id = ?
      LIMIT 1`,
    [discordGuildId]
  );

  if (existing.length) {
    return existing[0];
  }

  await pool.query('INSERT INTO guilds (discord_guild_id) VALUES (?)', [discordGuildId]);
  logDebug('Created default guild row', { discordGuildId });
  return getOrCreateGuild(pool, discordGuildId);
}

export async function updateSelectedUser(pool, guildId, userId) {
  await pool.query('UPDATE guilds SET selected_user_id = ? WHERE id = ?', [userId, guildId]);
}

export async function setBirthdayChannel(pool, guildId, channelId) {
  await pool.query('UPDATE guilds SET birthday_channel_id = ? WHERE id = ?', [channelId, guildId]);
}

export async function setXpAnnouncementChannel(pool, guildId, channelId) {
  await pool.query('UPDATE guilds SET xp_announcement_channel_id = ? WHERE id = ?', [
    channelId,
    guildId
  ]);
}

export async function setXpPerInteraction(pool, guildId, amount) {
  await pool.query('UPDATE guilds SET xp_per_interaction = ? WHERE id = ?', [amount, guildId]);
}

export async function toggleXp(pool, guildId, enabled) {
  await pool.query('UPDATE guilds SET xp_enabled = ? WHERE id = ?', [enabled ? 1 : 0, guildId]);
}

export async function updateLanguages(pool, guildId, { primary, secondary, secondaryEnabled }) {
  await pool.query(
    'UPDATE guilds SET primary_language = ?, secondary_language = ?, secondary_language_enabled = ? WHERE id = ?',
    [primary, secondary || null, secondaryEnabled ? 1 : 0, guildId]
  );
}

export async function getLevelThresholds(pool, guildId) {
  const [rows] = await pool.query(
    'SELECT level, threshold FROM xp_levels WHERE guild_id = ? ORDER BY level ASC',
    [guildId]
  );
  return rows.length ? rows : DEFAULT_LEVEL_THRESHOLDS;
}

export async function getLevelRoles(pool, guildId) {
  const [rows] = await pool.query(
    'SELECT level, role_id FROM level_roles WHERE guild_id = ? ORDER BY level ASC',
    [guildId]
  );
  return rows;
}

export { getOrCreateGuild as ensureGuildRecord };

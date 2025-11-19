import { DEFAULT_LEVEL_THRESHOLDS } from '../config/constants.js';
import { env } from '../config/env.js';
import { logDebug } from '../utils/logger.js';

function isGuildRow(value) {
  return value && typeof value === 'object' && 'id' in value;
}

async function resolveGuildScope(pool, guild) {
  if (isGuildRow(guild)) {
    return { guildId: guild.id, discordGuildId: guild.discord_guild_id };
  }

  const guildId = guild;
  const [rows] = await pool.query('SELECT discord_guild_id FROM guilds WHERE id = ? LIMIT 1', [guildId]);
  return { guildId, discordGuildId: rows[0]?.discord_guild_id || null };
}

export async function ensureGuildRecord(pool, discordGuildId) {
  const [existing] = await pool.query(
    `SELECT g.*, u.discord_user_id AS selected_discord_user_id
     FROM guilds g
     LEFT JOIN users u ON g.selected_user_id = u.id
     WHERE g.discord_guild_id = ? AND g.bot_instance = ?`,
    [discordGuildId, env.botInstance]
  );

  if (existing.length) {
    return existing[0];
  }

  await pool.query('INSERT INTO guilds (discord_guild_id, bot_instance) VALUES (?, ?)', [
    discordGuildId,
    env.botInstance
  ]);
  logDebug('Created default guild row', { discordGuildId, botInstance: env.botInstance });
  return ensureGuildRecord(pool, discordGuildId);
}

export async function updateSelectedUser(pool, guildId, userId) {
  await pool.query('UPDATE guilds SET selected_user_id = ? WHERE id = ?', [userId, guildId]);
}

export async function setBirthdayChannel(pool, guild, channelId) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    await pool.query('UPDATE guilds SET birthday_channel_id = ? WHERE discord_guild_id = ?', [
      channelId,
      discordGuildId
    ]);
    return;
  }
  await pool.query('UPDATE guilds SET birthday_channel_id = ? WHERE id = ?', [channelId, guildId]);
}

export async function setXpAnnouncementChannel(pool, guild, channelId) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    await pool.query('UPDATE guilds SET xp_announcement_channel_id = ? WHERE discord_guild_id = ?', [
      channelId,
      discordGuildId
    ]);
    return;
  }
  await pool.query('UPDATE guilds SET xp_announcement_channel_id = ? WHERE id = ?', [channelId, guildId]);
}

export async function setXpPerInteraction(pool, guild, amount) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    await pool.query('UPDATE guilds SET xp_per_interaction = ? WHERE discord_guild_id = ?', [
      amount,
      discordGuildId
    ]);
    return;
  }
  await pool.query('UPDATE guilds SET xp_per_interaction = ? WHERE id = ?', [amount, guildId]);
}

export async function toggleXp(pool, guild, enabled) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    await pool.query('UPDATE guilds SET xp_enabled = ? WHERE discord_guild_id = ?', [
      enabled ? 1 : 0,
      discordGuildId
    ]);
    return;
  }
  await pool.query('UPDATE guilds SET xp_enabled = ? WHERE id = ?', [enabled ? 1 : 0, guildId]);
}

export async function updateLanguages(pool, guild, { primary, secondary, secondaryEnabled }) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  const params = [primary, secondary || null, secondaryEnabled ? 1 : 0];
  if (discordGuildId) {
    await pool.query(
      'UPDATE guilds SET primary_language = ?, secondary_language = ?, secondary_language_enabled = ? WHERE discord_guild_id = ?',
      [...params, discordGuildId]
    );
    return;
  }
  await pool.query(
    'UPDATE guilds SET primary_language = ?, secondary_language = ?, secondary_language_enabled = ? WHERE id = ?',
    [...params, guildId]
  );
}

export async function getLevelThresholds(pool, guildId) {
  const [rows] = await pool.query(
    'SELECT level, threshold FROM xp_levels WHERE guild_id = ? ORDER BY level ASC',
    [guildId]
  );
  return rows.length ? rows : DEFAULT_LEVEL_THRESHOLDS;
}

export async function getLevelRoles(pool, guild) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    const [sharedRows] = await pool.query(
      `SELECT lr.level, lr.role_id
       FROM level_roles lr
       JOIN guilds g ON g.id = lr.guild_id
       WHERE g.discord_guild_id = ?
       ORDER BY lr.level ASC`,
      [discordGuildId]
    );
    if (sharedRows.length) {
      return sharedRows;
    }
  }

  const [rows] = await pool.query(
    'SELECT level, role_id FROM level_roles WHERE guild_id = ? ORDER BY level ASC',
    [guildId]
  );
  return rows;
}

import { DEFAULT_LEVEL_THRESHOLDS } from '../config/constants.js';
import { logDebug } from '../utils/logger.js';

export async function ensureGuildRecord(pool, discordGuildId) {
  const [existing] = await pool.query(
    `SELECT g.*, u.discord_user_id AS selected_discord_user_id
     FROM guilds g
     LEFT JOIN users u ON g.selected_user_id = u.id
     WHERE g.discord_guild_id = ?`,
    [discordGuildId]
  );

  if (existing.length) {
    return existing[0];
  }

  await pool.query('INSERT INTO guilds (discord_guild_id) VALUES (?)', [discordGuildId]);
  logDebug('Created default guild row', { discordGuildId });
  return ensureGuildRecord(pool, discordGuildId);
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

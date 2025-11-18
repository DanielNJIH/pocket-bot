import { getLevelRoles, getLevelThresholds } from './guildSettingsService.js';
import { logDebug } from '../utils/logger.js';

export async function ensureUserGuildStats(pool, userId, guildId) {
  const [rows] = await pool.query(
    'SELECT * FROM user_guild_stats WHERE user_id = ? AND guild_id = ?',
    [userId, guildId]
  );
  if (rows.length) return rows[0];

  await pool.query(
    'INSERT INTO user_guild_stats (user_id, guild_id, xp, level) VALUES (?, ?, 0, 1)',
    [userId, guildId]
  );
  logDebug('Created stats row', { userId, guildId });
  return ensureUserGuildStats(pool, userId, guildId);
}

function calculateLevel(xp, thresholds) {
  let level = 1;
  for (const entry of thresholds) {
    if (xp >= entry.threshold) {
      level = entry.level;
    }
  }
  return level;
}

export async function awardInteractionXp(pool, guildRow, userProfile) {
  if (!guildRow.xp_enabled) {
    return { awarded: 0, leveledUp: false };
  }

  const guildId = guildRow.id;
  const thresholds = await getLevelThresholds(pool, guildId);
  const stats = await ensureUserGuildStats(pool, userProfile.id, guildId);
  const amount = guildRow.xp_per_interaction || 0;

  if (!amount) {
    return { awarded: 0, leveledUp: false };
  }

  const newXp = stats.xp + amount;
  const newLevel = calculateLevel(newXp, thresholds);
  const leveledUp = newLevel > stats.level;

  await pool.query(
    'UPDATE user_guild_stats SET xp = ?, level = ?, last_xp_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newXp, newLevel, stats.id]
  );

  let unlockedRole = null;
  if (leveledUp) {
    const roles = await getLevelRoles(pool, guildId);
    const role = roles
      .sort((a, b) => b.level - a.level)
      .find((entry) => newLevel >= entry.level);
    unlockedRole = role?.role_id || null;
  }

  return { awarded: amount, leveledUp, newLevel, newXp, unlockedRole };
}

export async function getUserStats(pool, guildId, userId) {
  return ensureUserGuildStats(pool, userId, guildId);
}

export async function resetUserStats(pool, guildId, userId) {
  const stats = await ensureUserGuildStats(pool, userId, guildId);
  await pool.query('UPDATE user_guild_stats SET xp = 0, level = 1 WHERE id = ?', [stats.id]);
  return { ...stats, xp: 0, level: 1 };
}

export async function getLeaderboard(pool, guildId, limit = 10) {
  const [rows] = await pool.query(
    `SELECT u.discord_user_id, u.display_name, s.xp, s.level
     FROM user_guild_stats s
     JOIN users u ON u.id = s.user_id
     WHERE s.guild_id = ?
     ORDER BY s.xp DESC
     LIMIT ?`,
    [guildId, limit]
  );
  return rows;
}

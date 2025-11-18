import { getLevelRoles, getLevelThresholds } from './guildSettingsService.js';
import { logDebug } from '../utils/logger.js';

const XP_COOLDOWN_MS = 5000;
const MAX_LEVEL = 999;
const LEVEL_BLOCK_SIZE = 5;
const LEVEL_BLOCK_GROWTH = 0.2; // 20% every 5 levels

function getBaseGap(thresholds) {
  if (!thresholds?.length) return 100;

  const sorted = [...thresholds]
    .filter((entry) => typeof entry?.level === 'number' && typeof entry?.threshold === 'number')
    .sort((a, b) => a.level - b.level);

  let smallestGap = Infinity;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].threshold - sorted[i - 1].threshold;
    if (gap > 0 && gap < smallestGap) {
      smallestGap = gap;
    }
  }

  return Number.isFinite(smallestGap) ? smallestGap : 100;
}

function buildThresholds(thresholds) {
  const sorted = [...thresholds]
    .filter((entry) => typeof entry?.level === 'number' && typeof entry?.threshold === 'number')
    .sort((a, b) => a.level - b.level);

  const provided = new Map(sorted.map((entry) => [entry.level, entry.threshold]));
  const baseThreshold = provided.get(1) ?? 0;
  const baseGap = getBaseGap(sorted);

  const scaled = [{ level: 1, threshold: baseThreshold }];
  let runningThreshold = baseThreshold;

  for (let level = 2; level <= MAX_LEVEL; level += 1) {
    const providedThreshold = provided.get(level);
    if (typeof providedThreshold === 'number') {
      runningThreshold = providedThreshold;
    } else {
      const blockIndex = Math.floor((level - 2) / LEVEL_BLOCK_SIZE);
      const gap = Math.max(Math.round(baseGap * (1 + LEVEL_BLOCK_GROWTH * blockIndex)), 1);
      runningThreshold += gap;
    }

    scaled.push({ level, threshold: runningThreshold });
  }

  return scaled;
}

// Fetch configured level thresholds and expand them with the scaling rules.
async function loadThresholdsWithScaling(pool, guildId) {
  const thresholds = await getLevelThresholds(pool, guildId);
  return buildThresholds(thresholds);
}

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

function getNextLevelEntry(currentLevel, thresholds) {
  return thresholds.find((entry) => entry.level > currentLevel) || null;
}

export async function getUserProgress(pool, guildId, userId) {
  const thresholds = await loadThresholdsWithScaling(pool, guildId);
  const stats = await ensureUserGuildStats(pool, userId, guildId);
  const currentLevelThreshold = thresholds.find((entry) => entry.level === stats.level)?.threshold || 0;
  const nextEntry = getNextLevelEntry(stats.level, thresholds);
  const nextLevel = nextEntry?.level || null;
  const nextThreshold = nextEntry?.threshold || currentLevelThreshold;
  const xpToNext = nextEntry ? Math.max(nextThreshold - stats.xp, 0) : 0;
  const span = Math.max(nextThreshold - currentLevelThreshold, 1);
  const progress = nextEntry ? Math.min((stats.xp - currentLevelThreshold) / span, 1) : 1;

  return {
    ...stats,
    thresholds,
    nextLevel,
    nextThreshold,
    xpToNext,
    currentLevelThreshold,
    progress
  };
}

export async function awardInteractionXp(pool, guildRow, userProfile) {
  if (!guildRow.xp_enabled) {
    return { awarded: 0, leveledUp: false };
  }

  const guildId = guildRow.id;
  const thresholds = await loadThresholdsWithScaling(pool, guildId);
  const stats = await ensureUserGuildStats(pool, userProfile.id, guildId);
  const amount = guildRow.xp_per_interaction || 0;

  if (!amount) {
    return { awarded: 0, leveledUp: false };
  }

  const lastAward = stats.last_xp_at ? new Date(stats.last_xp_at).getTime() : 0;
  if (lastAward && Date.now() - lastAward < XP_COOLDOWN_MS) {
    return { awarded: 0, leveledUp: false, rateLimited: true };
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

export async function getNextRoleReward(pool, guildId, currentLevel) {
  const roles = await getLevelRoles(pool, guildId);
  const sorted = [...roles].sort((a, b) => a.level - b.level);
  return sorted.find((entry) => entry.level > currentLevel) || null;
}

export async function resetUserStats(pool, guildId, userId) {
  const stats = await ensureUserGuildStats(pool, userId, guildId);
  await pool.query('UPDATE user_guild_stats SET xp = 0, level = 1 WHERE id = ?', [stats.id]);
  return { ...stats, xp: 0, level: 1 };
}

export async function getLeaderboard(pool, guild, limit = 10) {
  const { discord_guild_id: discordGuildId, id: guildId } = guild;
  const [rows] = await pool.query(
    `SELECT u.discord_user_id, u.display_name, SUM(s.xp) AS xp, MAX(s.level) AS level
     FROM user_guild_stats s
     JOIN users u ON u.id = s.user_id
     JOIN guilds g ON g.id = s.guild_id
     WHERE g.discord_guild_id = ?
       AND g.discord_guild_id IS NOT NULL
     GROUP BY u.id
     ORDER BY xp DESC
     LIMIT ?`,
    [discordGuildId || guildId, limit]
  );
  return rows;
}

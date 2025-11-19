import { logInfo } from '../utils/logger.js';

export async function applyMigrations(pool) {
  await ensureGuildNormalization(pool);
  await ensureGeminiApiKeyTable(pool);
}

async function ensureGuildNormalization(pool) {
  await consolidateDuplicateGuilds(pool);
  await dropGuildCompositeIndex(pool);
  await dropBotInstanceColumn(pool);
  await ensureGuildUniqueIndex(pool);
}

async function consolidateDuplicateGuilds(pool) {
  const [guildRows] = await pool.query(
    `SELECT id, discord_guild_id
       FROM guilds
      ORDER BY discord_guild_id ASC, updated_at DESC, id DESC`
  );

  const keepers = new Map();
  for (const row of guildRows) {
    const existing = keepers.get(row.discord_guild_id);
    if (!existing) {
      keepers.set(row.discord_guild_id, row.id);
      continue;
    }
    await mergeGuildRows(pool, row.id, existing);
    logInfo('Merged duplicate guild rows', {
      discordGuildId: row.discord_guild_id,
      sourceId: row.id,
      targetId: existing
    });
  }
}

async function mergeGuildRows(pool, sourceGuildId, targetGuildId) {
  const tablesToUpdate = ['rulesets', 'user_memories', 'xp_levels', 'level_roles'];
  for (const table of tablesToUpdate) {
    await pool.query(`UPDATE ${table} SET guild_id = ? WHERE guild_id = ?`, [targetGuildId, sourceGuildId]);
  }

  await pool.query(
    `INSERT INTO user_guild_stats (user_id, guild_id, xp, level, last_birthday_announcement_year, last_xp_at)
       SELECT user_id, ?, xp, level, last_birthday_announcement_year, last_xp_at
         FROM user_guild_stats
        WHERE guild_id = ?
    ON DUPLICATE KEY UPDATE
      xp = GREATEST(user_guild_stats.xp, VALUES(xp)),
      level = GREATEST(user_guild_stats.level, VALUES(level)),
      last_birthday_announcement_year = GREATEST(
        COALESCE(user_guild_stats.last_birthday_announcement_year, 0),
        COALESCE(VALUES(last_birthday_announcement_year), 0)
      ),
      last_xp_at = GREATEST(
        COALESCE(user_guild_stats.last_xp_at, '1970-01-01 00:00:00'),
        COALESCE(VALUES(last_xp_at), '1970-01-01 00:00:00')
      )`,
    [targetGuildId, sourceGuildId]
  );

  await pool.query('DELETE FROM user_guild_stats WHERE guild_id = ?', [sourceGuildId]);
  await pool.query('DELETE FROM guilds WHERE id = ?', [sourceGuildId]);
}

async function dropGuildCompositeIndex(pool) {
  const [compositeIndex] = await pool.query("SHOW INDEX FROM guilds WHERE Key_name = 'uq_discord_bot'");
  if (compositeIndex.length) {
    await pool.query('ALTER TABLE guilds DROP INDEX `uq_discord_bot`');
    logInfo('Dropped composite guild unique index');
  }
}

async function dropBotInstanceColumn(pool) {
  const [botInstanceColumn] = await pool.query("SHOW COLUMNS FROM guilds LIKE 'bot_instance'");
  if (botInstanceColumn.length) {
    await pool.query('ALTER TABLE guilds DROP COLUMN bot_instance');
    logInfo('Removed bot_instance column from guilds table');
  }
}

async function ensureGuildUniqueIndex(pool) {
  const [existingIndex] = await pool.query("SHOW INDEX FROM guilds WHERE Key_name = 'uq_discord_guild'");
  if (!existingIndex.length) {
    await pool.query('ALTER TABLE guilds ADD UNIQUE KEY uq_discord_guild (discord_guild_id)');
    logInfo('Added unique index for discord_guild_id');
  }
}

async function ensureGeminiApiKeyTable(pool) {
  const [table] = await pool.query("SHOW TABLES LIKE 'gemini_api_keys'");
  if (table.length) return;

  await pool.query(
    `CREATE TABLE gemini_api_keys (
       id INT AUTO_INCREMENT PRIMARY KEY,
       api_key VARCHAR(255) NOT NULL,
       active TINYINT(1) DEFAULT 1,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  logInfo('Created gemini_api_keys table');
}

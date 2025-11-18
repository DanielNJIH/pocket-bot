import { logInfo } from '../utils/logger.js';

export async function applyMigrations(pool) {
  await ensureGuildBotInstanceSupport(pool);
}

async function ensureGuildBotInstanceSupport(pool) {
  const [botInstanceColumn] = await pool.query("SHOW COLUMNS FROM guilds LIKE 'bot_instance'");
  if (!botInstanceColumn.length) {
    await pool.query(
      "ALTER TABLE guilds ADD COLUMN bot_instance INT NOT NULL DEFAULT 1 AFTER discord_guild_id"
    );
    logInfo('Added bot_instance column to guilds table');
  }

  const [compositeIndex] = await pool.query("SHOW INDEX FROM guilds WHERE Key_name = 'uq_discord_bot'");
  if (!compositeIndex.length) {
    const [uniqueOnGuild] = await pool.query(
      `SELECT DISTINCT index_name AS indexName
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'guilds'
          AND column_name = 'discord_guild_id'
          AND non_unique = 0
          AND index_name != 'uq_discord_bot'`
    );

    for (const row of uniqueOnGuild) {
      await pool.query(`ALTER TABLE guilds DROP INDEX \`${row.indexName}\``);
      logInfo('Dropped outdated unique index on discord_guild_id', { indexName: row.indexName });
    }

    await pool.query('ALTER TABLE guilds ADD UNIQUE KEY uq_discord_bot (discord_guild_id, bot_instance)');
    logInfo('Added composite unique index for discord_guild_id and bot_instance');
  }
}

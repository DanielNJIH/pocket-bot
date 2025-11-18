export async function getRulesForGuild(pool, guildId) {
  const [rows] = await pool.query(
    'SELECT name, type, summary, content FROM rulesets WHERE guild_id = ? ORDER BY created_at DESC',
    [guildId]
  );
  return rows;
}

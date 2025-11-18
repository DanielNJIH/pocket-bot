export async function getRulesForGuild(pool, guildId) {
  const [rows] = await pool.query(
    'SELECT name, type, summary, content FROM rulesets WHERE guild_id = ? ORDER BY created_at DESC',
    [guildId]
  );
  return rows;
}

export async function addRule(pool, guildId, { name, type, summary, content, createdByUserId }) {
  await pool.query(
    'INSERT INTO rulesets (guild_id, name, type, summary, content, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, name, type, summary, content, createdByUserId]
  );
}

export async function removeRule(pool, guildId, name) {
  const [result] = await pool.query('DELETE FROM rulesets WHERE guild_id = ? AND name = ?', [
    guildId,
    name
  ]);
  return result.affectedRows > 0;
}

export async function listRules(pool, guildId, type) {
  if (type) {
    const [rows] = await pool.query(
      'SELECT name, type, summary FROM rulesets WHERE guild_id = ? AND type = ? ORDER BY created_at DESC',
      [guildId, type]
    );
    return rows;
  }

  const [rows] = await pool.query(
    'SELECT name, type, summary FROM rulesets WHERE guild_id = ? ORDER BY created_at DESC',
    [guildId]
  );
  return rows;
}

export async function getRule(pool, guildId, name) {
  const [rows] = await pool.query(
    'SELECT name, type, summary, content FROM rulesets WHERE guild_id = ? AND name = ? LIMIT 1',
    [guildId, name]
  );
  return rows[0];
}

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

export async function getRulesForGuild(pool, guild) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    const [rows] = await pool.query(
      `SELECT r.name, r.type, r.summary, r.content
         FROM rulesets r
         JOIN guilds g ON g.id = r.guild_id
        WHERE g.discord_guild_id = ?
        ORDER BY r.created_at DESC`,
      [discordGuildId]
    );
    return rows;
  }

  const [rows] = await pool.query(
    'SELECT name, type, summary, content FROM rulesets WHERE guild_id = ? ORDER BY created_at DESC',
    [guildId]
  );
  return rows;
}

export async function addRule(pool, guild, { name, type, summary, content, createdByUserId }) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    await pool.query(
      `DELETE r FROM rulesets r
         JOIN guilds g ON g.id = r.guild_id
        WHERE g.discord_guild_id = ? AND r.name = ?`,
      [discordGuildId, name]
    );
  }
  await pool.query(
    'INSERT INTO rulesets (guild_id, name, type, summary, content, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, name, type, summary, content, createdByUserId]
  );
}

export async function removeRule(pool, guild, name) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    const [result] = await pool.query(
      `DELETE r FROM rulesets r
         JOIN guilds g ON g.id = r.guild_id
        WHERE g.discord_guild_id = ? AND r.name = ?`,
      [discordGuildId, name]
    );
    return result.affectedRows > 0;
  }
  const [result] = await pool.query('DELETE FROM rulesets WHERE guild_id = ? AND name = ?', [guildId, name]);
  return result.affectedRows > 0;
}

export async function listRules(pool, guild, type) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    const typeClause = type ? 'AND r.type = ?' : '';
    const params = type ? [discordGuildId, type] : [discordGuildId];
    const [rows] = await pool.query(
      `SELECT r.name, r.type, r.summary
         FROM rulesets r
         JOIN guilds g ON g.id = r.guild_id
        WHERE g.discord_guild_id = ? ${typeClause}
        ORDER BY r.created_at DESC`,
      params
    );
    return rows;
  }

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

export async function getRule(pool, guild, name) {
  const { guildId, discordGuildId } = await resolveGuildScope(pool, guild);
  if (discordGuildId) {
    const [rows] = await pool.query(
      `SELECT r.name, r.type, r.summary, r.content
         FROM rulesets r
         JOIN guilds g ON g.id = r.guild_id
        WHERE g.discord_guild_id = ? AND r.name = ?
        LIMIT 1`,
      [discordGuildId, name]
    );
    return rows[0] || null;
  }

  const [rows] = await pool.query(
    'SELECT name, type, summary, content FROM rulesets WHERE guild_id = ? AND name = ? LIMIT 1',
    [guildId, name]
  );
  return rows[0] || null;
}

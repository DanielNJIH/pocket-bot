import { MAX_MEMORY_ITEMS } from '../config/constants.js';

export async function getRecentMemories(pool, guildId, userId) {
  const [rows] = await pool.query(
    'SELECT content FROM user_memories WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?',
    [guildId, userId, MAX_MEMORY_ITEMS]
  );
  return rows.map((row) => row.content);
}

export async function addMemory(pool, guildId, userId, content) {
  if (!content || !content.trim()) {
    return;
  }
  await pool.query('INSERT INTO user_memories (guild_id, user_id, content) VALUES (?, ?, ?)', [
    guildId,
    userId,
    content.trim()
  ]);

  await pool.query(
    `DELETE FROM user_memories
      WHERE guild_id = ? AND user_id = ? AND id NOT IN (
        SELECT id FROM (
          SELECT id FROM user_memories WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?
        ) recent
      )`,
    [guildId, userId, guildId, userId, MAX_MEMORY_ITEMS]
  );
}

export async function listMemories(pool, guildId, userId) {
  const [rows] = await pool.query(
    'SELECT id, content, created_at FROM user_memories WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
    [guildId, userId]
  );
  return rows;
}

export async function clearMemory(pool, guildId, memoryId) {
  const [result] = await pool.query(
    'DELETE FROM user_memories WHERE id = ? AND guild_id = ?',
    [memoryId, guildId]
  );
  return result.affectedRows > 0;
}

import { MAX_MEMORY_ITEMS } from '../config/constants.js';

export async function getRecentMemories(pool, guildId, userId) {
  const [rows] = await pool.query(
    'SELECT content FROM user_memories WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?',
    [guildId, userId, MAX_MEMORY_ITEMS]
  );
  return rows.map((row) => row.content);
}

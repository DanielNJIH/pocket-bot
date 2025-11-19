import { logDebug } from './logger.js';

function formatAuthorLabel(message, isBot) {
  if (isBot) {
    return message.member?.displayName || message.author?.username || 'Bot';
  }
  return (
    message.member?.displayName ||
    message.author?.globalName ||
    message.author?.username ||
    message.author?.tag ||
    'User'
  );
}

export async function collectConversationContext(channel, userId, botId, { limit = 12 } = {}) {
  if (!channel?.messages?.fetch || !userId || !botId) {
    return [];
  }

  try {
    const fetchLimit = Math.min(limit * 4, 100);
    const fetched = await channel.messages.fetch({ limit: fetchLimit });
    const sorted = [...fetched.values()]
      .filter((msg) => msg?.author && (msg.author.id === userId || msg.author.id === botId))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const recent = sorted.slice(-limit);
    return recent
      .map((msg) => ({
        role: msg.author.id === botId ? 'assistant' : 'user',
        authorLabel: formatAuthorLabel(msg, msg.author.id === botId),
        content: (msg.cleanContent || msg.content || '').trim()
      }))
      .filter((entry) => entry.content);
  } catch (err) {
    logDebug('Failed to collect conversation context', { error: err?.message });
    return [];
  }
}

export function appendUserMessage(context, authorLabel, content, limit = 12) {
  if (!content || !content.trim()) {
    return context;
  }
  const normalized = Array.isArray(context) ? context : [];
  const trimmed = content.trim();
  const lastEntry = normalized[normalized.length - 1];
  if (lastEntry && lastEntry.role === 'user' && lastEntry.content === trimmed && lastEntry.authorLabel === authorLabel) {
    return normalized;
  }
  const updated = [...normalized, { role: 'user', authorLabel, content: trimmed }];
  return updated.slice(-limit);
}

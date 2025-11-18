import { env } from '../config/env.js';

export function buildPrompt({
  guildSettings,
  userProfile,
  memories = [],
  rules = [],
  xpProgress,
  message,
  replyContext
}) {
  const languageLine = guildSettings.secondary_language_enabled
    ? `Primary language: ${guildSettings.primary_language || 'en'} | Secondary language: ${
        guildSettings.secondary_language || 'none'
      }`
    : `Primary language: ${guildSettings.primary_language || 'en'}`;

  const ruleSnippets = rules
    .map((rule) => `- [${rule.type}] ${rule.name}: ${rule.summary || ''}`)
    .join('\n');

  const memorySnippets = memories.map((item) => `- ${item}`).join('\n');

  const preferencesText = userProfile.preferences
    ? Object.entries(userProfile.preferences)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ')
    : 'unknown';

  const replyLine = replyContext
    ? `Replied message from ${replyContext.author}: ${replyContext.content}`
    : '';

  const xpLine = xpProgress
    ? `XP: Level ${xpProgress.level} with ${xpProgress.xp} XP. ${
        xpProgress.nextLevel
          ? `${xpProgress.xpToNext} XP until level ${xpProgress.nextLevel}`
          : 'Max level reached'
      }`
    : '';

  return [
    `System: You are ${env.botName}, a personal pocket friend. Personality: ${env.botPersonality}.`,
    'Always respect these guardrails:',
    '- Only engage with the selected user in this guild.',
    '- If information is missing from the database, say you do not know rather than inventing details.',
    '- Keep responses concise, warm, and proactive about follow-up questions.',
    '',
    `Guild language setup: ${languageLine}`,
    `User display name: ${userProfile.display_name || 'Unknown'}`,
    `User birthday: ${userProfile.birthday || 'Unknown'}`,
    `User preferences: ${preferencesText}`,
    userProfile.about ? `User profile note: ${userProfile.about}` : '',
    xpLine,
    memorySnippets ? `Recent memory highlights:\n${memorySnippets}` : '',
    ruleSnippets ? `Relevant rules:\n${ruleSnippets}` : '',
    '',
    `User said: ${message}`,
    replyLine,
    'Reply as their bonded pocket friend.'
  ]
    .filter(Boolean)
    .join('\n');
}

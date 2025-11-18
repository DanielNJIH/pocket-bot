import { env } from '../config/env.js';

export function buildPrompt({
  guildSettings,
  userProfile,
  guildDirectory = [],
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

  const userDisplayName = userProfile.display_name || userProfile.discord_name || 'Unknown';

  const botName = env.botName;

  const ageYears = userProfile.birthday
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(userProfile.birthday).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
      )
    : null;

  const ruleSnippets = rules
    .map((rule) => `- [${rule.type}] ${rule.name}: ${rule.summary || ''}`)
    .join('\n');

  const memorySnippets = memories.map((item) => `- ${item}`).join('\n');

  const formatPreferences = (preferences) =>
    preferences
      ? Object.entries(preferences)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')
      : 'unknown';

  const preferencesText = formatPreferences(userProfile.preferences);

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

  const memberDirectory = guildDirectory.length
    ? `Guild member data (read-only):\n${guildDirectory
        .map((member) => {
          const age = member.birthday
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(member.birthday).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
                )
              )
            : null;
          const prefText = formatPreferences(member.preferences);
          return `- ${member.display_name || member.discord_name || 'Unknown'}: Birthday ${
            member.birthday || 'unknown'
          }${age !== null ? ` (Age: ${age})` : ''}; About: ${member.about || 'n/a'}; Preferences: ${prefText}`;
        })
        .join('\n')}`
    : '';

  return [
    `System: You are ${botName}, a personal pocket friend. Personality: ${env.botPersonality}.`,
    `Your codename and name is ${botName}; always refer to yourself that way.`,
    'Always respect these guardrails:',
    '- Only engage with the selected user in this guild.',
    '- If information is missing from the database, say you do not know rather than inventing details.',
    '- Keep responses concise, warm, and proactive about follow-up questions.',
    '',
    `Guild language setup: ${languageLine}`,
    `User display name: ${userDisplayName}`,
    `User birthday: ${userProfile.birthday || 'Unknown'}${ageYears !== null ? ` (Age: ${ageYears})` : ''}`,
    `User preferences: ${preferencesText}`,
    userProfile.about ? `User profile note: ${userProfile.about}` : '',
    xpLine,
    memberDirectory,
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

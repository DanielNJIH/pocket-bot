import { env } from '../config/env.js';

function uniqueList(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildBotIdentity(client, guild, userCodewords = []) {
  const botUser = client?.user;
  const guildMember = guild?.members?.me;
  const nickname = guildMember?.nickname || guildMember?.displayName || '';
  const fallbackName = env.botName;
  const canonicalName = botUser?.username || fallbackName;
  const globalName = botUser?.globalName;

  const codewords = uniqueList([
    ...userCodewords,
    canonicalName,
    globalName,
    nickname,
    fallbackName
  ]);

  return {
    name: canonicalName,
    nickname: nickname || globalName || '',
    codewords
  };
}

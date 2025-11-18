import { Events } from 'discord.js';
import { ensureGuildRecord } from '../services/guildSettingsService.js';
import { getUserProfile } from '../services/profileService.js';
import { getRecentMemories } from '../services/memoryService.js';
import { getRulesForGuild } from '../services/rulesService.js';
import { buildPrompt } from '../services/promptBuilder.js';
import { generateResponse } from '../services/ai/geminiClient.js';
import { awardInteractionXp } from '../services/xpService.js';
import { logDebug, logError } from '../utils/logger.js';
import { maybeSendUpcomingBirthdayMessage } from '../services/birthdayService.js';
import { handlePrefixCommand } from '../discord/prefixCommands.js';

export const name = Events.MessageCreate;

async function fetchReferencedMessage(message) {
  if (!message.reference?.messageId) return null;
  try {
    return await message.channel.messages.fetch(message.reference.messageId);
  } catch (err) {
    logDebug('Failed to fetch referenced message', { error: err?.message });
    return null;
  }
}

function hasCodewordHit(content, codewords) {
  const lower = content.toLowerCase();
  return codewords?.some((word) => lower.includes(word.toLowerCase()));
}

export async function execute(message, context) {
  const { pool, client } = context;

  if (message.author.bot) return;
  if (!message.guild) return;

  const guildRow = await ensureGuildRecord(pool, message.guild.id);
  const selectedUserId = guildRow.selected_discord_user_id;

  const handled = await handlePrefixCommand(message, context, guildRow);
  if (handled) {
    return;
  }

  if (!selectedUserId) {
    return;
  }

  if (message.author.id !== selectedUserId) {
    return;
  }

  const userProfile = await getUserProfile(pool, message.author.id);

  const mentioned = message.mentions.has(client.user);
  const codewordHit = hasCodewordHit(message.content, userProfile.codewords);
  const referencedMessage = mentioned || message.reference ? await fetchReferencedMessage(message) : null;
  const replyTriggered = referencedMessage?.author.id === client.user.id;
  const replyContext = mentioned && referencedMessage
    ? {
        author: referencedMessage.author.tag || referencedMessage.author.username || referencedMessage.author.id,
        content: referencedMessage.cleanContent || referencedMessage.content
      }
    : null;

  if (!mentioned && !codewordHit && !replyTriggered) {
    return;
  }

  try {
    const memories = guildRow.memory_enabled
      ? await getRecentMemories(pool, guildRow.id, userProfile.id)
      : [];
    const rules = guildRow.rules_enabled ? await getRulesForGuild(pool, guildRow.id) : [];
    await maybeSendUpcomingBirthdayMessage({ pool, guildRow, guild: message.guild, userProfile });
    const prompt = buildPrompt({
      guildSettings: guildRow,
      userProfile,
      memories,
      rules,
      message: message.cleanContent,
      replyContext
    });

    const response = await generateResponse(prompt);
    await message.reply(response);

    const xpResult = await awardInteractionXp(pool, guildRow, userProfile);
    if (xpResult.leveledUp && guildRow.xp_announcement_channel_id) {
      const channel = message.guild.channels.cache.get(guildRow.xp_announcement_channel_id);
      if (channel?.isTextBased()) {
        const roleText = xpResult.unlockedRole ? `<@&${xpResult.unlockedRole}>` : 'new milestone';
        channel.send(`🎉 ${message.author} reached level ${xpResult.newLevel}! ${roleText}!`);
      }
    }

    if (xpResult.unlockedRole) {
      const member = await message.guild.members.fetch(message.author.id);
      await member.roles.add(xpResult.unlockedRole).catch((err) =>
        logError('Failed to assign role on level up', err)
      );
    }

    logDebug('Responded to selected user', {
      guild: message.guild.id,
      user: message.author.id,
      xpAwarded: xpResult.awarded
    });
  } catch (err) {
    logError('Failed to handle messageCreate', err);
  }
}

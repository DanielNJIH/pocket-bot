import { Events } from 'discord.js';
import { ensureGuildRecord } from '../services/guildSettingsService.js';
import { getUserProfile, summarizePersonaSettings } from '../services/profileService.js';
import { addMemory, getRecentMemories } from '../services/memoryService.js';
import { getRulesForGuild } from '../services/rulesService.js';
import { buildPrompt } from '../services/promptBuilder.js';
import { generateResponse } from '../services/ai/geminiClient.js';
import { awardInteractionXp, getUserProgress } from '../services/xpService.js';
import { logDebug, logError } from '../utils/logger.js';
import { maybeSendUpcomingBirthdayMessage } from '../services/birthdayService.js';
import { handlePrefixCommand, PREFIX } from '../discord/prefixCommands.js';
import { applyNameFallback, buildGuildDirectory } from '../utils/memberDirectory.js';
import { buildBotIdentity } from '../utils/botIdentity.js';
import { appendUserMessage, collectConversationContext } from '../utils/conversationContext.js';
import { extractMemoryDirective } from '../utils/memoryParser.js';
import { buildSelectedUserNames } from '../utils/selectedUserNames.js';

const CONTEXT_LIMIT = 12;

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

  const trimmedContent = message.content?.trim() || '';
  const isSysCommand = trimmedContent.toLowerCase().startsWith(PREFIX);

  if (isSysCommand) {
    if (!selectedUserId || message.author.id !== selectedUserId) {
      return;
    }

    const handled = await handlePrefixCommand(message, context, guildRow);
    if (handled) {
      return;
    }
  }

  if (!selectedUserId) {
    return;
  }

  if (message.author.id !== selectedUserId) {
    return;
  }

  const { directory: guildDirectory, nameMap } = await buildGuildDirectory(pool, message.guild, {
    excludeUserId: message.author.id
  });

  const discordName =
    nameMap.get(message.author.id) ||
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username ||
    message.author.tag;
  const userProfile = applyNameFallback(
    await getUserProfile(pool, message.author.id, { discordName }),
    nameMap,
    discordName
  );

  // Award XP for every message from the selected user (respecting cooldown and guild settings).
  const xpResult = await awardInteractionXp(pool, guildRow, userProfile);
  if (xpResult.leveledUp && guildRow.xp_announcement_channel_id) {
    const channel = message.guild.channels.cache.get(guildRow.xp_announcement_channel_id);
    if (channel?.isTextBased()) {
      const roleText = xpResult.unlockedRole
        ? `and unlocked <@&${xpResult.unlockedRole}>`
        : 'Keep it up!';
      channel.send(`🎉 ${message.author} reached level ${xpResult.newLevel}! ${roleText}`);
    }
  }

  if (xpResult.unlockedRole) {
    const member = await message.guild.members.fetch(message.author.id);
    await member.roles.add(xpResult.unlockedRole).catch((err) => logError('Failed to assign role on level up', err));
  }

  const mentioned = message.mentions.has(client.user);
  const codewordHit = hasCodewordHit(message.content, userProfile.codewords);
  const referencedMessage = mentioned || message.reference ? await fetchReferencedMessage(message) : null;
  const replyTriggered = referencedMessage?.author.id === client.user.id;

  if (!mentioned && !codewordHit && !replyTriggered) {
    return;
  }

  try {
    const memories = guildRow.memory_enabled
      ? await getRecentMemories(pool, guildRow.id, userProfile.id)
      : [];
    const rules = guildRow.rules_enabled ? await getRulesForGuild(pool, guildRow) : [];
    await maybeSendUpcomingBirthdayMessage({ pool, guildRow, guild: message.guild, userProfile });
    const xpProgress = await getUserProgress(pool, guildRow, userProfile.id);
    const botIdentity = buildBotIdentity(client, message.guild, userProfile.codewords);
    const selectedUserNames = buildSelectedUserNames(userProfile, discordName);
    let contextMessages = await collectConversationContext(
      message.channel,
      message.author.id,
      client.user.id,
      { limit: CONTEXT_LIMIT }
    );
    contextMessages = appendUserMessage(
      contextMessages,
      selectedUserNames.displayName,
      message.cleanContent,
      CONTEXT_LIMIT,
      message.id
    );
    const personaSummary = summarizePersonaSettings(userProfile.persona_settings);
    const prompt = buildPrompt({
      botIdentity,
      guildSettings: guildRow,
      userProfile,
      selectedUserNames,
      guildDirectory,
      memories,
      rules,
      xpProgress,
      contextMessages,
      userPersonaSummary: personaSummary
    });

    const rawResponse = await generateResponse(prompt, pool);
    const { content: responseContent, memory } = extractMemoryDirective(rawResponse);
    const replyText = responseContent?.trim() ? responseContent : rawResponse;
    await message.reply(replyText);

    if (memory && guildRow.memory_enabled) {
      await addMemory(pool, guildRow.id, userProfile.id, memory);
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

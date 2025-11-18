import { Events } from 'discord.js';
import { ensureGuildRecord } from '../services/guildSettingsService.js';
import { getGuildUserProfiles, getUserProfile } from '../services/profileService.js';
import { addMemory, getRecentMemories } from '../services/memoryService.js';
import { getRulesForGuild } from '../services/rulesService.js';
import { buildPrompt } from '../services/promptBuilder.js';
import { generateResponse } from '../services/ai/geminiClient.js';
import { awardInteractionXp, getUserProgress } from '../services/xpService.js';
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

async function buildMemberNameMap(guild, userIds) {
  if (!userIds?.length) return new Map();
  const unique = [...new Set(userIds)];
  try {
    const fetched = await guild.members.fetch({ user: unique });
    return new Map(
      unique
        .map((id) => {
          const member = fetched.get(id) || guild.members.cache.get(id);
          const user = member?.user;
          const name =
            member?.displayName || user?.globalName || user?.username || user?.tag || null;
          return name ? [id, name] : null;
        })
        .filter(Boolean)
    );
  } catch (err) {
    logDebug('Could not fetch member names for directory', { error: err?.message });
    return new Map(
      unique
        .map((id) => {
          const member = guild.members.cache.get(id);
          const user = member?.user;
          const name =
            member?.displayName || user?.globalName || user?.username || user?.tag || null;
          return name ? [id, name] : null;
        })
        .filter(Boolean)
    );
  }
}

function applyNameFallback(profile, nameMap, fallbackName) {
  const discordName = nameMap.get(profile.discord_user_id) || profile.discord_name || fallbackName;
  const displayName = profile.display_name || discordName || fallbackName;
  return { ...profile, discord_name: discordName, display_name: displayName };
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

  const guildProfiles = await getGuildUserProfiles(pool, message.guild.id);
  const nameMap = await buildMemberNameMap(
    message.guild,
    guildProfiles.map((profile) => profile.discord_user_id)
  );

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
  const guildDirectory = guildProfiles
    .map((profile) => applyNameFallback(profile, nameMap, profile.discord_user_id))
    .filter((profile) => profile.discord_user_id !== message.author.id);

  // Award XP for every message from the selected user (respecting cooldown and guild settings).
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
    await member.roles.add(xpResult.unlockedRole).catch((err) => logError('Failed to assign role on level up', err));
  }

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
    const xpProgress = await getUserProgress(pool, guildRow.id, userProfile.id);
    const prompt = buildPrompt({
      guildSettings: guildRow,
      userProfile,
      guildDirectory,
      memories,
      rules,
      xpProgress,
      message: message.cleanContent,
      replyContext
    });

    const response = await generateResponse(prompt, pool);
    await message.reply(response);

    if (guildRow.memory_enabled) {
      await addMemory(pool, guildRow.id, userProfile.id, message.cleanContent);
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

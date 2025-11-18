import { env } from '../config/env.js';
import {
  updateSelectedUser,
  setBirthdayChannel,
  setXpAnnouncementChannel,
  setXpPerInteraction,
  toggleXp,
  updateLanguages
} from '../services/guildSettingsService.js';
import {
  addRule,
  getRule,
  getRulesForGuild,
  listRules,
  removeRule
} from '../services/rulesService.js';
import {
  addMemory,
  clearMemory,
  getRecentMemories,
  listMemories
} from '../services/memoryService.js';
import {
  ensureUserRecord,
  findUserByDisplayName,
  getUserProfile,
  serializePreferences,
  updateAbout,
  updateBirthday,
  updateDisplayName,
  upsertCodewords,
  upsertUserPreference
} from '../services/profileService.js';
import { getRulesForGuild as fetchRulesForPrompt } from '../services/rulesService.js';
import {
  awardInteractionXp,
  getLeaderboard,
  getUserStats,
  resetUserStats
} from '../services/xpService.js';
import { buildPrompt } from '../services/promptBuilder.js';
import { generateResponse } from '../services/ai/geminiClient.js';
import { maybeSendUpcomingBirthdayMessage } from '../services/birthdayService.js';
import { logDebug, logError } from '../utils/logger.js';

const PREFIX = '!sys';

function tokenize(input) {
  const matches = input.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
  return matches.map((m) => m.replace(/^['"]|['"]$/g, ''));
}

function parseKeyValueArgs(text) {
  const result = {};
  const regex = /(\w+):"([^"]*)"|(\w+):'([^']*)'|(\w+):([^\s]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const key = match[1] || match[3] || match[5];
    const value = match[2] || match[4] || match[6];
    result[key] = value;
  }
  return result;
}

function formatRule(rule) {
  return `**${rule.name}** [${rule.type}]\n${rule.summary ? `${rule.summary}\n` : ''}${rule.content}`;
}

async function resolveUserFromArg(pool, arg) {
  if (!arg) return null;
  const mentionMatch = arg.match(/<(?:@|@!)?(\d+)>/);
  const discordId = mentionMatch ? mentionMatch[1] : /^[0-9]{5,}$/.test(arg) ? arg : null;
  if (discordId) {
    const user = await ensureUserRecord(pool, discordId);
    return user;
  }
  const named = await findUserByDisplayName(pool, arg);
  return named || null;
}

async function assertSelectedUser(message, guildRow) {
  if (!guildRow.selected_discord_user_id) {
    throw new Error('No selected user configured for this guild. Use `!sys assign @user` first.');
  }
  if (message.author.id !== guildRow.selected_discord_user_id) {
    throw new Error('Only the selected user can run these commands.');
  }
}

async function handleAssign(message, context, guildRow, argsText) {
  const { pool } = context;
  const tokens = tokenize(argsText);
  const target = tokens[0];
  if (!target) {
    await message.reply('Usage: `!sys assign @user`');
    return true;
  }

  if (guildRow.selected_discord_user_id && guildRow.selected_discord_user_id !== message.author.id) {
    await message.reply('Only the selected user can change the assignment.');
    return true;
  }

  const user = await resolveUserFromArg(pool, target);
  if (!user) {
    await message.reply('Could not find that user. Mention them or use their ID.');
    return true;
  }

  await updateSelectedUser(pool, guildRow.id, user.id);
  await message.reply(`Selected user updated to <@${user.discord_user_id}> for bot instance #${env.botInstance}.`);
  return true;
}

async function handleCodeword(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);

  const action = tokens[0];
  const word = tokens.slice(1).join(' ');

  const profile = await getUserProfile(pool, message.author.id);
  const codewords = profile.codewords || [];

  if (action === 'add') {
    if (!word) {
      await message.reply('Usage: `!sys codeword add <word>`');
      return true;
    }
    if (!codewords.includes(word)) {
      codewords.push(word);
      await upsertCodewords(pool, message.author.id, codewords);
    }
    await message.reply(`Codeword added. Current list: ${codewords.join(', ') || 'none'}`);
    return true;
  }

  if (action === 'remove') {
    if (!word) {
      await message.reply('Usage: `!sys codeword remove <word>`');
      return true;
    }
    const filtered = codewords.filter((w) => w.toLowerCase() !== word.toLowerCase());
    await upsertCodewords(pool, message.author.id, filtered);
    await message.reply(`Codeword removed. Current list: ${filtered.join(', ') || 'none'}`);
    return true;
  }

  if (action === 'list') {
    await message.reply(`Active codewords: ${codewords.join(', ') || 'none'}`);
    return true;
  }

  await message.reply('Usage: `!sys codeword <add|remove|list> ...`');
  return true;
}

async function handleProfile(message, context, guildRow, tokens, fullText) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const action = tokens[0];
  const rest = fullText.slice(action?.length || 0).trim();

  if (action === 'set-name') {
    if (!rest) return message.reply('Provide a display name.');
    await updateDisplayName(pool, message.author.id, rest);
    return message.reply(`Saved display name as **${rest}**.`);
  }

  if (action === 'set-about') {
    if (!rest) return message.reply('Provide an about blurb.');
    await updateAbout(pool, message.author.id, rest);
    return message.reply('Updated your about me.');
  }

  if (action === 'set-preferences') {
    if (!rest) return message.reply('Provide preferences text.');
    await upsertUserPreference(pool, message.author.id, serializePreferences(rest));
    return message.reply('Preferences saved.');
  }

  if (action === 'set-birthday') {
    if (!rest) return message.reply('Provide a birthday in YYYY-MM-DD.');
    await updateBirthday(pool, message.author.id, rest);
    return message.reply('Birthday updated.');
  }

  if (action === 'show') {
    const targetArg = rest;
    const targetUser = targetArg ? await resolveUserFromArg(pool, targetArg) : await ensureUserRecord(pool, message.author.id);
    if (!targetUser) return message.reply('Could not find that user.');
    const profile = await getUserProfile(pool, targetUser.discord_user_id);
    const codewords = profile.codewords?.join(', ') || 'none';
    return message.reply(
      [
        `Profile for <@${profile.discord_user_id}>`,
        `Name: ${profile.display_name || 'Unknown'}`,
        `About: ${profile.about || 'Not set'}`,
        `Preferences: ${profile.preferences ? JSON.stringify(profile.preferences) : 'Not set'}`,
        `Birthday: ${profile.birthday || 'Not set'}`,
        `Codewords: ${codewords}`
      ].join('\n')
    );
  }

  await message.reply('Unknown profile action.');
  return true;
}

async function handleBirthdayChannel(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  if (tokens[0] !== 'set') {
    await message.reply('Usage: `!sys birthday-channel set #channel`');
    return true;
  }
  const channelId = message.mentions.channels.first()?.id || tokens[1];
  if (!channelId) {
    await message.reply('Please mention a channel.');
    return true;
  }
  await setBirthdayChannel(pool, guildRow.id, channelId);
  await message.reply(`Birthday channel set to <#${channelId}>.`);
  return true;
}

async function handleBirthdayWhen(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const targetArg = tokens.join(' ');
  const user = targetArg ? await resolveUserFromArg(pool, targetArg) : await ensureUserRecord(pool, message.author.id);
  if (!user) {
    await message.reply('User not found.');
    return true;
  }
  const profile = await getUserProfile(pool, user.discord_user_id);
  await message.reply(`Birthday for <@${profile.discord_user_id}>: ${profile.birthday || 'Not set'}`);
  return true;
}

async function handleRules(message, context, guildRow, tokens, rawText) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const action = tokens[0];
  const remainder = rawText.slice(action?.length || 0).trim();

  if (action === 'add') {
    const args = parseKeyValueArgs(remainder);
    const name = args.name || tokens[1];
    const type = args.type || tokens[2] || 'custom';
    const summary = args.summary || '';
    const content = args.content || remainder.replace(/^[^\s]+\s+/, '');
    if (!name || !content) {
      await message.reply('Usage: `!sys rules add name:"Raid" type:game summary:"..." content:"details"`');
      return true;
    }
    await addRule(pool, guildRow.id, {
      name,
      type,
      summary,
      content,
      createdByUserId: guildRow.selected_user_id
    });
    await message.reply(`Rule **${name}** saved.`);
    return true;
  }

  if (action === 'remove') {
    const name = remainder || tokens[1];
    if (!name) {
      await message.reply('Usage: `!sys rules remove <name>`');
      return true;
    }
    const removed = await removeRule(pool, guildRow.id, name);
    await message.reply(removed ? `Removed rule **${name}**.` : 'No rule by that name.');
    return true;
  }

  if (action === 'list') {
    const type = tokens[1];
    const rules = await listRules(pool, guildRow.id, type);
    if (!rules.length) {
      await message.reply('No rules configured.');
      return true;
    }
    const lines = rules.map((r) => `- ${r.name} [${r.type}]${r.summary ? ` — ${r.summary}` : ''}`);
    await message.reply(lines.join('\n'));
    return true;
  }

  if (action === 'show') {
    const name = remainder || tokens[1];
    if (!name) return message.reply('Usage: `!sys rules show <name>`');
    const rule = await getRule(pool, guildRow.id, name);
    if (!rule) return message.reply('Rule not found.');
    await message.reply(formatRule(rule));
    return true;
  }

  await message.reply('Usage: `!sys rules <add|remove|list|show> ...`');
  return true;
}

async function handleXp(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const sub = tokens[0];

  if (!sub || /^[0-9<@]/.test(sub)) {
    const targetUser = sub ? await resolveUserFromArg(pool, sub) : await ensureUserRecord(pool, message.author.id);
    if (!targetUser) return message.reply('User not found.');
    const stats = await getUserStats(pool, guildRow.id, targetUser.id);
    return message.reply(`XP for <@${targetUser.discord_user_id}> — Level ${stats.level}, XP ${stats.xp}`);
  }

  if (sub === 'set-amount') {
    const amount = Number(tokens[1]);
    if (Number.isNaN(amount)) return message.reply('Provide a numeric amount.');
    await setXpPerInteraction(pool, guildRow.id, amount);
    return message.reply(`XP per interaction set to ${amount}.`);
  }

  if (sub === 'reset') {
    const targetUser = await resolveUserFromArg(pool, tokens[1]);
    if (!targetUser) return message.reply('User not found.');
    await resetUserStats(pool, guildRow.id, targetUser.id);
    return message.reply(`Reset XP for <@${targetUser.discord_user_id}>.`);
  }

  if (sub === 'toggle') {
    const enabled = tokens[1]?.toLowerCase() === 'true';
    await toggleXp(pool, guildRow.id, enabled);
    return message.reply(`XP has been ${enabled ? 'enabled' : 'disabled'}.`);
  }

  await message.reply('Unknown xp action.');
  return true;
}

async function handleLeaderboard(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const limit = Number(tokens[0]) || 10;
  const rows = await getLeaderboard(pool, guildRow.id, limit);
  if (!rows.length) return message.reply('No XP data yet.');
  const lines = rows.map(
    (row, idx) => `${idx + 1}. <@${row.discord_user_id}> — Level ${row.level}, XP ${row.xp}`
  );
  await message.reply(lines.join('\n'));
  return true;
}

async function handleXpRole(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const action = tokens[0];
  const level = Number(tokens[1]);
  if (Number.isNaN(level)) {
    await message.reply('Usage: `!sys xprole <add|remove> <level> @role`');
    return true;
  }
  if (action === 'add') {
    const roleId = message.mentions.roles.first()?.id || tokens[2];
    if (!roleId) return message.reply('Mention a role to award.');
    await pool.query(
      'INSERT INTO level_roles (guild_id, level, role_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)',
      [guildRow.id, level, roleId]
    );
    await message.reply(`Role <@&${roleId}> will be granted at level ${level}.`);
    return true;
  }
  if (action === 'remove') {
    const [result] = await pool.query('DELETE FROM level_roles WHERE guild_id = ? AND level = ?', [
      guildRow.id,
      level
    ]);
    await message.reply(result.affectedRows ? 'Mapping removed.' : 'No mapping existed for that level.');
    return true;
  }
  await message.reply('Usage: `!sys xprole <add|remove> <level> @role`');
  return true;
}

async function handleXpChannel(message, context, guildRow, tokens) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  if (tokens[0] !== 'set') return message.reply('Usage: `!sys xpchannel set #channel`');
  const channelId = message.mentions.channels.first()?.id || tokens[1];
  if (!channelId) return message.reply('Please mention a channel.');
  await setXpAnnouncementChannel(pool, guildRow.id, channelId);
  return message.reply(`Level-up announcements will go to <#${channelId}>.`);
}

async function handleLanguage(message, context, guildRow, tokens, raw) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  if (tokens[0] !== 'set') return message.reply('Usage: `!sys language set primary:<code> secondary:<code?> secondary_enabled:<true|false?>`');
  const args = parseKeyValueArgs(raw);
  const primary = args.primary || tokens[1];
  const secondary = args.secondary;
  const secondaryEnabled = args.secondary_enabled ? args.secondary_enabled.toLowerCase() === 'true' : !!secondary;
  if (!primary) return message.reply('Primary language code is required.');
  await updateLanguages(pool, guildRow.id, { primary, secondary, secondaryEnabled });
  return message.reply(`Languages set. Primary: ${primary}${secondary ? `, secondary: ${secondary} (${secondaryEnabled ? 'enabled' : 'disabled'})` : ''}`);
}

async function handleMemory(message, context, guildRow, tokens, rawText) {
  const { pool } = context;
  await assertSelectedUser(message, guildRow);
  const action = tokens[0];
  const remainder = rawText.slice(action?.length || 0).trim();

  if (action === 'add') {
    if (!remainder) return message.reply('Provide memory content.');
    const user = await ensureUserRecord(pool, message.author.id);
    await addMemory(pool, guildRow.id, user.id, remainder);
    return message.reply('Memory stored.');
  }

  if (action === 'list') {
    const targetUser = remainder ? await resolveUserFromArg(pool, remainder) : await ensureUserRecord(pool, message.author.id);
    if (!targetUser) return message.reply('User not found.');
    const entries = await listMemories(pool, guildRow.id, targetUser.id);
    if (!entries.length) return message.reply('No memories recorded.');
    const lines = entries.map((entry) => `#${entry.id} — ${entry.content}`);
    return message.reply(lines.join('\n'));
  }

  if (action === 'clear') {
    const id = Number(tokens[1]);
    if (Number.isNaN(id)) return message.reply('Provide a memory id.');
    const removed = await clearMemory(pool, guildRow.id, id);
    return message.reply(removed ? 'Memory removed.' : 'No memory with that id.');
  }

  await message.reply('Usage: `!sys memory <add|list|clear>`');
  return true;
}

async function handleSettingsShow(message, context, guildRow) {
  await assertSelectedUser(message, guildRow);
  const settings = [
    `Primary language: ${guildRow.primary_language}`,
    `Secondary language: ${guildRow.secondary_language || 'none'} (enabled: ${guildRow.secondary_language_enabled ? 'yes' : 'no'})`,
    `XP enabled: ${guildRow.xp_enabled ? 'yes' : 'no'} (per interaction: ${guildRow.xp_per_interaction})`,
    `XP channel: ${guildRow.xp_announcement_channel_id ? `<#${guildRow.xp_announcement_channel_id}>` : 'not set'}`,
    `Birthday channel: ${guildRow.birthday_channel_id ? `<#${guildRow.birthday_channel_id}>` : 'not set'}`,
    `Selected user: ${guildRow.selected_discord_user_id ? `<@${guildRow.selected_discord_user_id}>` : 'not set'}`
  ];
  await message.reply(settings.join('\n'));
  return true;
}

async function handleResponseTrigger(message, context, guildRow, content) {
  const { pool, client } = context;
  const userProfile = await getUserProfile(pool, message.author.id);
  const memories = guildRow.memory_enabled
    ? await getRecentMemories(pool, guildRow.id, userProfile.id)
    : [];
  const rules = guildRow.rules_enabled ? await fetchRulesForPrompt(pool, guildRow.id) : [];
  await maybeSendUpcomingBirthdayMessage({ pool, guildRow, guild: message.guild, userProfile });
  const prompt = buildPrompt({
    guildSettings: guildRow,
    userProfile,
    memories,
    rules,
    message: content
  });
  const response = await generateResponse(prompt);
  await message.reply(response);
  await awardInteractionXp(pool, guildRow, userProfile);
  logDebug('Responded to selected user via prefix trigger', {
    guild: message.guild.id,
    user: message.author.id
  });
  return true;
}

export async function handlePrefixCommand(message, context, guildRow) {
  const content = message.content?.trim();
  if (!content?.toLowerCase().startsWith(PREFIX)) return false;
  const withoutPrefix = content.slice(PREFIX.length).trim();
  if (!withoutPrefix) {
    await message.reply('Provide a command after the prefix.');
    return true;
  }

  const tokens = tokenize(withoutPrefix);
  const command = tokens.shift();
  const rawAfterCommand = withoutPrefix.slice(command.length).trim();

  try {
    switch (command) {
      case 'assign':
        return await handleAssign(message, context, guildRow, rawAfterCommand);
      case 'codeword':
        return await handleCodeword(message, context, guildRow, tokens);
      case 'profile':
        return await handleProfile(message, context, guildRow, tokens, rawAfterCommand);
      case 'birthday-channel':
        return await handleBirthdayChannel(message, context, guildRow, tokens);
      case 'birthday':
        if (tokens[0] === 'when') return await handleBirthdayWhen(message, context, guildRow, tokens.slice(1));
        break;
      case 'rules':
        return await handleRules(message, context, guildRow, tokens, rawAfterCommand);
      case 'xp':
        return await handleXp(message, context, guildRow, tokens);
      case 'leaderboard':
        return await handleLeaderboard(message, context, guildRow, tokens);
      case 'xprole':
        return await handleXpRole(message, context, guildRow, tokens);
      case 'xpchannel':
        return await handleXpChannel(message, context, guildRow, tokens);
      case 'language':
        return await handleLanguage(message, context, guildRow, tokens, rawAfterCommand);
      case 'memory':
        return await handleMemory(message, context, guildRow, tokens, rawAfterCommand);
      case 'settings':
        if (tokens[0] === 'show') return await handleSettingsShow(message, context, guildRow);
        break;
      default:
        await message.reply('Unknown command.');
        return true;
    }
  } catch (err) {
    logError('Prefix command failed', err);
    await message.reply(`Command failed: ${err.message}`);
    return true;
  }

  await message.reply('Invalid command format.');
  return true;
}

export { PREFIX };

import { env } from '../config/env.js';
import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import {
  updateSelectedUser,
  setBirthdayChannel,
  setXpAnnouncementChannel,
  setXpPerInteraction,
  toggleXp,
  updateLanguages,
  getLevelRoles
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
  getNextRoleReward,
  getLeaderboard,
  getUserProgress,
  resetUserStats,
  setUserXp
} from '../services/xpService.js';
import { buildPrompt } from '../services/promptBuilder.js';
import { generateResponse } from '../services/ai/geminiClient.js';
import { maybeSendUpcomingBirthdayMessage } from '../services/birthdayService.js';
import { logDebug, logError } from '../utils/logger.js';
import { applyNameFallback, buildGuildDirectory } from '../utils/memberDirectory.js';

const PREFIX = '!sys';

class PermissionError extends Error {
  constructor(message, { silent = false } = {}) {
    super(message);
    this.name = 'PermissionError';
    this.silent = silent;
  }
}

function getDiscordNameFallback(message, userId) {
  if (userId === message.author.id) {
    return (
      message.member?.displayName ||
      message.author.globalName ||
      message.author.username ||
      message.author.tag ||
      null
    );
  }
  const cached = message.client.users.cache.get(userId);
  return cached?.globalName || cached?.username || cached?.tag || null;
}

async function fetchDiscordUser(message, userId) {
  try {
    return await message.client.users.fetch(userId);
  } catch (err) {
    logDebug('Could not fetch Discord user for profile fallback', { userId, error: err?.message });
    return null;
  }
}

function calculateAge(birthday) {
  if (!birthday) return null;
  const birthDate = new Date(birthday);
  if (Number.isNaN(birthDate.getTime())) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
  );
}

const USER_HELP_LINES = [
  '- `!sys help` — show this help.',
  '- `!sys codeword <add|remove|list> <word>` — manage your trigger codewords.',
  '- `!sys profile set-name <text>` / `set-about <text>` / `set-preferences <text>` / `set-birthday <YYYY-MM-DD>` — update your profile.',
  '- `!sys profile show [@user|name]` — display a stored profile.',
  '- `!sys birthday when [@user|name]` — show a saved birthday.',
  '- `!sys xp [@user|id|name]` — see XP and level for yourself or another user.',
  '- `!sys leaderboard [limit]` — show top XP earners (if you are the selected user).',
  '- `!sys memory <add|list|clear> ...` — manage your memories.',
  '- `!sys settings show` — show current guild settings.'
];

const ADMIN_HELP_LINES = [
  '- `!sys assign @user` — set the selected user (admin only).',
  '- `!sys birthday-channel set #channel` — choose the channel for birthday heads-ups.',
  '- `!sys xpchannel set #channel` — set the level-up announcement channel.',
  '- `!sys xp set-amount <number>` / `toggle <true|false>` / `reset @user` / `set @user <xp>` — administer XP.',
  '- `!sys xprole list` — list level → role rewards.',
  '- `!sys xprole <add|remove> <level> @role` — manage level rewards.',
  '- `!sys rules add name:"<name>" type:<game|server|custom> summary:"<summary>" content:"<text>"` — add rules (admin only).',
  '- `!sys rules remove <name>` / `list [type]` / `show <name>` — manage rules (admin only).',
  '- `!sys language set primary:<code> secondary:<code?> secondary_enabled:<true|false?>` — configure guild languages.'
];

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

function buildProgressBar(progress) {
  const blocks = 12;
  const filled = Math.round(Math.min(Math.max(progress, 0), 1) * blocks);
  return `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(blocks - filled, 0))}`;
}

function formatRule(rule) {
  return `**${rule.name}** [${rule.type}]\n${rule.summary ? `${rule.summary}\n` : ''}${rule.content}`;
}

function isAdmin(message) {
  return message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
}

function assertAdmin(message) {
  if (!isAdmin(message)) {
    throw new PermissionError('Missing permissions or incorrect user.');
  }
}

function enforcePrefixAccess(message, guildRow, command, { adminCommand = false } = {}) {
  const hasSelection = Boolean(guildRow.selected_discord_user_id);
  const isSelectedUser = message.author.id === guildRow.selected_discord_user_id;
  const isAdminUser = isAdmin(message);

  if (!hasSelection) {
    if (command === 'assign' && isAdminUser) return true;
    if (command === 'help') return true;
    throw new PermissionError('Missing permissions or incorrect user.');
  }

  if (!isSelectedUser) {
    if (isAdminUser && (adminCommand || command === 'xp')) {
      return true;
    }
    throw new PermissionError('Missing permissions or incorrect user.', { silent: true });
  }

  if (adminCommand && !isAdminUser) {
    throw new PermissionError('Missing permissions or incorrect user.');
  }

  return true;
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
  return assertSelectedUserOrAdmin(message, guildRow, { allowAdmin: false });
}

function assertSelectedUserOrAdmin(message, guildRow, { allowAdmin } = { allowAdmin: true }) {
  if (!guildRow.selected_discord_user_id) {
    throw new PermissionError('Missing permissions or incorrect user.');
  }
  if (message.author.id === guildRow.selected_discord_user_id) {
    return true;
  }
  if (allowAdmin && isAdmin(message)) {
    return true;
  }
  throw new PermissionError('Missing permissions or incorrect user.', { silent: true });
}

async function handleHelp(message, isAdminUser) {
  const lines = ['**Pocket Friend `!sys` commands**', ...USER_HELP_LINES];
  if (isAdminUser) {
    lines.push('', 'Admin controls:', ...ADMIN_HELP_LINES);
  }
  lines.push('', 'The bot replies only to the selected user when they ping the bot, use a configured codeword, or reply directly to the bot.');
  await message.reply(lines.join('\n'));
  return true;
}

async function handleAssign(message, context, guildRow, argsText) {
  assertAdmin(message);
  const { pool } = context;
  const tokens = tokenize(argsText);
  const target = tokens[0];
  if (!target) {
    await message.reply('Usage: `!sys assign @user`');
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

  const profile = await getUserProfile(pool, message.author.id, {
    discordName: getDiscordNameFallback(message, message.author.id)
  });
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
  const action = tokens[0];
  const rest = fullText.slice(action?.length || 0).trim();

  if (action === 'set-name') {
    await assertSelectedUser(message, guildRow);
    if (!rest) return message.reply('Provide a display name.');
    await updateDisplayName(pool, message.author.id, rest);
    return message.reply(`Saved display name as **${rest}**.`);
  }

  if (action === 'set-about') {
    await assertSelectedUser(message, guildRow);
    if (!rest) return message.reply('Provide an about blurb.');
    await updateAbout(pool, message.author.id, rest);
    return message.reply('Updated your about me.');
  }

  if (action === 'set-preferences') {
    await assertSelectedUser(message, guildRow);
    if (!rest) return message.reply('Provide preferences text.');
    await upsertUserPreference(pool, message.author.id, serializePreferences(rest));
    return message.reply('Preferences saved.');
  }

  if (action === 'set-birthday') {
    await assertSelectedUser(message, guildRow);
    if (!rest) return message.reply('Provide a birthday in YYYY-MM-DD.');
    await updateBirthday(pool, message.author.id, rest);
    return message.reply('Birthday updated.');
  }

  if (action === 'show') {
    await assertSelectedUser(message, guildRow);
    const targetArg = rest;
    const targetUser = targetArg ? await resolveUserFromArg(pool, targetArg) : await ensureUserRecord(pool, message.author.id);
    if (!targetUser) return message.reply('Could not find that user.');
    const discordUser = await fetchDiscordUser(message, targetUser.discord_user_id);
    const profile = await getUserProfile(pool, targetUser.discord_user_id, {
      discordName: getDiscordNameFallback(message, targetUser.discord_user_id) ||
        discordUser?.globalName ||
        discordUser?.username ||
        discordUser?.tag
    });
    const codewords = profile.codewords?.join(', ') || 'none';
    const age = calculateAge(profile.birthday);
    return message.reply(
      [
        `Profile for <@${profile.discord_user_id}>`,
        `Name: ${profile.display_name || profile.discord_name || 'Unknown'}`,
        `About: ${profile.about || 'Not set'}`,
        `Preferences: ${profile.preferences ? JSON.stringify(profile.preferences) : 'Not set'}`,
        `Birthday: ${profile.birthday || 'Not set'}${age !== null ? ` (Age: ${age})` : ''}`,
        `Codewords: ${codewords}`
      ].join('\n')
    );
  }

  await message.reply('Unknown profile action.');
  return true;
}

async function handleBirthdayChannel(message, context, guildRow, tokens) {
  const { pool } = context;
  assertAdmin(message);
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
  assertSelectedUserOrAdmin(message, guildRow, { allowAdmin: true });
  const targetArg = tokens.join(' ');
  const user = targetArg ? await resolveUserFromArg(pool, targetArg) : await ensureUserRecord(pool, message.author.id);
  if (!user) {
    await message.reply('User not found.');
    return true;
  }
  const profile = await getUserProfile(pool, user.discord_user_id, {
    discordName: getDiscordNameFallback(message, user.discord_user_id)
  });
  await message.reply(`Birthday for <@${profile.discord_user_id}>: ${profile.birthday || 'Not set'}`);
  return true;
}

async function handleRules(message, context, guildRow, tokens, rawText) {
  const { pool } = context;
  assertAdmin(message);
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
    const creator = await ensureUserRecord(pool, message.author.id);
    await addRule(pool, guildRow.id, {
      name,
      type,
      summary,
      content,
      createdByUserId: creator.id
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
  const sub = tokens[0];

  if (!sub || /^[0-9<@]/.test(sub)) {
    await assertSelectedUserOrAdmin(message, guildRow);
    const targetUser = sub ? await resolveUserFromArg(pool, sub) : await ensureUserRecord(pool, message.author.id);
    if (!targetUser) return message.reply('User not found.');

    const progress = await getUserProgress(pool, guildRow.id, targetUser.id);
    const nextRole = await getNextRoleReward(pool, guildRow.id, progress.level);
    const discordUser = await message.client.users.fetch(targetUser.discord_user_id);
    const progressBar = buildProgressBar(progress.progress);
    const nextLevelText = progress.nextLevel
      ? `Level ${progress.nextLevel} (${progress.xpToNext} XP left)`
      : 'Max level reached';
    const levelsAway = nextRole ? Math.max(nextRole.level - progress.level, 0) : null;
    const nextRoleText = nextRole
      ? `<@&${nextRole.role_id}> at level ${nextRole.level} (${levelsAway} level${levelsAway === 1 ? '' : 's'} away)`
      : 'No upcoming role reward configured.';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: `${discordUser.username || discordUser.tag || 'User'} — XP Overview`,
        iconURL: discordUser.displayAvatarURL()
      })
      .setThumbnail(discordUser.displayAvatarURL())
      .addFields(
        { name: 'Level', value: `${progress.level}`, inline: true },
        { name: 'Total XP', value: `${progress.xp}`, inline: true },
        { name: 'Next level', value: nextLevelText, inline: true },
        { name: 'Next role reward', value: nextRoleText, inline: true },
        { name: 'Progress', value: `${progressBar} (${Math.round(progress.progress * 100)}%)`, inline: false }
      )
      .setFooter({ text: `XP per message: ${guildRow.xp_per_interaction} | Cooldown: 5s` });
    await message.reply({ embeds: [embed] });
    return true;
  }

  if (sub === 'set-amount') {
    assertAdmin(message);
    const amount = Number(tokens[1]);
    if (Number.isNaN(amount)) return message.reply('Provide a numeric amount.');
    await setXpPerInteraction(pool, guildRow.id, amount);
    return message.reply(`XP per interaction set to ${amount}.`);
  }

  if (sub === 'reset') {
    assertAdmin(message);
    const targetUser = await resolveUserFromArg(pool, tokens[1]);
    if (!targetUser) return message.reply('User not found.');
    await resetUserStats(pool, guildRow.id, targetUser.id);
    return message.reply(`Reset XP for <@${targetUser.discord_user_id}>.`);
  }

  if (sub === 'set') {
    assertAdmin(message);
    const targetUser = await resolveUserFromArg(pool, tokens[1]);
    const amount = Number(tokens[2]);
    if (!targetUser) return message.reply('User not found.');
    if (Number.isNaN(amount)) return message.reply('Provide a numeric XP amount to set.');
    const updated = await setUserXp(pool, guildRow.id, targetUser.id, amount);
    return message.reply(
      `Set XP for <@${targetUser.discord_user_id}> to ${updated.xp} (Level ${updated.level}).`
    );
  }

  if (sub === 'toggle') {
    assertAdmin(message);
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
  const rows = await getLeaderboard(pool, guildRow, limit);
  if (!rows.length) return message.reply('No XP data yet.');
  const description = rows
    .map((row, idx) => `${idx + 1}. <@${row.discord_user_id}> — Level ${row.level} (${row.xp} XP)`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('XP Leaderboard')
    .setDescription(description)
    .setFooter({ text: `Top ${rows.length} · XP per message: ${guildRow.xp_per_interaction}` });
  await message.reply({ embeds: [embed] });
  return true;
}

async function handleXpRole(message, context, guildRow, tokens) {
  const { pool } = context;
  assertAdmin(message);
  const action = tokens[0];
  const level = Number(tokens[1]);

  if (action === 'list') {
    const mappings = await getLevelRoles(pool, guildRow.id);
    if (!mappings.length) {
      await message.reply('No level rewards configured.');
      return true;
    }
    const lines = mappings.map((row) => `Level ${row.level} → <@&${row.role_id}>`);
    await message.reply(lines.join('\n'));
    return true;
  }

  if (Number.isNaN(level)) {
    await message.reply('Usage: `!sys xprole list` or `!sys xprole <add|remove> <level> @role`');
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
  await message.reply('Usage: `!sys xprole list` or `!sys xprole <add|remove> <level> @role`');
  return true;
}

async function handleXpChannel(message, context, guildRow, tokens) {
  const { pool } = context;
  assertAdmin(message);
  if (tokens[0] !== 'set') return message.reply('Usage: `!sys xpchannel set #channel`');
  const channelId = message.mentions.channels.first()?.id || tokens[1];
  if (!channelId) return message.reply('Please mention a channel.');
  await setXpAnnouncementChannel(pool, guildRow.id, channelId);
  return message.reply(`Level-up announcements will go to <#${channelId}>.`);
}

async function handleLanguage(message, context, guildRow, tokens, raw) {
  const { pool } = context;
  assertAdmin(message);
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
  const { directory: guildDirectory, nameMap } = await buildGuildDirectory(pool, message.guild, {
    excludeUserId: message.author.id
  });
  const discordName =
    nameMap.get(message.author.id) || getDiscordNameFallback(message, message.author.id) || message.author.tag;
  const userProfile = applyNameFallback(
    await getUserProfile(pool, message.author.id, {
      discordName
    }),
    nameMap,
    discordName
  );
  const memories = guildRow.memory_enabled
    ? await getRecentMemories(pool, guildRow.id, userProfile.id)
    : [];
  const rules = guildRow.rules_enabled ? await fetchRulesForPrompt(pool, guildRow.id) : [];
  const xpProgress = await getUserProgress(pool, guildRow.id, userProfile.id);
  await maybeSendUpcomingBirthdayMessage({ pool, guildRow, guild: message.guild, userProfile });
  const prompt = buildPrompt({
    guildSettings: guildRow,
    userProfile,
    memories,
    rules,
    xpProgress,
    guildDirectory,
    message: content
  });
  const response = await generateResponse(prompt, pool);
  await message.reply(response);
  if (guildRow.memory_enabled) {
    await addMemory(pool, guildRow.id, userProfile.id, content);
  }
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
  const isAdminUser = isAdmin(message);
  const adminCommands = new Set(['assign', 'birthday-channel', 'xpchannel', 'xprole', 'rules', 'language']);
  const adminCommand = adminCommands.has(command);

  if (
    guildRow.selected_discord_user_id &&
    message.author.id !== guildRow.selected_discord_user_id &&
    !isAdminUser
  ) {
    await message.reply('Missing permissions or incorrect user.');
    return true;
  }

  try {
    enforcePrefixAccess(message, guildRow, command, { adminCommand });
  } catch (err) {
    if (err instanceof PermissionError) {
      if (!err.silent) {
        await message.reply('Missing permissions or incorrect user.');
      }
      return true;
    }
    throw err;
  }

  try {
    switch (command) {
      case 'help':
        return await handleHelp(message, isAdminUser);
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
    if (err instanceof PermissionError) {
      if (!err.silent) {
        await message.reply('Missing permissions or incorrect user.');
      }
      return true;
    }
    logError('Prefix command failed', err);
    await message.reply(`Command failed: ${err.message}`);
    return true;
  }

  await message.reply('Invalid command format.');
  return true;
}

export { PREFIX };

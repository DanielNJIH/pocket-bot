import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { env } from '../config/env.js';
import { ensureGuildRecord, updateSelectedUser } from '../services/guildSettingsService.js';
import { ensureUserRecord } from '../services/profileService.js';
import { logError, logInfo } from '../utils/logger.js';

const setSelectedUserCommand = {
  data: new SlashCommandBuilder()
    .setName('set-selected-user')
    .setDescription('Assign the user this bot instance should listen to in this guild')
    .addUserOption((option) =>
      option.setName('user').setDescription('The Discord user this bot should follow').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { pool } = context;
    const targetUser = interaction.options.getUser('user', true);
    const guildRow = await ensureGuildRecord(pool, interaction.guildId);
    const userRow = await ensureUserRecord(pool, targetUser.id);
    await updateSelectedUser(pool, guildRow.id, userRow.id);

    await interaction.reply({
      content: `Selected user updated to ${targetUser} for bot instance #${env.botInstance}.`,
      flags: MessageFlags.Ephemeral
    });
  }
};

const botStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Show which user and bot instance are active for this guild'),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { pool } = context;
    const guildRow = await ensureGuildRecord(pool, interaction.guildId);
    const selectedUserId = guildRow.selected_discord_user_id;
    const selectedUserLabel = selectedUserId ? `<@${selectedUserId}>` : 'not configured';

    await interaction.reply({
      content: `Bot instance: #${env.botInstance}\nSelected user: ${selectedUserLabel}`,
      flags: MessageFlags.Ephemeral
    });
  }
};

const commands = [setSelectedUserCommand, botStatusCommand];

export async function registerSlashCommands(client) {
  const commandData = commands.map((command) => command.data.toJSON());
  const guilds = await client.guilds.fetch();

  for (const [guildId] of guilds) {
    try {
      await client.application.commands.set(commandData, guildId);
    } catch (err) {
      logError('Failed to register commands for guild', { guildId, error: err });
    }
  }

  logInfo('Slash commands registered', {
    botInstance: env.botInstance,
    guilds: guilds.size,
    commands: commandData.length
  });
}

export async function handleSlashCommand(interaction, context) {
  const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
  if (!command) {
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (err) {
    logError('Failed to execute slash command', err);
    if (!interaction.replied) {
      await interaction
        .reply({
          content: 'Something went wrong while running that command.',
          flags: MessageFlags.Ephemeral
        })
        .catch(() => {});
    }
  }
}

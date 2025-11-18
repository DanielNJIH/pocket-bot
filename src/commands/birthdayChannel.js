import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureGuildRecord, setBirthdayChannel } from '../services/guildSettingsService.js';

export const data = new SlashCommandBuilder()
  .setName('birthday-channel')
  .setDescription('Configure where birthday heads-up messages are posted')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Text channel for birthday announcements')
      .setRequired(true)
  );

export async function execute(interaction, { pool }) {
  const channel = interaction.options.getChannel('channel', true);
  const guildRow = await ensureGuildRecord(pool, interaction.guildId);

  await setBirthdayChannel(pool, guildRow.id, channel.id);
  await interaction.reply({
    content: `Birthday heads-ups will be sent to ${channel}.`,
    ephemeral: true
  });
}

import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureGuildRecord } from '../services/guildSettingsService.js';
import { ensureUserRecord, setBirthday } from '../services/profileService.js';

function canManageProfile(interaction, guildRow) {
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const isSelected = interaction.user.id === guildRow.selected_discord_user_id;
  return isAdmin || isSelected;
}

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Manage your profile')
  .addSubcommand((sub) =>
    sub
      .setName('set-birthday')
      .setDescription('Set the birthday for the Selected User')
      .addStringOption((option) =>
        option
          .setName('date')
          .setDescription('Birthday in YYYY-MM-DD format')
          .setRequired(true)
      )
  );

export async function execute(interaction, { pool }) {
  const subcommand = interaction.options.getSubcommand();
  const guildRow = await ensureGuildRecord(pool, interaction.guildId);

  if (!guildRow.selected_discord_user_id) {
    await interaction.reply({ content: 'No Selected User is configured. Use /assign first.', ephemeral: true });
    return;
  }

  if (!canManageProfile(interaction, guildRow)) {
    await interaction.reply({
      content: 'Only the Selected User or an admin can update this profile.',
      ephemeral: true
    });
    return;
  }

  if (subcommand === 'set-birthday') {
    const date = interaction.options.getString('date', true);
    const user = await ensureUserRecord(pool, guildRow.selected_discord_user_id);
    await setBirthday(pool, user.discord_user_id, date);
    await interaction.reply({ content: `Birthday saved as ${date}.`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'Unsupported subcommand.', ephemeral: true });
}

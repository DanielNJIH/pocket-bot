import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureGuildRecord, setSelectedUser } from '../services/guildSettingsService.js';
import { ensureUserRecord } from '../services/profileService.js';

export const data = new SlashCommandBuilder()
  .setName('assign')
  .setDescription('Assign the Selected User for this guild')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption((option) => option.setName('user').setDescription('The user to bond with').setRequired(true));

export async function execute(interaction, { pool }) {
  const targetUser = interaction.options.getUser('user', true);

  const guildRow = await ensureGuildRecord(pool, interaction.guildId);
  const userRow = await ensureUserRecord(pool, targetUser.id);

  await setSelectedUser(pool, guildRow.id, userRow.id);

  await interaction.reply({
    content: `Selected User set to ${targetUser.tag}. The bot will now only respond to them when triggered.`,
    ephemeral: true
  });
}

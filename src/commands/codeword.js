import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureGuildRecord } from '../services/guildSettingsService.js';
import { getUserProfile, upsertCodewords } from '../services/profileService.js';

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function requireSelectedUser(interaction, pool) {
  const guildRow = await ensureGuildRecord(pool, interaction.guildId);
  if (!guildRow.selected_discord_user_id) {
    await interaction.reply({
      content: 'No Selected User is configured. Use /assign to set one first.',
      ephemeral: true
    });
    return null;
  }

  const isSelected = interaction.user.id === guildRow.selected_discord_user_id;
  if (!isSelected && !isAdmin(interaction)) {
    await interaction.reply({
      content: 'Only the Selected User or an admin can manage codewords.',
      ephemeral: true
    });
    return null;
  }

  return guildRow.selected_discord_user_id;
}

export const data = new SlashCommandBuilder()
  .setName('codeword')
  .setDescription('Manage trigger codewords for the Selected User')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a trigger codeword')
      .addStringOption((option) =>
        option.setName('word').setDescription('The codeword to add').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a trigger codeword')
      .addStringOption((option) =>
        option.setName('word').setDescription('The codeword to remove').setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List trigger codewords'));

export async function execute(interaction, { pool }) {
  const selectedUserId = await requireSelectedUser(interaction, pool);
  if (!selectedUserId) return;

  const profile = await getUserProfile(pool, selectedUserId);
  const codewords = profile.codewords || [];
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'add') {
    const word = interaction.options.getString('word', true).trim();
    if (!word) {
      await interaction.reply({ content: 'Please provide a non-empty codeword.', ephemeral: true });
      return;
    }

    if (codewords.includes(word)) {
      await interaction.reply({ content: 'That codeword is already configured.', ephemeral: true });
      return;
    }

    const updated = [...codewords, word];
    await upsertCodewords(pool, selectedUserId, updated);
    await interaction.reply({
      content: `Added codeword: \`${word}\`. Current codewords: ${updated.map((w) => `\`${w}\``).join(', ')}.`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === 'remove') {
    const word = interaction.options.getString('word', true).trim();
    const updated = codewords.filter((w) => w !== word);

    await upsertCodewords(pool, selectedUserId, updated);
    await interaction.reply({
      content: `Removed codeword. Current codewords: ${updated.length ? updated.map((w) => `\`${w}\``).join(', ') : 'none'}.`,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: codewords.length
      ? `Current codewords: ${codewords.map((w) => `\`${w}\``).join(', ')}.`
      : 'No codewords are configured yet. Use /codeword add to set one.',
    ephemeral: true
  });
}

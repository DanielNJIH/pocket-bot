import { Events } from 'discord.js';
import { commands } from '../commands/index.js';
import { logError } from '../utils/logger.js';

export const name = Events.InteractionCreate;
export const once = false;

export async function execute(interaction, context) {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, context);
  } catch (err) {
    logError('Error running slash command', { err, command: interaction.commandName });
    const replyContent = 'Sorry, something went wrong while handling that command.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: replyContent, ephemeral: true });
    } else {
      await interaction.reply({ content: replyContent, ephemeral: true });
    }
  }
}

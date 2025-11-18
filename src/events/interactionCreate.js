import { Events } from 'discord.js';
import { handleSlashCommand } from '../discord/commands.js';
import { logError } from '../utils/logger.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, context) {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleSlashCommand(interaction, context);
  } catch (err) {
    logError('Interaction handler failed', err);
  }
}


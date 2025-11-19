import { Events } from 'discord.js';
import { env } from '../config/env.js';
import { registerSlashCommands } from '../discord/commands.js';
import { logError, logInfo } from '../utils/logger.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client, context) {
  const { pool } = context;
  logInfo(`Logged in as ${client.user.tag} (bot instance #${env.botInstance})`);

  try {
    await pool.query('SELECT 1');
    logInfo('MySQL connection verified');
  } catch (err) {
    logError('Failed to verify MySQL connection', err);
  }

  try {
    await registerSlashCommands(client);
  } catch (err) {
    logError('Failed to register slash commands', err);
  }
}

import { Events } from 'discord.js';
import { commands } from '../commands/index.js';
import { registerCommands } from '../discord/registerCommands.js';
import { logInfo } from '../utils/logger.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  logInfo(`Logged in as ${client.user.tag}`);
  await registerCommands(client, commands);
}

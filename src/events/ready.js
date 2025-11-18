import { Events } from 'discord.js';
import { logInfo } from '../utils/logger.js';

export const name = Events.ClientReady;
export const once = true;

export function execute(client) {
  logInfo(`Logged in as ${client.user.tag}`);
}

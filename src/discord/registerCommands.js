import { env } from '../config/env.js';
import { logError, logInfo } from '../utils/logger.js';

export async function registerCommands(client, commands) {
  const payload = commands.map((command) => command.data.toJSON());

  try {
    if (env.devGuildId) {
      const guild = client.guilds.cache.get(env.devGuildId);
      if (!guild) {
        logError('DEV_GUILD_ID is set but the bot is not in that guild', { guildId: env.devGuildId });
        return;
      }
      await guild.commands.set(payload);
      logInfo(`Registered ${payload.length} slash commands in dev guild ${guild.name}`);
      return;
    }

    await client.application.commands.set(payload);
    logInfo(`Registered ${payload.length} global slash commands`);
  } catch (err) {
    logError('Failed to register slash commands', err);
  }
}

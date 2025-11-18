import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './config/env.js';
import { applyMigrations } from './db/migrations.js';
import { getPool } from './db/pool.js';
import { registerEvents } from './discord/registerEvents.js';
import { logError, logInfo } from './utils/logger.js';

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  const pool = getPool();
  await applyMigrations(pool);

  registerEvents(client, { pool, client });

  await client.login(env.discordToken);
  logInfo('Discord login initiated');
}

main().catch((err) => logError('Failed to start bot', err));

process.on('unhandledRejection', (reason) => logError('Unhandled rejection', reason));
process.on('uncaughtException', (err) => logError('Uncaught exception', err));

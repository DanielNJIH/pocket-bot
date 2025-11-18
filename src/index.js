import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './config/env.js';
import { getPool } from './db/pool.js';
import { registerEvents } from './discord/registerEvents.js';
import { logError, logInfo } from './utils/logger.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

const pool = getPool();

registerEvents(client, { pool, client });

client
  .login(env.discordToken)
  .then(() => logInfo('Discord login initiated'))
  .catch((err) => logError('Failed to login to Discord', err));

process.on('unhandledRejection', (reason) => logError('Unhandled rejection', reason));
process.on('uncaughtException', (err) => logError('Uncaught exception', err));

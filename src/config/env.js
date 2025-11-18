import dotenv from 'dotenv';

dotenv.config();

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

const botCodename = process.env.BOT_CODENAME || process.env.BOT_NAME || 'PocketFriend';

export const env = {
  discordToken: required('DISCORD_TOKEN', process.env.DISCORD_TOKEN),
  botInstance: Number(required('BOT_INSTANCE', process.env.BOT_INSTANCE)),
  botName: botCodename,
  botPersonality:
    process.env.BOT_PERSONALITY ||
    'You are a friendly, loyal pocket friend who keeps conversations light, curious, and supportive.',
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  // default to the stable, supported model alias
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  mysql: {
    host: required('MYSQL_HOST', process.env.MYSQL_HOST),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER', process.env.MYSQL_USER),
    password: required('MYSQL_PASSWORD', process.env.MYSQL_PASSWORD),
    database: required('MYSQL_DATABASE', process.env.MYSQL_DATABASE)
  }
};

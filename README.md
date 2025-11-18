# Pocket Friend Discord Bot

A multi-instance “Pocket Friend” Discord bot that bonds with a single **Selected User** per guild, powers replies through Gemini, and stores persistent data in MySQL. All bot instances share the same database, so user profiles, guild settings, rules, memory, and XP stay consistent no matter which bot identity is online.

## Core behaviour
- Each guild tracks one **Selected User**; the bot completely ignores everyone else.
- Even the Selected User only triggers replies when they mention the bot, use a configured codeword, or reply directly to the bot.
- Responses use Gemini with structured context: guild language settings, the user profile, lightweight memory, and any rules configured for the guild.
- XP is awarded per successful interaction and can unlock configured Discord roles with announcement messages.
- Upcoming birthdays (within 7 days) trigger a heads-up in the configured birthday channel.

## Project structure
```
src/
  config/          // env loading and shared constants
  db/              // MySQL pool
  discord/         // client bootstrap helpers
  events/          // Discord.js event handlers
  services/        // business logic (profiles, guild settings, XP, memory, rules)
  services/ai/     // Gemini client wrapper
  utils/           // logging helpers
schema.sql         // MySQL schema for phpMyAdmin or CLI import
.env.example       // required environment variables
```

## Setup
1. Copy `.env.example` to `.env` and fill in Discord, Gemini, and MySQL credentials.
2. Import `schema.sql` into your MySQL database (phpMyAdmin or CLI).
3. Install dependencies: `npm install`.
4. Start the bot: `npm start`.

### Birthday alerts
- Set `birthday_channel_id` in the `guilds` table to the target text channel ID for birthday heads-ups.
- Store user birthdays in the `users` table (`birthday` column) to enable the announcements.

## Key files
- `schema.sql` — tables for users, guilds, XP/levels, level roles, rulesets, lightweight memory, and birthday announcements.
- `src/index.js` — Discord client bootstrap, event registration, and process-level error logging.
- `src/events/messageCreate.js` — enforces the Selected User gating, trigger checks, prompt building, Gemini call, and XP updates.
- `src/services/*` — modular data access and business rules for guild settings, profiles, XP, rules, memory, and prompt composition.

## How the message flow works
1. `messageCreate` runs only in guilds and ignores bot messages.
2. The handler loads guild settings (ensuring a DB row) and verifies the author matches the guild’s Selected User.
3. It checks for triggers (mention, codeword hit, or replying to the bot). If none, nothing happens.
4. On trigger, the handler pulls the profile, memory, and rules, builds a structured prompt, calls Gemini, replies, and awards XP/roles with optional announcements.

## Multi-instance note
All bot instances share the same MySQL database. Swapping Discord tokens, names, or personalities simply changes the “face” of the bot; the shared data model keeps XP, profiles, rules, and Selected User enforcement consistent across instances.

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
5. (Optional) Set `DEV_GUILD_ID` to register slash commands instantly in a specific guild; otherwise they register globally.

## Slash command overview
All configuration and data entry runs through slash commands so every bot instance can share the same settings. Commands marked (Admin) require guild management permission.

### Access & triggers
- `/assign user:<@user>` (Admin) — set the guild’s Selected User the bot will respond to.
- `/codeword add word:<text>` — add a trigger word for the Selected User.
- `/codeword remove word:<text>` — remove a trigger word for the Selected User.
- `/codeword list` — list the active trigger words for the Selected User.

### Profiles & birthdays
- `/profile set-name name:<text>` — store the name the bot should use for the user.
- `/profile set-about text:<text>` — set the user’s short “about me”.
- `/profile set-preferences text:<text>` — update preferences or interests.
- `/profile set-birthday date:<YYYY-MM-DD>` — set the user’s birthday.
- `/profile show user:<@user|name>` — show the stored profile for a Discord user or stored name.
- `/birthday-channel set channel:<#channel>` (Admin) — choose where upcoming-birthday heads-ups are sent.
- `/birthday when user:<@user|name>` — ask when the stored birthday is.

### Rules
- `/rules add name:<text> type:<game|server|custom> summary:<text> content:<text>` (Admin or Selected User) — create a ruleset.
- `/rules remove name:<text>` (Admin) — delete a ruleset by name.
- `/rules list [type:<...>]` — list rulesets (optionally filter by type).
- `/rules show name:<text>` — display a ruleset so the AI can reference it.

### XP & roles
- `/xp [user:<@user>]` — show XP and level (defaults to the Selected User in the guild).
- `/leaderboard [limit:<number>]` — show the top users by XP in the guild.
- `/xprole add level:<number> role:<@role>` (Admin) — award a role when a level is reached.
- `/xprole remove level:<number>` (Admin) — remove a level → role mapping.
- `/xpchannel set channel:<#channel>` (Admin) — set the level-up announcement channel.
- `/xp set-amount amount:<number>` (Admin) — set XP per interaction for this guild.
- `/xp reset user:<@user>` (Admin) — reset a user’s XP/level in this guild.
- `/xp toggle enabled:<true|false>` (Admin) — enable or disable XP accrual.

### Languages, memory, and diagnostics
- `/language set primary:<code> [secondary:<code>] [secondary_enabled:<true|false>]` (Admin) — configure guild language preferences.
- `/memory add content:<text>` — add a lightweight memory entry for the Selected User in this guild.
- `/memory list [user:<@user|name>]` — view stored memory entries.
- `/memory clear id:<entry_id>` (Admin) — remove a memory entry.
- `/settings show` (Admin) — dump the guild configuration for quick inspection.

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

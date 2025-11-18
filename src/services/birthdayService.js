import { ensureUserGuildStats } from './xpService.js';
import { logDebug, logError } from '../utils/logger.js';

const UPCOMING_WINDOW_DAYS = 7;

function getUpcomingBirthday(birthdayValue) {
  if (!birthdayValue) return null;
  const birthday = new Date(birthdayValue);
  if (Number.isNaN(birthday.getTime())) return null;

  const now = new Date();
  const targetYear = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(targetYear, birthday.getUTCMonth(), birthday.getUTCDate()));
  const targetDate = candidate < now
    ? new Date(Date.UTC(targetYear + 1, birthday.getUTCMonth(), birthday.getUTCDate()))
    : candidate;

  const diffMs = targetDate.getTime() - now.getTime();
  const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return { targetDate, daysUntil };
}

export async function maybeSendUpcomingBirthdayMessage({ pool, guildRow, guild, userProfile }) {
  if (!guildRow.birthday_channel_id) return;

  const upcoming = getUpcomingBirthday(userProfile.birthday);
  if (!upcoming) return;

  const { targetDate, daysUntil } = upcoming;
  if (daysUntil < 0 || daysUntil > UPCOMING_WINDOW_DAYS) return;

  try {
    const stats = await ensureUserGuildStats(pool, userProfile.id, guildRow.id);
    const targetYear = targetDate.getUTCFullYear();
    if (stats.last_birthday_announcement_year === targetYear) {
      return;
    }

    const channel = guild.channels.cache.get(guildRow.birthday_channel_id);
    if (!channel?.isTextBased()) return;

    const dateText = targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const relativeText = daysUntil === 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
    await channel.send(`🎂 Heads up! <@${userProfile.discord_user_id}> has a birthday ${relativeText} (${dateText}).`);

    await pool.query('UPDATE user_guild_stats SET last_birthday_announcement_year = ? WHERE id = ?', [
      targetYear,
      stats.id
    ]);
    logDebug('Sent upcoming birthday announcement', {
      guildId: guild.id,
      userId: userProfile.discord_user_id,
      targetYear
    });
  } catch (err) {
    logError('Failed to send birthday announcement', err);
  }
}

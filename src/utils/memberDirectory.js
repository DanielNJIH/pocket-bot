import { logDebug } from './logger.js';
import { getGuildUserProfiles } from '../services/profileService.js';

export async function buildMemberNameMap(guild, userIds) {
  const map = new Map();
  if (!guild?.members?.fetch) return map;

  const idsToFetch = Array.from(new Set(userIds.filter(Boolean)));
  const batches = [];
  const batchSize = 50;
  for (let i = 0; i < idsToFetch.length; i += batchSize) {
    batches.push(idsToFetch.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    try {
      const members = await guild.members.fetch({ user: batch });
      members.forEach((member) => {
        map.set(member.id, member.displayName || member.user?.username || member.user?.tag);
      });
    } catch (err) {
      logDebug('Failed to fetch member names for batch', { error: err?.message, batch });
    }
  }

  return map;
}

export function applyNameFallback(profile, nameMap, fallbackName) {
  const discordName = nameMap.get(profile.discord_user_id) || profile.discord_name || fallbackName;
  const displayName = profile.display_name || discordName || fallbackName;
  return { ...profile, discord_name: discordName, display_name: displayName };
}

export async function buildGuildDirectory(pool, guild, guildRow, { excludeUserId } = {}) {
  const guildProfiles = await getGuildUserProfiles(pool, guildRow.id);
  const nameMap = await buildMemberNameMap(
    guild,
    guildProfiles.map((profile) => profile.discord_user_id)
  );

  const directory = guildProfiles
    .map((profile) => applyNameFallback(profile, nameMap, profile.discord_user_id))
    .filter((profile) => (excludeUserId ? profile.discord_user_id !== excludeUserId : true));

  return { directory, nameMap };
}

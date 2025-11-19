export function buildSelectedUserNames(userProfile, fallbackName) {
  const displayName = userProfile.display_name || userProfile.discord_name || fallbackName;
  const preferredRaw = userProfile.preferences?.preferred_name;
  const preferredName =
    typeof preferredRaw === 'string' && preferredRaw.trim() ? preferredRaw.trim() : displayName;
  return { displayName, preferredName };
}

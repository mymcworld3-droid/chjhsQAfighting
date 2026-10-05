// Equipment overrides the saved login-account photo. Pass an auth account only
// when resolving that account's own player, never when rendering another user.
export function resolvePlayerAvatar(player, account = null) {
  for (const value of [player?.equipped?.avatar, player?.photoURL, account?.photoURL]) {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2048);
  }
  return '';
}

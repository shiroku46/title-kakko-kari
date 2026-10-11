const PROFILE_KEY = 'title-kakko-kari:profile-v1';

export function rememberedName() {
  try {
    const profile = JSON.parse(globalThis.localStorage?.getItem(PROFILE_KEY) || 'null');
    return typeof profile?.nickname === 'string' ? profile.nickname.slice(0, 12) : '';
  } catch (_) { return ''; }
}

export function rememberName(nickname) {
  try { globalThis.localStorage?.setItem(PROFILE_KEY, JSON.stringify({ nickname })); }
  catch (_) { /* The current room still works without local storage. */ }
}

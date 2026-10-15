import { createAuthClient } from 'better-auth/react';
export const accountUrl = globalThis.location?.origin || 'https://title-kakko-kari.vercel.app';
export const authClient = createAuthClient({ baseURL: accountUrl });
export const discordCallbacks = { callbackURL: `${accountUrl}/`, errorCallbackURL: `${accountUrl}/?account_error=1` };
export function consumeAccountError() {
  try {
    const url = new URL(globalThis.location.href);
    if (!url.searchParams.has('account_error')) return '';
    for (const key of ['account_error', 'error', 'error_description']) url.searchParams.delete(key);
    globalThis.history.replaceState(null, '', url);
    return 'Discord でのログインを完了できませんでした。キャンセルした場合は、もう一度ログインを選べます。';
  } catch (_) { return ''; }
}
export async function readAccount() {
  try {
    const response = await fetch(`${accountUrl}/api/auth/status`, { credentials: 'same-origin' });
    if (!response.ok) return { configuration: { ready: false }, user: null };
    const configuration = await response.json();
    if (!configuration.ready) return { configuration, user: null };
    const session = await authClient.getSession();
    return { configuration, user: session.data?.user || null };
  } catch (_) { return { configuration: { ready: false }, user: null }; }
}

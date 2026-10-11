import { createAuthClient } from 'better-auth/react';
export const accountUrl = globalThis.location?.origin || 'https://title-kakko-kari.vercel.app';
export const authClient = createAuthClient({ baseURL: accountUrl });
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

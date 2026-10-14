import { DEFAULT_SERVER_URL } from '../config';
import { accountUrl, readAccount } from './accountAuth';

const KEY = 'title-kakko-kari:history-receipts-v1';
let memory = [];
export function historyReceipts() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) || 'null');
    if (Array.isArray(saved)) memory = saved;
  } catch (_) { /* Private browsing can keep receipts for this app session. */ }
  return memory.filter(receipt => receipt?.serverUrl === DEFAULT_SERVER_URL && typeof receipt.id === 'string' &&
    typeof receipt.playerId === 'string' && typeof receipt.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(receipt.token));
}

export function rememberHistory(session) {
  if (!session.roomId || session.serverUrl !== DEFAULT_SERVER_URL) return;
  memory = historyReceipts();
  const receipt = { id: session.roomId, playerId: session.playerId, token: session.token, serverUrl: session.serverUrl };
  memory = [...memory.filter(item => item.id !== receipt.id || item.playerId !== receipt.playerId), receipt];
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(memory)); } catch (_) { /* Keep the in-memory copy. */ }
  // The server verifies the cookie and seat secret; guest attempts remain guests.
  readAccount().then(({ user }) => user && historyRequest('link', { receipts: [receipt] })).catch(() => {});
}

export async function historyRequest(action, body = {}) {
  const receipts = (body.receipts || historyReceipts()).filter(receipt => action !== 'detail' || receipt.id === body.id);
  const items = new Map();
  let more = false, result;
  for (let offset = 0; offset < Math.max(receipts.length, 1); offset += 200) {
    const response = await fetch(`${accountUrl}/api/history/${action}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, receipts: receipts.slice(offset, offset + 200) }),
    });
    if (!response.ok) throw new Error(response.status === 404 ? 'この履歴は見つからないか、閲覧できません。' :
      '履歴を読み込めませんでした。接続を確認して、もう一度お試しください。');
    result = await response.json();
    if (action === 'list') {
      for (const item of result.items) items.set(item.id, item);
      more ||= Boolean(result.next);
    }
  }
  if (action !== 'list') return result;
  const ordered = [...items.values()].sort((a, b) => b.recordedAt - a.recordedAt || a.id.localeCompare(b.id));
  return { items: ordered.slice(0, 50), next: more || ordered.length > 50 ? ordered[49].id : null };
}

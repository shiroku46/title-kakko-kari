const STORAGE_KEY = 'title-kakko-kari:room-session-v1';
let memorySession = null;

export function getRoomSession() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return memorySession;
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    memorySession = saved && /^\d{6}$/.test(saved.code) && typeof saved.playerId === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(saved.token) && typeof saved.nickname === 'string' &&
        /^https?:\/\/[^\s/]+/i.test(saved.serverUrl) ? saved : null;
  } catch (_) { /* Storage may be unavailable in native or private browsing. */ }
  return memorySession;
}

export function saveRoomSession(session) {
  memorySession = session;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (_) { /* Keep this app session usable. */ }
}

export function clearRoomSession() {
  memorySession = null;
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch (_) { /* Storage may be unavailable. */ }
}

export function showRoom(navigation, result) {
  if (result.room.status === 'finished') {
    navigation.replace('Result', { finalScores: result.finalScores, winner: result.finalScores[0] });
  } else if (result.gameData) {
    navigation.replace('Game', { room: result.room, player: result.player, gameData: result.gameData });
  } else {
    navigation.replace('Lobby', { room: result.room, player: result.player, allPlayers: result.allPlayers });
  }
}

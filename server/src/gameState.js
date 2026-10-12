const { randomInt, randomUUID } = require('node:crypto');
const { loadRooms, saveRooms, REJOIN_WINDOW_MS } = require('./roomStore');

// One server owns the snapshot; ROOM_STATE_PATH must be on persistent storage
// for recovery across hosting-instance replacement.
const databaseConfigured = Object.hasOwn(process.env, 'DATABASE_URL');
const rooms = databaseConfigured ? new Map() : loadRooms();
let databaseStore;

async function initializeRooms(instanceId) {
  if (!databaseConfigured) return;
  try {
    if (!process.env.DATABASE_URL?.trim()) throw new Error();
    const { neon } = require('@neondatabase/serverless');
    const { createNeonRoomStore } = require('./neonRoomStore');
    const sql = neon(process.env.DATABASE_URL);
    databaseStore = createNeonRoomStore((query, params = []) =>
      sql.query(query, params, { fetchOptions: { signal: AbortSignal.timeout(10000) } }), instanceId);
    const saved = await databaseStore.load();
    rooms.clear();
    for (const [code, room] of saved) rooms.set(code, room);
  } catch (_) {
    throw new Error('部屋の永続保存先を初期化できません。DATABASE_URL と専用 DB を確認してください。');
  }
}

function roomStorageStatus() {
  return { mode: databaseConfigured ? 'neon' : 'file', ready: !databaseConfigured || Boolean(databaseStore?.ready) };
}

function requireRoomStorage() {
  if (roomStorageStatus().ready) return;
  const error = new Error('部屋の保存先へ接続できません。少し待って、もう一度お試しください。');
  error.code = 'ROOM_STORE_UNAVAILABLE';
  throw error;
}

function persistRooms() {
  requireRoomStorage();
  pruneRooms();
  if (databaseStore) return databaseStore.save(rooms);
  try { saveRooms(rooms); }
  catch (_) {
    const error = new Error('部屋を保存できませんでした。接続を確認して、もう一度お試しください。');
    error.code = 'ROOM_STORE_UNAVAILABLE'; throw error;
  }
}

function updateRoomExpiry(room) {
  room.expires_at = room.players.some((p) => p.is_connected && p.is_online && !p.is_computer)
    ? null : room.expires_at || Date.now() + REJOIN_WINDOW_MS;
}

function pruneRooms() {
  for (const [code, room] of rooms) {
    if (room.expires_at && room.expires_at <= Date.now()) rooms.delete(code);
  }
}

function createRoom() {
  requireRoomStorage();
  pruneRooms();
  let code;
  do { code = String(randomInt(0, 1000000)).padStart(6, '0'); } while (rooms.has(code));
  const room = {
    id: randomUUID(), code, status: 'waiting', settings: { genreDisclosure: false },
    current_round: 0, total_rounds: 0, players: [], rounds: [], usedQuestionIds: [], expires_at: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  requireRoomStorage();
  pruneRooms();
  const room = rooms.get(code);
  if (!room) throw new Error('ルームが見つかりません');
  return room;
}

function getMember(socket) {
  const room = getRoom(socket.data?.roomCode);
  const player = room.players.find((p) => p.id === socket.data.playerId &&
    p.socket_id === socket.id && p.is_connected);
  if (!player) throw new Error('ルームに参加していません');
  return { room, player };
}

function getCurrentRound(room) {
  const round = room.rounds.find((r) => r.round_number === room.current_round);
  if (!round) throw new Error('現在のラウンドが見つかりません');
  return round;
}

function connectedAnswerers(room, round) {
  return room.players.filter((p) => p.is_connected && !p.is_computer && p.id !== round.questioner_id);
}

// Keep the existing wire fields; never expose answers, votes, declarations or
// the real title through room:get_state / game:started / game:round_started.
function publicPlayer(player) {
  return {
    id: player.id, room_id: player.room_id, nickname: player.nickname,
    is_host: Boolean(player.is_host), is_computer: Boolean(player.is_computer),
    is_connected: Boolean(player.is_connected), is_online: Boolean(player.is_online),
    score: player.score, turn_order: player.turn_order ?? null,
    icon: player.icon || null, profile_ready: player.profile_ready !== false,
  };
}

function publicSettings(settings) {
  // Keep legacy durations readable for rooms whose timers are already running.
  return { genreDisclosure: Boolean(settings.genreDisclosure),
    advanceMode: settings.advanceMode === 'consent' ? 'consent' : 'auto',
    timeLimitSeconds: [30, 60, 120, 180, 300, 420].includes(settings.timeLimitSeconds) ? settings.timeLimitSeconds : 0 };
}

function publicRoom(room) {
  return {
    id: room.id, code: room.code, status: room.status,
    settings: publicSettings(room.settings), current_round: room.current_round,
    total_rounds: room.total_rounds, players: room.players.map(publicPlayer),
  };
}

function publicRound(round, room) {
  const kind = room?.settings.genreDisclosure && round.synopsis
    ? require('./questions/kinds').getGameGenre(round.workKind) : null;
  return {
    id: round.id, room_id: round.room_id, round_number: round.round_number,
    questioner_id: round.questioner_id, status: round.status,
    synopsis: round.synopsis, contentType: round.contentType ?? null,
    real_title: null, ...(kind && { workKind: kind.id, workKindLabel: kind.label }),
    deadlineAt: round.deadline_at || null, phaseReady: Boolean(round.phase_ready),
  };
}

function playerScores(room) {
  return room.players.map(({ id, nickname, score }) => ({ id, nickname, score }))
    .sort((a, b) => b.score - a.score);
}

function textInput(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}を入力してください`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}は${maxLength}文字以内で入力してください`);
  return text;
}

module.exports = {
  initializeRooms, roomStorageStatus, requireRoomStorage,
  rooms, createRoom, getRoom, getMember, getCurrentRound, connectedAnswerers,
  publicRoom, publicRound, publicPlayer, publicSettings, playerScores, textInput, persistRooms, updateRoomExpiry,
};

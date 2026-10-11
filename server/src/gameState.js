const { randomInt, randomUUID } = require('node:crypto');
const { loadRooms, saveRooms, REJOIN_WINDOW_MS } = require('./roomStore');

// One server owns the snapshot; ROOM_STATE_PATH must be on persistent storage
// for recovery across hosting-instance replacement.
const rooms = loadRooms();

function persistRooms() {
  pruneRooms();
  try { saveRooms(rooms); }
  catch (_) { throw new Error('部屋を保存できませんでした。接続を確認して、もう一度お試しください。'); }
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
  return { genreDisclosure: Boolean(settings.genreDisclosure),
    advanceMode: settings.advanceMode === 'consent' ? 'consent' : 'auto',
    timeLimitSeconds: [30, 60, 120, 180].includes(settings.timeLimitSeconds) ? settings.timeLimitSeconds : 0 };
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
    ? require('./questions/kinds').getKind(round.workKind) : null;
  return {
    id: round.id, room_id: round.room_id, round_number: round.round_number,
    questioner_id: round.questioner_id, status: round.status,
    synopsis: round.synopsis, contentType: round.contentType ?? null,
    real_title: null, ...(kind && { workKind: round.workKind, workKindLabel: kind.label }),
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
  rooms, createRoom, getRoom, getMember, getCurrentRound, connectedAnswerers,
  publicRoom, publicRound, publicPlayer, publicSettings, playerScores, textInput, persistRooms, updateRoomExpiry,
};

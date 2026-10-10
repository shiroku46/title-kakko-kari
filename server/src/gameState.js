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
  const { resume_hash, ...view } = player;
  return view;
}

function publicRoom(room) {
  const { rounds, usedQuestionIds, expires_at, ...view } = room;
  return { ...view, players: room.players.map(publicPlayer) };
}

function publicRound(round, room) {
  const { answers, votes, declarations, fetchVersion, fetchError, mvpAnswerId, sourceQuestion,
    previewConfirmed, manualCpu, workKind, roundScores, ...view } = round;
  const kind = room?.settings.genreDisclosure && round.synopsis ? require('./questions/kinds').getKind(workKind) : null;
  return { ...view, real_title: null, ...(kind && { workKind, workKindLabel: kind.label }) };
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
  publicRoom, publicRound, publicPlayer, playerScores, textInput, persistRooms, updateRoomExpiry,
};

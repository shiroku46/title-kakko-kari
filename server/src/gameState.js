const { randomInt, randomUUID } = require('node:crypto');

// ponytail: one process, session-only state. Add durable storage only when
// restart recovery or multiple server instances become a confirmed requirement.
const rooms = new Map();

function createRoom() {
  let code;
  do { code = String(randomInt(0, 1000000)).padStart(6, '0'); } while (rooms.has(code));
  const room = {
    id: randomUUID(), code, status: 'waiting', settings: {},
    current_round: 0, total_rounds: 0, players: [], rounds: [],
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
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
  return room.players.filter((p) => p.is_connected && p.id !== round.questioner_id);
}

// Keep the existing wire fields; never expose answers, votes, declarations or
// the real title through room:get_state / game:started / game:round_started.
function publicRoom(room) {
  const { rounds, ...view } = room;
  return view;
}

function publicRound(round) {
  const { answers, votes, declarations, fetchVersion, mvpAnswerId, ...view } = round;
  return { ...view, real_title: null };
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
  publicRoom, publicRound, playerScores, textInput,
};

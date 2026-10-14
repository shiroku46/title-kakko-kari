const fs = require('node:fs');
const path = require('node:path');

const statePath = process.env.ROOM_STATE_PATH || path.join(__dirname, '../data/rooms/state.json');
const REJOIN_WINDOW_MS = 24 * 60 * 60 * 1000;

function loadRooms() {
  if (!fs.existsSync(statePath)) return new Map();
  try {
    return deserializeRooms(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch {
    throw new Error('部屋の保存データを読み込めません。保存ファイルを保全して確認してください。');
  }
}

function deserializeRooms(saved) {
  try {
    if (saved.version !== 1 || !Array.isArray(saved.rooms)) throw new Error();
    const rooms = new Map();
    if (saved.history !== undefined && !Array.isArray(saved.history)) throw new Error();
    rooms.history = new Map(saved.history || []);
    for (const [id, entry] of rooms.history) {
      if (typeof id !== 'string' || entry?.detail?.id !== id || !entry.access ||
          typeof entry.access !== 'object' || Array.isArray(entry.access) ||
          !Array.isArray(entry.detail.rounds) || !Array.isArray(entry.detail.players)) throw new Error();
      for (const owner of Object.values(entry.access)) {
        if (!owner || !/^[a-f0-9]{64}$/.test(owner.hash) ||
            owner.userId != null && typeof owner.userId !== 'string') throw new Error();
      }
    }
    for (const room of saved.rooms) {
      if (!/^\d{6}$/.test(room.code) || typeof room.id !== 'string' ||
          !['waiting', 'playing', 'finished'].includes(room.status) ||
          !Array.isArray(room.players) || !Array.isArray(room.rounds) || !Array.isArray(room.usedQuestionIds) ||
          !room.settings || !Number.isInteger(room.current_round) || rooms.has(room.code)) throw new Error();
      if (room.password_hash != null && !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(room.password_hash)) throw new Error();
      if (room.expires_at && room.expires_at <= Date.now()) {
        const archived = rooms.history.get(room.id);
        if (archived?.detail.status === 'playing') archived.detail.status = 'interrupted';
        continue;
      }
      for (const player of room.players) {
        if (typeof player.id !== 'string' || typeof player.nickname !== 'string' || !Number.isFinite(player.score)) throw new Error();
        if (player.resume_hash && !/^[a-f0-9]{64}$/.test(player.resume_hash)) throw new Error();
        player.socket_id = null;
        player.is_online = Boolean(player.is_computer);
      }
      for (const round of room.rounds) {
        if (!Array.isArray(round.declarations) || !Array.isArray(round.answers) || !Array.isArray(round.votes)) throw new Error();
        round.declarations = new Map(round.declarations);
        if (round.status === 'voting') {
          round.deadline_at = null;
          round.phase_ready = room.players.filter((p) => p.is_connected && !p.is_computer && p.id !== round.questioner_id)
            .every((p) => round.votes.some((v) => v.voter_id === p.id));
        }
        if (round.questioner_id === null && round.status === 'selecting' && !round.synopsis) {
          round.fetchError = '接続が戻りました。もう一度、問題を取得してください。';
        }
      }
      if (room.status === 'playing' && !room.rounds.some((r) => r.round_number === room.current_round)) throw new Error();
      room.expires_at ||= Date.now() + REJOIN_WINDOW_MS;
      rooms.set(room.code, room);
    }
    return rooms;
  } catch {
    // A damaged snapshot must never be replaced with an empty game database.
    throw new Error('部屋の保存データを読み込めません。保存ファイルを保全して確認してください。');
  }
}

function serializeRooms(rooms) {
  return { version: 1, history: [...(rooms.history || [])], rooms: [...rooms.values()].map((room) => ({
    ...room, rounds: room.rounds.map((round) => ({ ...round, declarations: [...round.declarations] })),
  })) };
}

function saveRooms(rooms) {
  const data = serializeRooms(rooms);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

module.exports = { loadRooms, saveRooms, serializeRooms, deserializeRooms, REJOIN_WINDOW_MS };

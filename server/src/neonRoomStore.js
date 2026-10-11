const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { serializeRooms, deserializeRooms } = require('./roomStore');
const KEY = 'title-kakko-kari/v1';

function unavailable(uncertain = false) {
  const error = new Error('部屋の保存先へ接続できません。少し待って、もう一度お試しください。');
  error.code = 'ROOM_STORE_UNAVAILABLE';
  error.uncertain = uncertain;
  return error;
}

function createNeonRoomStore(query, writerId = randomUUID()) {
  let revision;
  let ready = false;
  return {
    get ready() { return ready; },
    async load() {
      ready = false;
      for (const statement of fs.readFileSync(path.join(__dirname, '../migrations/001-room-state.sql'), 'utf8').split(';')) {
        if (statement.trim()) await query(statement);
      }
      await query('INSERT INTO title_kakko_kari_room_state (state_key, revision, writer_id, commit_id, payload) VALUES ($1, 0, $2, $3, $4::jsonb) ON CONFLICT (state_key) DO NOTHING',
        [KEY, writerId, randomUUID(), JSON.stringify({ version: 1, rooms: [] })]);
      // The new process fences the former process before accepting any clients.
      const [saved] = await query('UPDATE title_kakko_kari_room_state SET writer_id=$2, revision=revision+1, updated_at=now() WHERE state_key=$1 RETURNING revision, payload', [KEY, writerId]);
      const rooms = deserializeRooms(saved?.payload);
      revision = Number(saved.revision);
      if (!Number.isSafeInteger(revision)) throw unavailable();
      ready = true;
      return rooms;
    },
    async save(rooms) {
      if (!ready) throw unavailable(true);
      const payload = JSON.stringify(serializeRooms(rooms));
      const commitId = randomUUID();
      try {
        const rows = await query('UPDATE title_kakko_kari_room_state SET payload=$4::jsonb, commit_id=$5, revision=revision+1, updated_at=now() WHERE state_key=$1 AND writer_id=$2 AND revision=$3 RETURNING revision',
          [KEY, writerId, revision, payload, commitId]);
        if (rows.length !== 1) { ready = false; throw unavailable(true); }
        const nextRevision = Number(rows[0].revision);
        if (!Number.isSafeInteger(nextRevision) || nextRevision !== revision + 1) { ready = false; throw unavailable(true); }
        revision = nextRevision;
        return;
      } catch {
        // A lost HTTP reply can follow a successful DB commit. Resolve its ID
        // before rolling back, so a retry cannot award a second score.
        try {
          const [saved] = await query('SELECT writer_id, revision, commit_id FROM title_kakko_kari_room_state WHERE state_key=$1', [KEY]);
          if (saved?.writer_id === writerId && saved.commit_id === commitId && Number(saved.revision) === revision + 1) {
            revision++;
            return;
          }
          if (ready && saved?.writer_id === writerId && Number(saved.revision) === revision) throw unavailable();
        } catch (error) {
          if (error.code === 'ROOM_STORE_UNAVAILABLE' && !error.uncertain) throw error;
        }
        // Unresolved or fenced state cannot be served or mutated until restart.
        ready = false;
        throw unavailable(true);
      }
    },
  };
}
module.exports = { createNeonRoomStore };

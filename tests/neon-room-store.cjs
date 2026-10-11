const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNeonRoomStore } = require('../server/src/neonRoomStore');
const { serializeRooms } = require('../server/src/roomStore');
const { randomUUID } = require('node:crypto');
function database() {
  let row; let mode;
  const query = async (text, params = []) => {
    if (/CREATE TABLE|REVOKE/.test(text)) return [];
    if (text.startsWith('INSERT')) { row ||= { revision: 0, writer_id: params[1], commit_id: params[2], payload: JSON.parse(params[3]) }; return []; }
    if (text.includes('SET writer_id')) { row.writer_id = params[1]; row.revision++; return [structuredClone(row)]; }
    if (text.startsWith('SELECT')) { if (mode === 'unresolved') throw new Error('private connection details'); return [structuredClone(row)]; }
    if (text.includes('SET payload')) {
      if (mode === 'before' || mode === 'unresolved') throw new Error('private connection details');
      if (row.writer_id !== params[1] || row.revision !== params[2]) return [];
      row.payload = JSON.parse(params[3]); row.commit_id = params[4]; row.revision++;
      if (mode === 'after') throw new Error('private connection details');
      return [{ revision: row.revision }];
    }
    throw new Error('Unexpected query');
  };
  return { query, get row() { return row; }, fail(value) { mode = value; } };
}
function rooms() {
  return new Map([['123456', { code: '123456', id: randomUUID(), status: 'playing', settings: {}, current_round: 1,
    usedQuestionIds: [], expires_at: null, players: [{ id: randomUUID(), nickname: '本人', score: 7,
      socket_id: 'old-transport', is_connected: true, is_online: true, resume_hash: 'a'.repeat(64) }],
    rounds: [{ id: randomUUID(), round_number: 1, questioner_id: 'q', status: 'revealed',
      declarations: new Map([['player', 'known']]), answers: [{ id: 'fake', title: '保存する回答' }],
      votes: [{ answer_id: 'fake' }], mvpAnswerId: 'fake', real_title: '保存する正解' }] }]]);
}
test('replacement writer restores Map, same seat, submissions, votes, score and MVP; former writer is fenced', async () => {
  const db = database(); const first = createNeonRoomStore(db.query); assert.equal((await first.load()).size, 0);
  const state = rooms(); await first.save(state); const revision = db.row.revision;
  const replacement = createNeonRoomStore(db.query); const loaded = await replacement.load();
  const restored = loaded.get('123456'); const original = state.get('123456');
  assert.equal(restored.id, original.id); assert.equal(restored.players[0].id, original.players[0].id);
  assert.equal(restored.players[0].socket_id, null); assert.equal(restored.players[0].is_online, false);
  assert.equal(restored.players[0].score, 7); assert.equal(restored.players[0].resume_hash, 'a'.repeat(64));
  assert(restored.rounds[0].declarations instanceof Map); assert.equal(restored.rounds[0].mvpAnswerId, 'fake');
  assert.deepEqual(restored.rounds[0].votes, original.rounds[0].votes);
  await assert.rejects(first.save(state), e => e.code === 'ROOM_STORE_UNAVAILABLE' && e.uncertain);
  assert.equal(first.ready, false); assert.equal(replacement.ready, true); assert.equal(db.row.revision, revision + 1);
  await replacement.save(loaded); assert.equal(db.row.payload.rooms[0].players[0].score, 7);
});
test('known failed save preserves database and remains retryable, without exposing private errors', async () => {
  const db = database(); const store = createNeonRoomStore(db.query); await store.load(); db.fail('before');
  await assert.rejects(store.save(rooms()), e => e.code === 'ROOM_STORE_UNAVAILABLE' && !e.uncertain && !e.message.includes('private'));
  assert.equal(store.ready, true); assert.equal(db.row.payload.rooms.length, 0);
  db.fail(null); await store.save(rooms()); assert.equal(db.row.payload.rooms.length, 1);
});
test('lost reply after actual commit is resolved by commit ID and never doubles score/revision', async () => {
  const db = database(); const store = createNeonRoomStore(db.query); await store.load(); const before = db.row.revision;
  db.fail('after'); await store.save(rooms()); assert.equal(store.ready, true);
  assert.equal(db.row.revision, before + 1); assert.equal(db.row.payload.rooms[0].players[0].score, 7);
  db.fail(null); await store.save(rooms()); assert.equal(db.row.revision, before + 2);
});
test('unknown commit outcome disables reads/writes until reload, rather than accepting an unsafe retry', async () => {
  const db = database(); const store = createNeonRoomStore(db.query); await store.load(); db.fail('unresolved');
  await assert.rejects(store.save(rooms()), e => e.code === 'ROOM_STORE_UNAVAILABLE' && e.uncertain);
  db.fail(null); await assert.rejects(store.save(rooms()), e => e.uncertain);
  await store.load(); assert.equal(store.ready, true); await store.save(rooms());
});
test('malformed saved payload fails closed and is preserved for investigation', async () => {
  const db = database(); const store = createNeonRoomStore(db.query); await store.load(); await store.save(rooms());
  db.row.payload.rooms[0].rounds[0].declarations = null; const damaged = JSON.stringify(db.row.payload);
  await assert.rejects(createNeonRoomStore(db.query).load(), /保存データ/);
  assert.equal(JSON.stringify(db.row.payload), damaged);
});

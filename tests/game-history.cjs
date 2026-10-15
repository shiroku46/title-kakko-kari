const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { recordHistory, readHistory, linkHistory, registerHistoryRoutes } = require('../server/src/gameHistory');
const { serializeRooms, deserializeRooms } = require('../server/src/roomStore');
const token = Buffer.alloc(32, 1).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
function fixture() {
  const room = { id: randomUUID(), code: '123456', status: 'playing', current_round: 1, total_rounds: 2,
    started_at: 1792000000000, settings: {}, usedQuestionIds: [],
    players: [{ id: 'human', nickname: '本人', score: 2, history_hash: hash },
      { id: 'cpu', nickname: 'CPU', is_computer: true, score: 1 }],
    rounds: [{ id: randomUUID(), round_number: 1, status: 'submitting', questioner_id: null,
      synopsis: '紹介文', real_title: '秘密の正解', workKind: 'novel', declarations: new Map(),
      answers: [{ id: 'fake', player_id: 'human', title: 'まだ秘密', is_real: false },
        { id: 'cpu-fake', player_id: 'cpu', title: 'CPUの回答', is_real: false },
        { id: 'real', player_id: null, title: '秘密の正解', is_real: true }],
      votes: [{ voter_id: 'human', answer_id: 'real' }],
      roundScores: [{ player_id: 'human', correct_pts: 1, deceive_pts: 0, total_pts: 1 }],
      mvpAnswerId: 'fake' }] };
  const rooms = new Map([[room.code, room]]);
  const receipt = { id: room.id, playerId: 'human', token };
  return { rooms, room, receipt };
}

test('history omits every unrevealed question, answer and vote, even for its owner', () => {
  const { rooms, room, receipt } = fixture();
  for (const phase of ['selecting', 'confirming', 'submitting', 'voting']) {
    room.rounds[0].status = phase;
    rooms.history = recordHistory(rooms);
    const result = readHistory(rooms, [receipt], null, room.id);
    assert.deepEqual(result.rounds, []);
    assert(!JSON.stringify(result).includes('秘密'));
    assert(!JSON.stringify(result).includes(hash));
  }
});

test('reveal/MVP, CPU answers, votes and scores survive repeated saves, deleted rooms and restart', () => {
  const { rooms, room, receipt } = fixture();
  room.rounds[0].status = 'revealed'; room.rounds[0].revealed_at = 1792000010000;
  rooms.history = recordHistory(rooms);
  rooms.history = recordHistory(rooms);
  assert.equal(rooms.history.size, 1);
  const result = readHistory(rooms, [receipt], null, room.id);
  assert.equal(result.rounds.length, 1); assert.equal(result.rounds[0].realTitle, '秘密の正解');
  assert.equal(result.rounds[0].answers[1].playerId, 'cpu');
  assert.equal(result.rounds[0].scores[0].total, 1);
  assert.equal(result.rounds[0].mvpAnswerId, 'fake');
  assert.equal(result.rounds[0].votes[0].voterId, 'human');
  room.status = 'finished'; rooms.history = recordHistory(rooms);
  result.status = 'finished';
  rooms.delete(room.code);
  const restored = deserializeRooms(JSON.parse(JSON.stringify(serializeRooms(rooms))));
  assert.equal(restored.size, 0);
  assert.deepEqual(readHistory(restored, [receipt], null, room.id), result);
});

test('unrelated users, guessed IDs, another player, invalid receipts and logged-out linked owners cannot read', () => {
  const { rooms, room, receipt } = fixture();
  rooms.history = recordHistory(rooms);
  for (const bad of [[], [{ ...receipt, token: Buffer.alloc(32, 2).toString('base64url') }], [{ ...receipt, playerId: 'cpu' }]]) {
    assert.equal(readHistory(rooms, bad, null, room.id), null);
    assert.deepEqual(readHistory(rooms, bad, 'outsider').items, []);
  }
  assert.throws(() => readHistory(rooms, new Array(201).fill(receipt)), /INVALID/);
  linkHistory(rooms, [receipt], 'account-1');
  assert.equal(readHistory(rooms, [receipt], null, room.id), null);
  assert.equal(readHistory(rooms, [receipt], 'account-2', room.id), null);
  assert(readHistory(rooms, [], 'account-1', room.id));
  linkHistory(rooms, [receipt], 'account-2');
  assert.equal(readHistory(rooms, [], 'account-2', room.id), null);
});

test('account links before game start persist and two distinct games never overwrite each other', () => {
  const a = fixture(), b = fixture(); b.room.code = '654321';
  a.rooms.set(b.room.code, b.room);
  linkHistory(a.rooms, [a.receipt, b.receipt], 'account-1');
  a.rooms.history = recordHistory(a.rooms);
  const restored = deserializeRooms(JSON.parse(JSON.stringify(serializeRooms(a.rooms))));
  assert.equal(readHistory(restored, [], 'account-1').items.length, 2);
  assert.equal(readHistory(restored, [], 'account-2').items.length, 0);
  assert.equal(readHistory(restored, [a.receipt], null).items.length, 0);
});

test('private history survives a real file-backed process restart after the live room is removed', t => {
  const fs = require('node:fs'), path = require('node:path');
  const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'title-history-restart-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const { rooms, room, receipt } = fixture();
  room.rounds[0].status = 'revealed'; rooms.history = recordHistory(rooms);
  linkHistory(rooms, [receipt], 'account-1'); rooms.clear();
  const payload = JSON.stringify(serializeRooms(rooms));
  const file = path.join(folder, 'state.json');
  const exec = source => require('node:child_process').execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, ROOM_STATE_PATH: file }, encoding: 'utf8',
  });
  exec(`const {deserializeRooms,saveRooms}=require('./server/src/roomStore');saveRooms(deserializeRooms(${payload}));`);
  const restored = JSON.parse(exec("const {loadRooms}=require('./server/src/roomStore');const {readHistory}=require('./server/src/gameHistory');console.log(JSON.stringify(readHistory(loadRooms(),[],'account-1')));"));
  assert.equal(restored.items.length, 1); assert.equal(restored.items[0].id, room.id);
});

test('pagination keeps chronological order across multiple receipt batches with no duplicates or loss', () => {
  const rooms = new Map(), receipts = [];
  for (let number = 0; number < 225; number++) {
    const fixtureGame = fixture();
    rooms.set(String(number), fixtureGame.room); receipts.push(fixtureGame.receipt);
    rooms.history = recordHistory(rooms, number + 1);
  }
  const seen = new Set(); let before;
  do {
    const pages = [receipts.slice(0, 200), receipts.slice(200)].map(batch => readHistory(rooms, batch, null, undefined, before));
    const items = pages.flatMap(page => page.items).sort((a, b) => b.recordedAt - a.recordedAt || a.id.localeCompare(b.id)).slice(0, 50);
    for (const item of items) { assert(!seen.has(item.id)); seen.add(item.id); }
    before = pages.some(page => page.next) || pages.flatMap(page => page.items).length > 50 ? items.at(-1).id : null;
  } while (before);
  assert.equal(seen.size, 225);
});

test('browser receipts retain 225 games across reload and request bounded batches without guest auth writes', async () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  const source = readFileSync(require('node:path').join(__dirname, '../client/src/utils/gameHistory.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\n({historyReceipts, rememberHistory, historyRequest})';
  const storage = new Map(), rooms = new Map(), batches = [];
  const context = { DEFAULT_SERVER_URL: 'https://server.example', accountUrl: 'https://game.example',
    readAccount: async () => ({ user: null }), localStorage: {
      getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
    }, fetch: async (url, options) => {
      const body = JSON.parse(options.body); batches.push(body.receipts.length);
      assert(url.endsWith('/list'));
      return { ok: true, json: async () => readHistory(rooms, body.receipts, null, undefined, body.before) };
    } };
  const api = runInNewContext(source, context);
  for (let number = 0; number < 225; number++) {
    const game = fixture(); rooms.set(String(number), game.room);
    rooms.history = recordHistory(rooms, number + 1);
    api.rememberHistory({ roomId: game.room.id, playerId: 'human', token, serverUrl: context.DEFAULT_SERVER_URL });
  }
  await Promise.resolve(); assert.equal(batches.length, 0);
  assert.equal(api.historyReceipts().length, 225);
  const reloaded = runInNewContext(source, { ...context });
  assert.equal(reloaded.historyReceipts().length, 225);
  const seen = new Set(); let before;
  do {
    const page = await reloaded.historyRequest('list', { before });
    for (const item of page.items) { assert(!seen.has(item.id)); seen.add(item.id); }
    before = page.next;
  } while (before);
  assert.equal(seen.size, 225); assert(batches.every(count => count <= 200));
});

test('OAuth cancellation UI removes provider error details from the URL and uses a fixed message', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../client/src/utils/accountAuth.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\n({consumeAccountError,discordCallbacks})';
  let replaced;
  const context = { URL, createAuthClient: () => ({}), location: {
    origin: 'https://game.example', href: 'https://game.example/?account_error=1&error=access_denied&error_description=provider-private-detail',
  }, history: { replaceState: (_a, _b, url) => { replaced = String(url); } } };
  const api = vm.runInNewContext(source, context);
  assert(api.consumeAccountError().includes('キャンセル'));
  assert.equal(replaced, 'https://game.example/');
  assert.equal(api.discordCallbacks.errorCallbackURL, 'https://game.example/?account_error=1');
});

test('old snapshots load without invented records; interrupted games keep only completed rounds', () => {
  const { rooms, room, receipt } = fixture();
  const saved = serializeRooms(rooms); delete saved.history;
  assert.equal(deserializeRooms(saved).history.size, 0);
  room.rounds[0].status = 'revealed';
  room.rounds.push({ ...structuredClone(room.rounds[0]), id: randomUUID(), status: 'voting' });
  room.history_interrupted = true; room.status = 'finished';
  rooms.history = recordHistory(rooms);
  const result = readHistory(rooms, [receipt], null, room.id);
  assert.equal(result.status, 'interrupted'); assert.equal(result.rounds.length, 1);
  room.history_interrupted = false; room.status = 'playing'; rooms.history = recordHistory(rooms);
  rooms.clear();
  assert.equal(readHistory(rooms, [receipt], null, room.id).status, 'interrupted');
  assert.throws(() => deserializeRooms({ version: 1, rooms: [], history: [['broken', {}]] }));
});

test('real HTTP routes reject foreign origins, unknown IDs and forged login; failed linking rolls back', async t => {
  const express = require('../server/node_modules/express');
  const { rooms, room, receipt } = fixture(); rooms.history = recordHistory(rooms);
  let fail = false;
  const app = express();
  registerHistoryRoutes(app, { rooms, persist: async () => { if (fail) throw new Error('private connection'); },
    requireStorage() {}, run: operation => operation(), getSession: async headers =>
      headers.cookie === 'verified-test-session' ? { user: { id: 'account-1' } } : null,
    origin: () => 'https://game.example' });
  const server = app.listen(0, '127.0.0.1');
  await require('node:events').once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (action, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/history/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://game.example', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await request('list', { receipts: [receipt] }, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await request('link', { receipts: [receipt], userId: 'account-1' })).status, 401);
  assert.equal((await request('detail', { receipts: [], id: room.id })).status, 404);
  const detail = await request('detail', { receipts: [receipt], id: room.id });
  assert.equal(detail.headers.get('cache-control'), 'no-store'); assert.equal(detail.status, 200);
  fail = true;
  assert.equal((await request('link', { receipts: [receipt] }, { Cookie: 'verified-test-session' })).status, 503);
  assert(readHistory(rooms, [receipt], null, room.id)); assert.equal(room.players[0].history_user_id, undefined);
  fail = false;
  assert.equal((await request('link', { receipts: [receipt] }, { Cookie: 'verified-test-session' })).status, 200);
  assert.equal((await request('detail', { receipts: [receipt], id: room.id })).status, 404);
  assert.equal((await request('detail', { receipts: [], id: room.id }, { Cookie: 'verified-test-session' })).status, 200);
});

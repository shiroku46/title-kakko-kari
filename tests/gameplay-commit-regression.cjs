'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
delete process.env.DATABASE_URL;
const { commitGameAction, runStateOperation } = require('../server/src/socket/commitGameAction');

function loadSource(path, mocks) {
  const module = { exports: {} };
  runInNewContext(readFileSync(join(__dirname, '..', path), 'utf8'), {
    module, exports: module.exports, structuredClone, console, process, AbortController,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('node:')) return require(name);
      throw new Error('Unmocked dependency: ' + name);
    },
  }, { filename: path });
  return module.exports;
}
function recorder(order = []) {
  const events = [];
  return { events, io: { to(target) { return { emit(event, ...args) {
    order.push('emit:' + event); events.push({ target, event, args }); return true;
  } }; } } };
}

test('durable snapshot precedes event; queued payload cannot change afterwards', async () => {
  const order = [];
  const { io, events } = recorder(order);
  const room = { players: [{ score: 0 }] };
  commitGameAction(io, room, () => {
    assert.equal(events.length, 0);
    assert.equal(room.players[0].score, 1);
    order.push('persist');
  }, (stagedIo) => {
    room.players[0].score = 1;
    const payload = { score: 1 };
    stagedIo.to('room').emit('round:mvp_selected', payload);
    payload.score = 99;
  });
  assert.deepEqual(order, ['persist', 'emit:round:mvp_selected']);
  assert.equal(events[0].args[0].score, 1);
});

test('failed write restores score, MVP and declaration Map; publishes no result', async () => {
  const { io, events } = recorder();
  const room = { players: [{ score: 0 }], rounds: [{ mvpAnswerId: null, declarations: new Map([['a', 'unknown']]) }] };
  let capturedIo;
  assert.throws(() => commitGameAction(io, room, () => { throw new Error('disk full'); }, (stagedIo) => {
    capturedIo = stagedIo;
    room.players[0].score++;
    room.rounds[0].mvpAnswerId = 'fake';
    room.rounds[0].declarations.set('b', 'known');
    stagedIo.to('room').emit('round:mvp_selected', { score: 1 });
  }), /disk full/);
  assert.equal(room.players[0].score, 0);
  assert.equal(room.rounds[0].mvpAnswerId, null);
  assert.deepEqual([...room.rounds[0].declarations], [['a', 'unknown']]);
  capturedIo.to('room').emit('late', {});
  assert.equal(events.length, 0);
});

test('unchanged validation failure preserves pending-fetch object identity', async () => {
  const round = { synopsis: null, declarations: new Map() };
  const room = { rounds: [round] };
  let writes = 0;
  assert.throws(() => commitGameAction(recorder().io, room, () => writes++, () => {
    throw new Error('not ready');
  }), /not ready/);
  assert.equal(room.rounds[0], round);
  assert.equal(writes, 0);
});

test('delivery failure keeps committed score available for authoritative recovery', async () => {
  const room = { score: 0 };
  let durable;
  const io = { to() { return { emit() { throw new Error('transport lost'); } }; } };
  commitGameAction(io, room, () => { durable = structuredClone(room); }, (stagedIo) => {
    room.score = 1; stagedIo.to('room').emit('result', { score: 1 });
  });
  assert.equal(room.score, 1);
  assert.equal(durable.score, 1);
});

test('external effects start only after save; their failure cannot roll back committed state', async () => {
  const room = { score: 0 };
  let effects = 0;
  assert.throws(() => commitGameAction(recorder().io, room, () => { throw new Error('write failed'); }, (_, defer) => {
    room.score++;
    defer(() => effects++);
  }), /write failed/);
  assert.equal(effects, 0);
  commitGameAction(recorder().io, room, () => {}, (_, defer) => {
    room.score++;
    defer(() => { effects++; throw new Error('delivery failed'); });
  });
  assert.equal(room.score, 1);
  assert.equal(effects, 1);
});

function fixture(phase = 'revealed') {
  const players = ['q', 'a', 'b', 'c'].map((id) => ({
    id, room_id: 'room-id', nickname: id, socket_id: 'socket-' + id,
    is_host: id === 'q', is_computer: false, is_connected: true, is_online: true,
    score: 0, turn_order: null, resume_hash: 'private-' + id,
  }));
  const round = { id: 'round-id', room_id: 'room-id', round_number: 1,
    questioner_id: 'q', status: phase, synopsis: '作品の紹介', real_title: '本物',
    contentType: 'synopsis', workKind: null, sourceQuestion: null, previewConfirmed: true,
    mvpAnswerId: null, declarations: new Map(), answers: [
      { id: 'real', title: '本物', player_id: null, is_real: true },
      { id: 'fake-a', title: '偽A', player_id: 'a', is_real: false },
      { id: 'fake-b', title: '偽B', player_id: 'b', is_real: false },
      { id: 'fake-c', title: '偽C', player_id: 'c', is_real: false },
    ], votes: [], roundScores: [] };
  const room = { id: 'room-id', code: '123456', status: 'playing',
    players, rounds: [round], current_round: 1, total_rounds: 3,
    settings: { genreDisclosure: false }, usedQuestionIds: [] };
  let failWrite = false;
  let durable;
  let pendingWrite;
  const order = [];
  const { io, events } = recorder(order);
  const dto = loadSource('server/src/gameState.js', {
    './roomStore': { loadRooms: () => new Map(), saveRooms() {}, REJOIN_WINDOW_MS: 86400000 },
    './questions/kinds': require('../server/src/questions/kinds'),
  });
  const state = { ...dto, rooms: new Map([[room.code, room]]),
    getRoom: () => room, getCurrentRound: () => room.rounds[0],
    getMember: (socket) => ({ room, player: room.players.find((p) => p.id === socket.data.playerId) }),
    persistRooms() {
      order.push('persist');
      if (failWrite) throw new Error('保存に失敗しました');
      const saved = structuredClone(room);
      if (pendingWrite) return pendingWrite.then(() => { durable = saved; });
      durable = saved;
    },
  };
  const game = loadSource('server/src/socket/gameHandlers.js', {
    '../utils/shuffle': { shuffle: (array) => array },
    '../questions': { selectQuestionAsync: async () => { throw new Error('unexpected fetch'); } },
    '../questions/kinds': require('../server/src/questions/kinds'), '../questions/quality': { MAX_LENGTH: 1500 },
    '../computerTitles': { generateComputerTitles: () => [] },
    './commitGameAction': { commitGameAction, runStateOperation }, '../gameState': state,
  });
  function register(id, installer) {
    const handlers = new Map();
    const socket = { id: 'socket-' + id, data: { playerId: id, roomCode: room.code },
      on: (event, handler) => handlers.set(event, handler) };
    installer(io, socket);
    return (event, payload = {}) => new Promise((resolve) => {
      handlers.get(event)({ roundId: room.rounds.find(r => r.round_number === room.current_round)?.id, ...payload }, (result) => { order.push('ack'); resolve(result); });
    });
  }
  return { room, dto, state, game, io, events, order,
    command: (id) => register(id, game.registerGameHandlers),
    register, delay(promise) { pendingWrite = promise; }, fail(value) { failWrite = value; }, durable: () => durable };
}

test('real MVP handler: failed save, retry, duplicate and resume cannot double-credit', async () => {
  const f = fixture();
  const command = f.command('q');
  f.fail(true);
  assert.equal((await command('round:submit_mvp', { answerId: 'fake-a' })).ok, false);
  assert.equal(f.room.players.find((p) => p.id === 'a').score, 0);
  assert.equal(f.room.rounds[0].mvpAnswerId, null);
  assert.equal(f.events.length, 0);
  f.fail(false);
  assert.equal((await command('round:submit_mvp', { answerId: 'fake-a' })).ok, true);
  assert.equal((await command('round:submit_mvp', { answerId: 'fake-a' })).ok, false);
  assert.equal(f.room.players.find((p) => p.id === 'a').score, 1);
  assert.equal(f.durable().players.find((p) => p.id === 'a').score, 1);
  assert.equal(f.events.filter((e) => e.event === 'round:mvp_selected').length, 1);
  assert.equal(f.game.getResumeGame(f.room, f.room.players[0]).resumeState.mvpData.playerId, 'a');
  assert.equal(f.room.players.find((p) => p.id === 'a').score, 1);
});

test('real last vote: failed reveal save remains voting; retry scores once after persistence', async () => {
  const f = fixture('voting');
  f.room.rounds[0].votes = [{ voter_id: 'a', answer_id: 'real' }, { voter_id: 'b', answer_id: 'fake-a' }];
  const command = f.command('c');
  f.fail(true);
  assert.equal((await command('round:submit_vote', { answerId: 'real' })).ok, false);
  assert.equal(f.room.rounds[0].status, 'voting');
  assert.equal(f.room.rounds[0].votes.length, 2);
  assert.equal(f.room.players.find((p) => p.id === 'a').score, 0);
  assert.equal(f.events.length, 0);
  f.fail(false);
  f.order.length = 0;
  assert.equal((await command('round:submit_vote', { answerId: 'real' })).ok, true);
  assert.equal(f.room.rounds[0].status, 'revealed');
  assert.equal(f.room.players.find((p) => p.id === 'a').score, 2);
  assert.equal(f.room.players.find((p) => p.id === 'c').score, 1);
  assert.equal(f.order[0], 'persist');
  assert.equal((await command('round:submit_vote', { answerId: 'real' })).ok, false);
  assert.equal(f.events.filter((e) => e.event === 'round:revealed').length, 1);
});

test('legacy short-story/literature snapshots display novel without rewriting stored classification', () => {
  for (const kind of ['short-story', 'literary-work']) {
    const f = fixture('selecting'), round = f.room.rounds[0];
    f.room.settings.genreDisclosure = true; round.workKind = kind;
    const restored = f.game.getResumeGame(f.room, f.room.players[0]);
    assert.equal(restored.round.workKind, 'novel');
    assert.equal(restored.round.workKindLabel, '小説');
    assert.equal(restored.resumeState.workKind, 'novel');
    assert.equal(round.workKind, kind);
  }
});

test('resume declaration uses UUID and retains legacy names; unknown clears that UUID', async () => {
  const f = fixture('selecting');
  const command = f.command('a');
  assert.equal((await command('round:declare_known')).ok, true);
  f.room.players.find((p) => p.id === 'a').nickname = '変更した名前';
  let saved = f.game.getResumeGame(f.room, f.room.players[0]).resumeState;
  assert.deepEqual(structuredClone(saved.knownPlayerIds), ['a']);
  assert.deepEqual(structuredClone(saved.knownDeclarations), ['変更した名前']);
  assert.equal((await command('round:declare_unknown')).ok, true);
  saved = f.game.getResumeGame(f.room, f.room.players[0]).resumeState;
  assert.equal(saved.knownPlayerIds.length, 0);
});

test('room/player/settings/round DTOs exclude current and future credentials and answer state', async () => {
  const f = fixture();
  f.room.password_hash = 'secret-room-password';
  f.room.settings.oauthSecret = 'secret-oauth';
  f.room.players[1].email = 'private@example.invalid';
  const publicRoom = f.dto.publicRoom(f.room);
  const json = JSON.stringify(publicRoom);
  for (const secret of ['private-a', 'socket-a', 'private@example.invalid', 'secret-room-password', 'secret-oauth', '本物', '偽A']) {
    assert.equal(json.includes(secret), false, secret);
  }
  assert.equal(publicRoom.players[1].is_online, true);
  assert.equal(publicRoom.players[1].room_id, 'room-id');
  assert.equal(f.dto.publicRound(f.room.rounds[0], f.room).real_title, null);
  assert.equal(Object.hasOwn(f.dto.publicRound(f.room.rounds[0], f.room), 'answers'), false);
  f.room.players[1].is_online = false;
  assert.equal(f.dto.publicPlayer(f.room.players[1]).is_connected, true);
  assert.equal(f.dto.publicPlayer(f.room.players[1]).is_online, false);
  const resumed = f.game.getResumeGame(f.room, f.room.players[1]);
  assert.equal(Object.hasOwn(resumed.settings, 'oauthSecret'), false);
  assert.equal(resumed.resumeState.questionerView, null);
  for (const seconds of [30, 120]) {
    f.room.settings.timeLimitSeconds = seconds;
    assert.equal(f.dto.publicRoom(f.room).settings.timeLimitSeconds, seconds);
    assert.equal(f.game.getResumeGame(f.room, f.room.players[1]).settings.timeLimitSeconds, seconds);
    assert.equal(f.room.settings.timeLimitSeconds, seconds);
  }
});

test('lobby CPU/settings failed writes restore previous state and publish nothing', async () => {
  const f = fixture();
  f.room.status = 'waiting';
  const installer = loadSource('server/src/socket/roomHandlers.js', {
    '../gameState': f.state, './gameHandlers': { getResumeGame: f.game.getResumeGame },
    './commitGameAction': { commitGameAction, runStateOperation }, '../roomPassword': require('../server/src/roomPassword'),
  }).registerRoomHandlers;
  const command = f.register('q', installer);
  const beforePlayers = f.room.players;
  const beforeSettings = f.room.settings;
  f.fail(true);
  assert.equal((await command('room:set_computers', { count: 1 })).ok, false);
  assert.equal(f.room.players, beforePlayers);
  assert.equal((await command('room:update_settings', { genreDisclosure: true })).ok, false);
  assert.equal(f.room.settings, beforeSettings);
  assert.equal(f.events.length, 0);
});

test('failed introduction and final advancement restore state and publish no success', async () => {
  const introduction = fixture('selecting');
  introduction.room.rounds[0].synopsis = null;
  introduction.room.rounds[0].real_title = null;
  const originalRound = introduction.room.rounds[0];
  introduction.fail(true);
  assert.equal((await introduction.command('q')('round:submit_synopsis', { synopsis: '港町の物語', realTitle: '本物' })).ok, false);
  assert.equal(introduction.room.rounds[0], originalRound);
  assert.equal(originalRound.synopsis, null);
  assert.equal(introduction.events.length, 0);
  const ending = fixture('revealed');
  ending.room.total_rounds = 1;
  ending.room.rounds[0].mvpAnswerId = 'fake-a';
  ending.fail(true);
  assert.equal((await ending.command('q')('game:next_round')).ok, false);
  assert.equal(ending.room.status, 'playing');
  assert.equal(ending.events.length, 0);
});

test('consent mode waits for the controller, including deadline expiry and restart fields', async () => {
  const f = fixture('submitting');
  f.room.settings = { genreDisclosure: false, advanceMode: 'consent', timeLimitSeconds: 30 };
  const round = f.room.rounds[0];
  round.answers = round.answers.filter((a) => !a.is_real);
  f.game.checkRoundProgress(f.io, f.room, round);
  assert.equal(round.status, 'submitting');
  assert.equal(round.phase_ready, true);
  assert.equal((await f.command('a')('round:advance_phase')).ok, false);
  assert.equal((await f.command('q')('round:advance_phase')).ok, true);
  assert.equal(round.status, 'voting');
  assert(round.deadline_at > Date.now());
  round.deadline_at = Date.now() - 1;
  await f.game.checkRoundTimers(f.io);
  assert.equal(round.status, 'voting');
  assert.equal(round.phase_ready, true);
  assert.equal((await f.command('q')('round:advance_phase')).ok, true);
  assert.equal(round.status, 'revealed');
});

test('automatic expiry uses only submitted titles and never makes an empty MVP round', async () => {
  const f = fixture('submitting');
  const round = f.room.rounds[0];
  round.answers = [];
  round.deadline_at = Date.now() - 1;
  await f.game.checkRoundTimers(f.io);
  assert.equal(round.status, 'submitting');
  assert.equal((await f.command('a')('round:submit_fake', { title: '遅れて届いた案' })).ok, true);
  assert.equal(round.status, 'voting');
  round.deadline_at = Date.now() - 1;
  round.timer_notified = false;
  await f.game.checkRoundTimers(f.io);
  assert.equal(round.status, 'revealed');
  assert.equal((await f.command('q')('round:submit_mvp', { answerId: round.answers.find((a) => !a.is_real).id })).ok, true);
});

test('pending asynchronous score save blocks duplicate, recovery reads, timer, fetch completion and exit until commit', async () => {
  const f = fixture(); let release;
  f.delay(new Promise(resolve => { release = resolve; }));
  const command = f.command('q');
  const first = command('round:submit_mvp', { answerId: 'fake-a' });
  const duplicate = command('round:submit_mvp', { answerId: 'fake-a' });
  const observations = [];
  const followers = ['recovery', 'timer', 'fetch', 'exit'].map(name => runStateOperation(() => {
    observations.push(name); assert.equal(f.durable().players[1].score, f.room.players[1].score);
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.length, 0); assert.equal(f.durable(), undefined); assert.equal(observations.length, 0);
  release(); assert.equal((await first).ok, true); assert.equal((await duplicate).ok, false); await Promise.all(followers);
  assert.equal(f.events.filter(e => e.event === 'round:mvp_selected').length, 1);
  assert.deepEqual(observations, ['recovery', 'timer', 'fetch', 'exit']);
});
test('asynchronous write rejection restores object identity and allows the next queued operation to retry', async () => {
  const f = fixture(); const round = f.room.rounds[0]; const player = f.room.players[1]; let reject;
  f.delay(new Promise((_, fail) => { reject = fail; }));
  const command = f.command('q'); const first = command('round:submit_mvp', { answerId: 'fake-a' });
  await new Promise(resolve => setImmediate(resolve)); reject(new Error('保存できません'));
  assert.equal((await first).ok, false); assert.equal(f.room.rounds[0], round); assert.equal(f.room.players[1], player);
  assert.equal(player.score, 0); assert.equal(round.mvpAnswerId, null); assert.equal(f.events.length, 0);
  f.delay(null); assert.equal((await command('round:submit_mvp', { answerId: 'fake-a' })).ok, true);
});
test('old round UUID and missing UUID reject every mutating round command before writing', async () => {
  const f = fixture('submitting'); const command = f.command('a'); const before = structuredClone(f.room);
  for (const roundId of ['former-round', null]) for (const event of ['round:submit_fake', 'round:submit_vote', 'round:declare_known',
    'round:declare_unknown', 'round:submit_synopsis', 'round:reselect', 'round:start_submitting', 'round:advance_phase',
    'round:confirm_synopsis', 'round:reroll_synopsis', 'round:use_manual', 'round:submit_mvp', 'game:next_round']) {
    const response = await command(event, { roundId, title: '古い回答', answerId: 'fake-a' });
    assert.equal(response.ok, false); assert.match(response.error, /古いラウンド/);
  }
  assert.deepEqual(f.room, before); assert.equal(f.order.length, 26); assert.equal(f.events.length, 0);
});

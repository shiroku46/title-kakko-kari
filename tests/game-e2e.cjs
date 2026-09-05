const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: connect } = require('../client/node_modules/socket.io-client');

// Exercise the real Express/Socket.IO server in production mode, without any
// database credentials. Only Wikipedia is replaced for repeatable CPU rounds.
process.env.NODE_ENV = 'production';
process.env.ALLOW_THREE_PLAYER_DEV = 'true';
process.env.ALLOWED_ORIGINS = 'https://game.example';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { server, io } = require('../server/src/index');
const { rooms } = require('../server/src/gameState');
const originalFetch = global.fetch;
let wikipediaFails = false;
let url;
let article = 0;
before(async () => {
  global.fetch = async (input, init) => {
    if (String(input).startsWith('https://ja.wikipedia.org/')) {
      if (wikipediaFails) return new Response('{}', { status: 503 });
      const title = `正解${++article}`;
      return Response.json({ title, extract: `${title}の紹介。` + '知られていない作品のあらすじ。'.repeat(12) });
    }
    return originalFetch(input, init);
  };
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve) => io.close(resolve));
});

async function bot(t, transport = 'websocket') {
  const socket = connect(url, {
    transports: [transport], extraHeaders: { Origin: 'https://game.example' },
    reconnection: false,
  });
  const events = [];
  socket.onAny((name, data) => events.push({ name, data }));
  t.after(() => socket.disconnect());
  await once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
  return { socket, events };
}
function ack(b, event, payload = null) {
  return new Promise((resolve, reject) => b.socket.timeout(3000).emit(event, payload,
    (error, response) => error ? reject(error) : resolve(response)));
}
async function ok(b, event, payload) {
  const response = await ack(b, event, payload);
  assert.equal(response.ok, true, `${event}: ${response.error}`);
  return response;
}
async function denied(b, event, payload) {
  const response = await ack(b, event, payload);
  assert.equal(response.ok, false, event);
  assert.equal(typeof response.error, 'string');
}
async function event(b, name) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const index = b.events.findIndex((e) => e.name === name);
    if (index !== -1) return b.events.splice(index, 1)[0].data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Missing event: ${name}`);
}
async function roomWith(t, count) {
  const bots = [];
  for (let i = 0; i < count; i++) bots.push(await bot(t, i % 2 ? 'polling' : 'websocket'));
  const created = await ok(bots[0], 'room:create', { nickname: '参加者0' });
  bots[0].player = created.player;
  assert.match(created.room.code, /^\d{6}$/);
  for (let i = 1; i < count; i++) {
    const joined = await ok(bots[i], 'room:join', { code: created.room.code, nickname: `参加者${i}` });
    bots[i].player = joined.player;
    assert.equal(joined.allPlayers.length, i + 1);
  }
  return { bots, room: created.room };
}

test('health, CORS and both Socket.IO transports without database configuration', async (t) => {
  const res = await fetch(`${url}/health`, { headers: { Origin: 'https://game.example' } });
  assert.equal((await res.json()).status, 'ok');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://game.example');
  assert.equal((await fetch(`${url}/health/supabase`)).status, 404);
  for (const transport of ['polling', 'websocket']) {
    const blocked = connect(url, { transports: [transport], reconnection: false,
      extraHeaders: { Origin: 'https://denied.example' } });
    t.after(() => blocked.disconnect());
    await once(blocked, 'connect_error', { signal: AbortSignal.timeout(3000) });
    assert.equal(blocked.connected, false);
  }
  const b = await bot(t);
  await denied(b, 'game:start');
  await denied(b, 'room:create', { nickname: 12 });
  await denied(b, 'room:create', null);
  b.socket.emit('room:create', { nickname: null }); // Missing callback must not crash.
  await ok(b, 'room:create', { nickname: '有効' });
  await denied(b, 'room:create', { nickname: '二部屋目' });
});

test('production requires 4, concurrent joins stop at 6, duplicate names rejected', async (t) => {
  const { bots, room } = await roomWith(t, 3);
  await denied(bots[0], 'game:start', { mode: 'player' });
  const newcomers = await Promise.all(Array.from({ length: 5 }, () => bot(t)));
  const results = await Promise.all(newcomers.map((b, i) => ack(b, 'room:join', { code: room.code, nickname: `追加${i}` })));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal((await ok(bots[0], 'room:get_state')).room.players.length, 6);
  const other = await bot(t);
  await denied(other, 'room:join', { code: 'XXXXXX', nickname: 'なし' });
  const small = await roomWith(t, 1);
  await denied(other, 'room:join', { code: small.room.code, nickname: '参加者0' });
});

for (const count of [4, 5, 6]) {
  for (const mode of ['player', 'cpu']) {
    test(`${count} players / ${mode}: create → join → start → submit → vote → result → final`, async (t) => {
      const { bots } = await roomWith(t, count);
      const host = bots[0];
      await denied(bots[1], 'game:start', { mode });
      const starts = await Promise.all([ack(host, 'game:start', { mode, totalRounds: 2 }), ack(host, 'game:start', { mode })]);
      assert.equal(starts.filter((r) => r.ok).length, 1);
      let data = await event(host, 'game:started');
      assert.equal(data.totalRounds, mode === 'player' ? count : 2);
      assert.equal(data.round.real_title, null);
      if (mode === 'player') assert.equal(new Set(data.playerOrder.map((p) => p.turnOrder)).size, count);
      const expected = new Map(bots.map((b) => [b.player.id, 0]));
      let previousAnswerId;
      for (let r = 1; r <= data.totalRounds; r++) {
        const questioner = bots.find((b) => b.player.id === data.questioner?.id);
        const answerers = bots.filter((b) => b !== questioner);
        let realTitle;
        if (mode === 'player') {
          realTitle = `作品${r}`;
          await denied(answerers[0], 'round:submit_synopsis', { synopsis: '不正', realTitle });
          await ok(questioner, 'round:submit_synopsis', { synopsis: `あらすじ${r}`, realTitle });
          await denied(questioner, 'round:start_submitting');
          await ok(answerers[0], 'round:declare_known');
          await denied(questioner, 'round:start_submitting');
          await ok(questioner, 'round:reselect');
          await ok(questioner, 'round:submit_synopsis', { synopsis: `あらすじ${r}`, realTitle });
          await Promise.all(answerers.map((b) => ok(b, 'round:declare_unknown')));
          await event(questioner, 'round:all_declared');
          await ok(questioner, 'round:start_submitting');
        } else {
          await event(host, 'round:synopsis_fetched');
          await denied(bots[1], 'round:confirm_synopsis');
          await ok(host, 'round:confirm_synopsis');
          realTitle = `正解${article}`;
          for (const b of bots) {
            const presented = await event(b, 'round:synopsis_presented');
            assert.ok(presented.synopsis.includes('■■■'));
            assert.ok(!presented.synopsis.includes(realTitle));
          }
        }
        const state = await ok(answerers[0], 'room:get_state');
        assert.ok(!JSON.stringify(state).includes(realTitle));
        assert.equal(state.room.rounds, undefined);
        await denied(host, 'game:next_round');
        const duplicates = await Promise.all([ack(answerers[0], 'round:submit_fake', { title: '偽物0' }), ack(answerers[0], 'round:submit_fake', { title: '重複' })]);
        assert.equal(duplicates.filter((v) => v.ok).length, 1);
        await Promise.all(answerers.slice(1).map((b, i) => ok(b, 'round:submit_fake', { title: `偽物${i + 1}` })));
        const { choices } = await event(host, 'round:choices_presented');
        assert.equal(choices.length, answerers.length + 1);
        assert.ok(choices.every((c) => Object.keys(c).sort().join() === 'displayOrder,id,title'));
        assert.equal(host.events.filter((e) => e.name === 'round:choices_presented').length, 0);
        const real = choices.find((c) => c.title === realTitle);
        const lure = choices.find((c) => c.title === '偽物0');
        assert.ok(real);
        await denied(answerers[0], 'round:submit_vote', { answerId: lure.id });
        await denied(answerers[0], 'round:submit_vote', { answerId: previousAnswerId || 'invalid' });
        const votes = await Promise.all([ack(answerers[0], 'round:submit_vote', { answerId: real.id }), ack(answerers[0], 'round:submit_vote', { answerId: real.id })]);
        assert.equal(votes.filter((v) => v.ok).length, 1);
        await Promise.all(answerers.slice(1).map((b) => ok(b, 'round:submit_vote', { answerId: lure.id })));
        const revealed = await event(host, 'round:revealed');
        assert.equal(revealed.realTitle, realTitle);
        assert.equal(revealed.votes.length, answerers.length);
        const scorer = answerers[0].player.id;
        expected.set(scorer, expected.get(scorer) + answerers.length);
        const points = revealed.roundScores.find((p) => p.player_id === scorer);
        assert.deepEqual(points, { player_id: scorer, correct_pts: 1, deceive_pts: answerers.length - 1, total_pts: answerers.length });
        for (const p of revealed.playerScores) assert.equal(p.score, expected.get(p.id));
        if (questioner) {
          await denied(answerers[0], 'round:submit_mvp', { answerId: lure.id });
          await denied(questioner, 'round:submit_mvp', { answerId: real.id });
          const mvp = await Promise.all([ack(questioner, 'round:submit_mvp', { answerId: lure.id }), ack(questioner, 'round:submit_mvp', { answerId: lure.id })]);
          assert.equal(mvp.filter((v) => v.ok).length, 1);
          expected.set(scorer, expected.get(scorer) + 1);
          const selected = await event(host, 'round:mvp_selected');
          for (const p of selected.playerScores) assert.equal(p.score, expected.get(p.id));
        }
        previousAnswerId = lure.id;
        await ok(host, 'game:next_round');
        if (r < data.totalRounds) data = await event(host, 'game:round_started');
      }
      const finished = await event(host, 'game:finished');
      for (const p of finished.finalScores) assert.equal(p.score, expected.get(p.id));
      assert.equal(finished.winner.score, Math.max(...expected.values()));
      await denied(host, 'game:next_round');
    });
  }
}

test('CPU fetch failure remains retryable', async (t) => {
  const { bots } = await roomWith(t, 4);
  wikipediaFails = true;
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(bots[0], 'round:synopsis_fetch_failed');
  await denied(bots[0], 'round:confirm_synopsis');
  wikipediaFails = false;
  await ok(bots[0], 'round:reroll_synopsis');
  await event(bots[0], 'round:synopsis_fetched');
  await ok(bots[0], 'round:confirm_synopsis');
});

test('disconnect updates host, removes empty rooms and cannot restore another identity', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  bots[0].socket.disconnect();
  await event(bots[1], 'room:player_disconnected');
  const state = await ok(bots[1], 'room:get_state');
  assert.equal(state.room.players.length, 3);
  assert.equal(state.room.players.find((p) => p.id === bots[1].player.id).is_host, true);
  for (const b of bots.slice(1)) b.socket.disconnect();
  for (let i = 0; rooms.has(room.code) && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rooms.has(room.code), false);
  const fresh = await bot(t);
  await denied(fresh, 'room:join', { code: room.code, nickname: '参加者1' });
  await denied(fresh, 'room:get_state');
});

test('disconnect does not count an absent answerer toward completion', async (t) => {
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(bots[0], 'round:synopsis_fetched');
  await ok(bots[0], 'round:confirm_synopsis');
  await ok(bots[1], 'round:submit_fake', { title: '退室者の案' });
  bots[1].socket.disconnect();
  await event(bots[0], 'room:player_disconnected');
  await ok(bots[0], 'round:submit_fake', { title: '案0' });
  await ok(bots[2], 'round:submit_fake', { title: '案2' });
  assert.equal(bots[0].events.some((e) => e.name === 'round:choices_presented'), false);
  await ok(bots[3], 'round:submit_fake', { title: '案3' });
  const { choices } = await event(bots[0], 'round:choices_presented');
  const real = choices.find((c) => c.title.startsWith('正解'));
  await ok(bots[2], 'round:submit_vote', { answerId: real.id });
  bots[2].socket.disconnect();
  await event(bots[0], 'room:player_disconnected');
  await ok(bots[0], 'round:submit_vote', { answerId: real.id });
  assert.equal(bots[0].events.some((e) => e.name === 'round:revealed'), false);
  await ok(bots[3], 'round:submit_vote', { answerId: real.id });
  await event(bots[0], 'round:revealed');
  await ok(bots[0], 'game:next_round');
  await event(bots[0], 'game:finished');
});

test('CPU host departure transfers the confirmed candidate synopsis', async (t) => {
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const initial = await event(bots[0], 'round:synopsis_fetched');
  bots[0].socket.disconnect();
  const transferred = await event(bots[1], 'round:synopsis_fetched');
  assert.equal(transferred.synopsis, initial.synopsis);
  await ok(bots[1], 'round:confirm_synopsis');
});

test('questioner departure permits host skip but normal selecting cannot be skipped', async (t) => {
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  await denied(bots[0], 'game:next_round');
  const questioner = bots.find((b) => b.player.id === started.questioner.id);
  const remaining = bots.filter((b) => b !== questioner);
  questioner.socket.disconnect();
  await event(remaining[0], 'game:questioner_disconnected');
  await ok(remaining[0], 'game:next_round');
  const next = await event(remaining[0], 'game:round_started');
  assert.equal(next.currentRound, 2);
});

// Opt-in real-time check: no application actions or health probes during 25 minutes.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const directory = mkdtempSync(join(tmpdir(), 'title-session-soak-'));
process.env.ROOM_STATE_PATH = join(directory, 'rooms.json');
process.env.QUESTION_COLLECTION_ENABLED = 'false';
process.env.NODE_ENV = 'production';
const { server, io } = require('../server/src/index');
const { rooms } = require('../server/src/gameState');
const { io: connect } = require('../client/node_modules/socket.io-client');
const sockets = [];
const duration = 25 * 60 * 1000;
function request(socket, event, payload) {
  if (event.startsWith('round:') || event === 'game:next_round') {
    const room = [...rooms.values()].find(r => r.players.some(p => p.socket_id === socket.id));
    payload = { roundId: room?.rounds.find(r => r.round_number === room.current_round)?.id, ...payload };
  }
  return new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (error, result) => {
    if (error) return reject(error);
    if (!result?.ok) return reject(new Error(result?.error || '応答を確認できません'));
    resolve(result);
  }));
}
async function group(url, computers, transport) {
  const members = [];
  let code;
  for (let i = 0; i < 4 - computers; i++) {
    const socket = connect(url, { transports: [transport], reconnection: false });
    sockets.push(socket);
    await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
    const entry = await request(socket, i ? 'room:join' : 'room:create', { nickname: `検証${i}`, code });
    code = entry.room.code;
    members.push({ socket, id: entry.player.id, originalSocketId: socket.id });
  }
  if (computers) await request(members[0].socket, 'room:set_computers', { count: computers });
  await request(members[0].socket, 'game:start', { mode: 'player' });
  const room = rooms.get(code);
  const round = room.rounds[0];
  const questioner = members.find((p) => p.id === round.questioner_id);
  await request(questioner.socket, 'round:submit_synopsis', { realTitle: '放置検証の正解', synopsis: '港町で暮らす青年が、消えた手紙を探す。' });
  const answerers = members.filter((p) => p !== questioner);
  for (const p of answerers) await request(p.socket, 'round:declare_unknown');
  await request(questioner.socket, 'round:start_submitting');
  return { room, round, questioner, answerers, members, transport, computers };
}
(async () => {
  let timer;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const groups = [await group(url, 0, 'polling'), await group(url, 1, 'websocket')];
    const startedAt = new Date();
    let disconnects = 0;
    for (const socket of sockets) socket.on('disconnect', () => disconnects++);
    console.log(JSON.stringify({ status: 'idle_started', startedAt, minutes: 25 }));
    timer = setInterval(() => console.log(JSON.stringify({ elapsedMinutes: Math.floor((Date.now() - startedAt) / 60000), disconnects })), 60000);
    await new Promise((resolve) => setTimeout(resolve, duration));
    clearInterval(timer);
    assert.equal(disconnects, 0);
    for (const g of groups) {
      assert.equal(rooms.get(g.room.code), g.room);
      assert.equal(g.room.expires_at, null);
      assert.equal(g.round.status, 'submitting');
      for (const p of g.members) assert.equal(p.socket.id, p.originalSocketId);
      for (const [i, p] of g.answerers.entries()) await request(p.socket, 'round:submit_fake', { title: `放置後の案${i}` });
      const real = g.round.answers.find((a) => a.is_real);
      for (const p of g.answerers) await request(p.socket, 'round:submit_vote', { answerId: real.id });
      await request(g.questioner.socket, 'round:submit_mvp', { answerId: g.round.answers.find((a) => !a.is_real).id });
      await request(g.questioner.socket, 'game:next_round');
      assert.equal(g.room.current_round, 2);
    }
    console.log(JSON.stringify({ status: 'passed', startedAt, completedAt: new Date(), elapsedMs: Date.now() - startedAt,
      disconnects, groups: groups.map((g) => ({ humans: g.members.length, computers: g.computers, transport: g.transport, continuedRound: g.room.current_round })) }));
  } finally {
    clearInterval(timer);
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

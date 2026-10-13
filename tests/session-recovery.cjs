const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { io: connect } = require('../client/node_modules/socket.io-client');
const directory = mkdtempSync(join(tmpdir(), 'title-session-recovery-'));
const statePath = join(directory, 'rooms.json');
let child;
let url;
const childCode = `require('./server/node_modules/dotenv').config=()=>({parsed:{}});
delete process.env.DATABASE_URL;
const {server}=require('./server/src/index');
server.listen(0,'127.0.0.1',()=>process.send(server.address().port));`;
async function startServer() {
  child = spawn(process.execPath, ['-e', childCode], { cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', ROOM_STATE_PATH: statePath, QUESTION_COLLECTION_ENABLED: 'false', ALLOWED_ORIGINS: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume();
  child.stderr.resume();
  const [port] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  url = `http://127.0.0.1:${port}`;
}
async function stopServer() {
  const exiting = once(child, 'exit');
  child.kill();
  await exiting;
}
before(startServer);
after(async () => { await stopServer(); rmSync(directory, { recursive: true, force: true }); });
async function client(t, transport = 'websocket') {
  const socket = connect(url, { transports: [transport], reconnection: false });
  const events = [];
  socket.onAny((name, data) => {
    if (data?.round?.id) socket.currentRoundId = data.round.id;
    events.push({ name, data });
  });
  t.after(() => socket.disconnect());
  await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
  return { socket, events };
}
async function request(member, event, payload) {
  await new Promise(resolve => setTimeout(resolve, 10));
  if (event.startsWith('round:') || event === 'game:next_round') {
    payload = { roundId: member.socket.currentRoundId, ...payload };
  }
  return new Promise((resolve, reject) => member.socket.timeout(5000).emit(event, payload,
    (error, response) => {
      if (response?.gameData?.round?.id) member.socket.currentRoundId = response.gameData.round.id;
      error ? reject(error) : resolve(response);
    }));
}
async function ok(member, event, payload) {
  const result = await request(member, event, payload);
  assert.equal(result?.ok, true, `${event}: ${result?.error}`);
  return result;
}
function credential(entry) { return { code: entry.room.code, playerId: entry.player.id, token: entry.token }; }
async function drop(member) {
  const disconnected = once(member.socket, 'disconnect', { signal: AbortSignal.timeout(5000) });
  member.socket.io.engine.close();
  await disconnected;
}
async function resume(t, entry, transport) {
  const member = await client(t, transport);
  const state = await ok(member, 'room:resume', credential(entry));
  assert.equal(state.player.id, entry.player.id);
  return { ...member, entry, state };
}
async function game(t) {
  const members = [];
  let code;
  for (let i = 0; i < 3; i++) {
    const member = await client(t);
    member.entry = await ok(member, i ? 'room:join' : 'room:create', { nickname: `復帰${i}`, code });
    code = member.entry.room.code;
    members.push(member);
  }
  await ok(members[0], 'room:set_computers', { count: 1 });
  await ok(members[0], 'game:start', { mode: 'player' });
  const started = members[0].events.find((e) => e.name === 'game:started').data;
  const questioner = members.find((m) => m.entry.player.id === started.questioner.id);
  const answerers = members.filter((m) => m !== questioner);
  await ok(questioner, 'round:submit_synopsis', { synopsis: '海辺の街で、青年が失われた手紙を探す。', realTitle: '復帰検証の正解作品' });
  return { members, questioner, answerers, started };
}

test('seat credentials stay private; code, another seat and malformed tokens cannot restore identity', async (t) => {
  const host = await client(t);
  const entry = await ok(host, 'room:create', { nickname: '本人' });
  assert.match(entry.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(entry.player.resume_hash, undefined);
  const guest = await client(t);
  const joined = await ok(guest, 'room:join', { nickname: '別人', code: entry.room.code });
  const publicState = await ok(guest, 'room:get_state');
  const publicWire = JSON.stringify({ publicState, events: host.events });
  assert(!publicWire.includes(entry.token));
  assert(!publicWire.includes('resume_hash'));
  const saved = readFileSync(statePath, 'utf8');
  assert(!saved.includes(entry.token));
  assert(!saved.includes(joined.token));
  assert.equal(existsSync(`${statePath}.tmp`), false);
  const attacker = await client(t);
  for (const payload of [{ code: entry.room.code }, { ...credential(entry), token: joined.token },
    { ...credential(entry), token: 'x' }, { ...credential(entry), token: 'x'.repeat(43) }]) {
    const denied = await request(attacker, 'room:resume', payload);
    assert.equal(denied.ok, false);
    assert.equal(denied.rejoinUnavailable, true);
    assert(!JSON.stringify(denied).includes(entry.token));
  }
  assert.equal((await request(guest, 'room:resume', credential(entry))).ok, false);
});

test('fresh browser sockets restore declarations, submissions, private questioner view, votes, scores and MVP', async (t) => {
  const initialHealth = await (await fetch(`${url}/health`)).json();
  assert.match(initialHealth.instanceId, /^[a-f0-9-]{36}$/);
  assert(Number.isInteger(initialHealth.uptimeSeconds) && initialHealth.uptimeSeconds >= 0);
  const g = await game(t);
  const entries = g.members.map((m) => m.entry);
  await ok(g.answerers[0], 'round:declare_unknown');
  await drop(g.questioner);
  const q = await resume(t, g.questioner.entry, 'polling');
  const selecting = q.state.gameData.resumeState;
  assert.equal(selecting.phase, 'selecting');
  assert.equal(selecting.questionerView.realTitle, '復帰検証の正解作品');
  const a = await resume(t, g.answerers[0].entry);
  assert.equal(a.state.gameData.resumeState.declaration, 'unknown');
  assert.equal(a.state.gameData.resumeState.questionerView, null);
  assert(!JSON.stringify(a.state).includes('復帰検証の正解作品'));
  await ok(g.answerers[1], 'round:declare_unknown');
  await ok(q, 'round:start_submitting');
  await ok(a, 'round:submit_fake', { title: '保存する偽のタイトル' });
  await drop(a);
  const restored = await resume(t, a.entry);
  assert.equal(restored.state.gameData.resumeState.submitted, true);
  assert.equal(restored.state.gameData.resumeState.submittedTitle, '保存する偽のタイトル');
  assert.equal((await request(restored, 'round:submit_fake', { title: '差し替え後のタイトル' })).ok, true);
  const updated = await ok(restored, 'room:resume', credential(restored.entry));
  assert.equal(updated.gameData.resumeState.submittedTitle, '差し替え後のタイトル');
  // One human answer plus one automatically submitted computer title.
  assert.equal(updated.gameData.resumeState.fakeSubmittedCount, 2);
  assert.equal(updated.gameData.resumeState.fakeSubmissionTotal, 3);
  const qView = await ok(q, 'room:resume', credential(q.entry));
  assert.equal(qView.gameData.resumeState.questionerView.answers.length, 2);
  assert(qView.gameData.resumeState.questionerView.answers.some((answer) => answer.title === '差し替え後のタイトル'));
  await ok(g.answerers[1], 'round:submit_fake', { title: 'もう一人の案' });
  const voting = await ok(restored, 'room:resume', credential(restored.entry));
  assert.equal(voting.gameData.resumeState.phase, 'voting');
  assert(voting.gameData.resumeState.ownAnswerId);
  assert(voting.gameData.resumeState.choices.every((c) => !('is_real' in c) && !('player_id' in c)));
  const real = voting.gameData.resumeState.choices.find((c) => c.title === '復帰検証の正解作品');
  await ok(restored, 'round:submit_vote', { answerId: real.id });
  await drop(restored);
  const voter = await resume(t, restored.entry);
  assert.equal(voter.state.gameData.resumeState.voted, true);
  assert.equal(voter.state.gameData.resumeState.voteAnswerId, real.id);
  await ok(g.answerers[1], 'round:submit_vote', { answerId: real.id });
  const revealed = await ok(q, 'room:resume', credential(q.entry));
  assert.equal(revealed.gameData.resumeState.phase, 'revealed');
  assert.equal(revealed.gameData.resumeState.revealData.realTitle, '復帰検証の正解作品');
  assert.equal((await request(q, 'game:next_round')).ok, false);
  const fake = revealed.gameData.resumeState.revealData.answers.find((x) => x.author?.id === a.entry.player.id);
  await ok(q, 'round:submit_mvp', { answerId: fake.id });
  const awarded = await ok(q, 'room:resume', credential(q.entry));
  assert.equal(awarded.gameData.resumeState.mvpData.answerId, fake.id);
  assert.equal(awarded.gameData.resumeState.revealData.playerScores.find((p) => p.id === a.entry.player.id).score, 2);
  await ok(voter, 'room:update_profile', { nickname: '変更後も同じ席', icon: '🦊' });
  // Abrupt process loss tests the actual snapshot on retained storage, not a mocked loader.
  await stopServer();
  await startServer();
  const restartedHealth = await (await fetch(`${url}/health`)).json();
  assert.notEqual(restartedHealth.instanceId, initialHealth.instanceId);
  assert.equal(restartedHealth.release, initialHealth.release);
  const rejoined = [];
  for (const entry of entries) rejoined.push(await resume(t, entry));
  const renamed = rejoined.find((m) => m.entry.player.id === a.entry.player.id).state.player;
  assert.equal(renamed.nickname, '変更後も同じ席');
  assert.equal(renamed.icon, null);
  const afterRestart = rejoined.find((m) => m.entry.player.id === q.entry.player.id).state;
  assert.equal(afterRestart.room.code, q.entry.room.code);
  assert.equal(afterRestart.gameData.resumeState.mvpData.answerId, fake.id);
  assert.equal(afterRestart.gameData.resumeState.revealData.playerScores.find((p) => p.id === a.entry.player.id).score, 2);
  await ok(rejoined.find((m) => m.entry.player.id === q.entry.player.id), 'game:next_round');
  assert.equal((await ok(rejoined[0], 'room:resume', credential(rejoined[0].entry))).gameData.currentRound, 2);
});

for (const completed of [false, true]) test(`restart removes legacy voting expiry and restores ${completed ? 'completed' : 'partial'} vote readiness`, async (t) => {
  const g = await game(t);
  for (const m of g.answerers) await ok(m, 'round:declare_unknown');
  await ok(g.questioner, 'round:start_submitting');
  for (const [i, m] of g.answerers.entries()) await ok(m, 'round:submit_fake', { title: `保存する案${i}` });
  await stopServer();
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  const room = saved.rooms.find((r) => r.code === g.questioner.entry.room.code);
  const round = room.rounds.find((r) => r.round_number === room.current_round);
  room.settings.advanceMode = 'consent';
  room.settings.timeLimitSeconds = 60;
  round.deadline_at = Date.now() - 1;
  round.phase_ready = true;
  round.timer_notified = true;
  const real = round.answers.find((a) => a.is_real);
  round.votes = g.answerers.slice(0, completed ? g.answerers.length : 1)
    .map((m) => ({ voter_id: m.entry.player.id, answer_id: real.id }));
  writeFileSync(statePath, JSON.stringify(saved));
  await startServer();
  const restored = [];
  for (const m of g.members) restored.push(await resume(t, m.entry));
  const questioner = restored.find((m) => m.entry.player.id === g.questioner.entry.player.id);
  assert.equal(questioner.state.gameData.resumeState.phase, 'voting');
  assert.equal(questioner.state.gameData.round.deadlineAt, null);
  assert.equal(questioner.state.gameData.round.phaseReady, completed);
  assert.equal(questioner.state.gameData.resumeState.voteProgress.voted, round.votes.length);
  if (!completed) {
    assert.equal((await request(questioner, 'round:advance_phase')).ok, false);
    const remaining = restored.find((m) => m.entry.player.id === g.answerers[1].entry.player.id);
    await ok(remaining, 'round:submit_vote', { answerId: real.id });
  }
  await ok(questioner, 'round:advance_phase');
  const revealed = await ok(questioner, 'room:resume', credential(questioner.entry));
  assert.equal(revealed.gameData.resumeState.phase, 'revealed');
  assert.equal(revealed.gameData.resumeState.revealData.votes.length, g.answerers.length);
});

test('all transports can disappear beyond the packet window without deletion or a game stop', async (t) => {
  const g = await game(t);
  for (const m of g.answerers) await ok(m, 'round:declare_unknown');
  await ok(g.questioner, 'round:start_submitting');
  for (const m of g.members) await drop(m);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const snapshot = JSON.parse(readFileSync(statePath, 'utf8')).rooms.find((r) => r.code === g.members[0].entry.room.code);
  assert.equal(snapshot.status, 'playing');
  assert(snapshot.players.filter((p) => !p.is_computer).every((p) => p.is_connected && !p.is_online));
  assert(snapshot.expires_at >= Date.now() + 23 * 60 * 60 * 1000);
  // A restart discards Socket.IO replay state entirely; private credentials still restore each seat.
  await stopServer();
  await startServer();
  for (const m of g.members) {
    const restored = await resume(t, m.entry);
    assert.equal(restored.socket.recovered, false);
    assert.equal(restored.state.gameData.resumeState.phase, 'submitting');
  }
});

test('explicit exit revokes the credential while an authenticated takeover preserves the seat', async (t) => {
  const host = await client(t);
  const entry = await ok(host, 'room:create', { nickname: '旧画面' });
  const displaced = once(host.socket, 'disconnect');
  const replacement = await resume(t, entry);
  assert.equal((await displaced)[0], 'io server disconnect');
  assert.equal((await ok(replacement, 'room:get_state')).room.players.length, 1);
  await ok(replacement, 'room:leave');
  const next = await client(t);
  const denied = await request(next, 'room:resume', credential(entry));
  assert.equal(denied.ok, false);
  assert.equal(denied.rejoinUnavailable, true);
});

test('an explicit host exit chooses an online human ahead of a reserved offline seat', async (t) => {
  const host = await client(t);
  const entry = await ok(host, 'room:create', { nickname: '退出ホスト' });
  const offline = await client(t);
  await ok(offline, 'room:join', { nickname: '復帰待ち', code: entry.room.code });
  const online = await client(t);
  const guest = await ok(online, 'room:join', { nickname: '接続中', code: entry.room.code });
  await drop(offline);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await ok(host, 'room:leave');
  const state = await ok(online, 'room:get_state');
  assert.equal(state.room.players.find((p) => p.id === guest.player.id).is_host, true);
  assert.equal(state.room.players.find((p) => p.nickname === '復帰待ち').is_connected, true);
});

test('offline expiry and corrupt snapshots fail closed without overwriting saved data', async (t) => {
  const member = await client(t);
  const entry = await ok(member, 'room:create', { nickname: '期限検証' });
  await drop(member);
  await stopServer();
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  saved.rooms.find((r) => r.code === entry.room.code).expires_at = Date.now() - 1;
  writeFileSync(statePath, JSON.stringify(saved));
  await startServer();
  const next = await client(t);
  assert.equal((await request(next, 'room:resume', credential(entry))).ok, false);
  await stopServer();
  const brokenPath = join(directory, 'broken.json');
  writeFileSync(brokenPath, '{incomplete');
  const broken = spawn(process.execPath, ['-e', childCode], { cwd: join(__dirname, '..'),
    env: { ...process.env, ROOM_STATE_PATH: brokenPath, QUESTION_COLLECTION_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  broken.stderr.on('data', (data) => { stderr += data; });
  const [exitCode] = await once(broken, 'exit');
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /部屋の保存データを読み込めません/);
  assert.equal(readFileSync(brokenPath, 'utf8'), '{incomplete');
  await startServer();
});

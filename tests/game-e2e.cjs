const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { io: connect } = require('../client/node_modules/socket.io-client');

// Exercise the real Express/Socket.IO server in production mode, without any
// database credentials or external fetching. CPU rounds use a trusted fixture.
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'title-question-bank-e2e-'));
const fixturePath = join(fixtureDirectory, 'bank.json');
const fixtureQuestions = Array.from({ length: 6 }, (_, i) => {
  const realTitle = `正解の物語${i + 1}のお話`;
  const synopsis = `港町で起こる事件のあらすじ識別${i + 1}。` +
    'ある青年は見知らぬ街で暮らし始める。失われた手紙を探すうちに、住民たちの秘密を知る。青年は友人と力を合わせ、故郷への道を探して旅に出る。'.repeat(3);
  const sourceText = synopsis.replace('■■■', realTitle);
  return {
    id: `test-novel-${i + 1}`, realTitle, aliases: [], kind: 'novel', synopsis,
    sources: [{
      label: `Wikipedia：${realTitle}`,
      url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(realTitle)}?oldid=${i + 100}`,
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      revisionId: i + 100,
      retrievedAt: '2026-10-01T00:00:00.000Z',
    }],
    generationMethod: 'extractive-v1',
    evidence: {
      sourceId: `wikipedia-ja-${i + 1000}-${i + 100}`,
      section: 'あらすじ',
      sourceTextSha256: createHash('sha256').update(sourceText).digest('hex'),
      excerpts: sourceText.match(/[^。]+。/gu),
    },
  };
});
const openResourceText =
  '街で暮らす青年が失われた手紙を探し始める。住民たちに話を聞くうちに、家族の秘密を知る。青年は友人たちと協力して旅に出る。'.repeat(3);
const openResourceQuestion = {
  id: 'aozora-128', realTitle: '公開資料の物語', aliases: [], kind: 'novel',
  synopsis: openResourceText.replaceAll('公開資料の物語', '■■■'),
  sources: [
    { ...fixtureQuestions[0].sources[0], label: 'Wikipedia：公開資料の物語',
      url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent('公開資料の物語') + '?oldid=100' },
    {
      provider: 'aozora', label: '青空文庫「公開資料の物語」',
      url: 'https://www.aozora.gr.jp/cards/000879/card128.html',
      textUrl: 'https://www.aozora.gr.jp/cards/000879/files/128_15261.html',
      retrievedAt: '2026-10-01T00:00:00.000Z',
      license: '著作権なし（青空文庫公開情報）',
    },
    {
      provider: 'ndl', role: 'bibliography', label: '国立国会図書館サーチ「公開資料の物語」',
      url: 'https://ndlsearch.ndl.go.jp/books/R100000002-I000000000001',
      retrievedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      provider: 'ndl', role: 'archive', label: '国立国会図書館デジタルコレクション「公開資料の物語」',
      url: 'https://dl.ndl.go.jp/pid/1234567',
      retrievedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  generationMethod: 'extractive-v1',
  evidence: {
    sourceId: 'wikipedia-ja-128-100', section: 'あらすじ',
    sourceTextSha256: createHash('sha256').update(openResourceText).digest('hex'),
    excerpts: openResourceText.match(/[^。]+。/gu),
  },
};
const genreQuestions = [
  ['manga', 'synopsis'], ['anime', 'synopsis'], ['song', 'description'], ['artwork', 'description'],
  ['short-story', 'synopsis'], ['literary-work', 'synopsis'],
].map(([kind, contentType], index) => {
  const realTitle = `ジャンル検証作品${index + 1}のお話`;
  const text = '作品の内容と表現には作者の工夫が込められている。制作の背景や特徴を資料で確かめながら、作品に込められた思いとその表現を紹介する。'.repeat(3);
  return {
    ...fixtureQuestions[0], id: `test-genre-${kind}`, realTitle, aliases: [], kind, contentType,
    synopsis: text.replaceAll(realTitle, '■■■'),
    sources: [{ ...fixtureQuestions[0].sources[0],
      label: `Wikipedia：${realTitle}`, url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(realTitle)}?oldid=100`,
    }],
    evidence: { ...fixtureQuestions[0].evidence,
      section: contentType === 'description' ? '作品紹介' : 'あらすじ',
      sourceTextSha256: createHash('sha256').update(text).digest('hex'),
      excerpts: text.match(/[^。]+。/gu),
    },
  };
});
const directNDLQuestion = {
  ...genreQuestions[0], id: 'test-ndl-manga',
  sources: [{ provider: 'ndl', role: 'bibliography', label: '国立国会図書館サーチ：漫画検証',
    url: 'https://ndlsearch.ndl.go.jp/books/R100000002-I000000000123', retrievedAt: '2026-10-01T00:00:00Z' }],
  evidence: { ...genreQuestions[0].evidence, sourceId: 'ndl-R100000002-I000000000123', section: '内容紹介' },
};
const allFixtureQuestions = [...fixtureQuestions, openResourceQuestion, ...genreQuestions, directNDLQuestion];
// These socket fixtures represent individually produced works. Their source
// preference metadata is private and independent of the test's story text.
for(const q of allFixtureQuestions) q.evidence.visibility = require('../server/src/questions/selection-policy').visibilityEvidence({
  title:q.realTitle,kind:q.kind,sourceUrl:q.sources[0].url,genres:['小規模出版'],
});
for (const q of allFixtureQuestions) q.evidence.distribution = require('../server/src/questions/distribution-policy').distributionEvidence({
  title:q.realTitle,kind:q.kind,sourceUrl:q.sources[0].url,publisher:'検証出版社',date:'2026-01-01',identifier:'9784065373262',developer:'検証開発会社',price:1000,
});
function writeBank(questions = fixtureQuestions) {
  writeFileSync(fixturePath, JSON.stringify({
    schemaVersion: 1, generatedAt: '2026-10-01T00:00:00.000Z', questions,
  }));
}
writeBank();
process.env.NODE_ENV = 'production';
process.env.ALLOW_THREE_PLAYER_DEV = 'true';
process.env.ALLOWED_ORIGINS = 'https://game.example';
process.env.QUESTION_BANK_PATH = fixturePath;
process.env.ROOM_STATE_PATH = join(fixtureDirectory, 'rooms.json');
// Keep these socket-level tests independent from remote discovery. Dedicated
// question-service tests exercise on-demand collection with controlled sources.
process.env.QUESTION_COLLECTION_ENABLED = 'false';
// File-store fixtures must not read a developer's private database configuration.
require('../server/node_modules/dotenv').config = () => ({ parsed: {} });
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const questionApi = require('../server/src/questions');
const originalQuestionSelection = questionApi.selectQuestionAsync;
let nextQuestionDeferral = null;
// Preserve the real selector and validator, but let selected socket tests hold
// one completion to reproduce a slow source collection deterministically.
questionApi.selectQuestionAsync = async (excludedIds, options) => {
  const deferral = nextQuestionDeferral;
  nextQuestionDeferral = null;
  let selected;
  let failure;
  try { selected = await originalQuestionSelection(excludedIds, options); }
  catch (error) { failure = error; }
  if (deferral) {
    deferral.markStarted();
    await deferral.gate;
  }
  if (failure) throw failure;
  return selected;
};
const { server, io } = require('../server/src/index');
const { rooms } = require('../server/src/gameState');
const { generateComputerTitles } = require('../server/src/computerTitles');
const originalFetch = global.fetch;
let externalFetches = 0;
let url;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}`;
  global.fetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input.url || String(input));
    if (target.origin !== url) {
      externalFetches++;
      throw new Error('Gameplay must use the prepared bank without external API calls');
    }
    return originalFetch(input, init);
  };
});
after(async () => {
  questionApi.selectQuestionAsync = originalQuestionSelection;
  global.fetch = originalFetch;
  await new Promise((resolve) => io.close(resolve));
  rmSync(fixtureDirectory, { recursive: true, force: true });
  assert.equal(externalFetches, 0, 'Gameplay attempted an external API call');
});

function delayNextQuestionSelection(t) {
  assert.equal(nextQuestionDeferral, null);
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  nextQuestionDeferral = { markStarted, gate };
  t.after(() => { nextQuestionDeferral = null; release(); });
  return { started, release };
}

function assertNoSources(payload) {
  const privateKeys = new Set([
    'sources', 'sourceQuestion', 'usedQuestionIds', 'questionId',
    'revisionId', 'evidence', 'generationMethod', 'sourceId', 'sourceTextSha256', 'fetchError',
    'workKind', 'workKindLabel', 'expectedAuthors', 'ndl',
  ]);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(privateKeys.has(key), false, `Private provenance leaked: ${key}`);
      visit(child);
    }
  }
  visit(payload);
  const serialized = JSON.stringify(payload);
  for (const question of allFixtureQuestions) {
    for (const source of question.sources) {
      assert.ok(!serialized.includes(source.url), 'Source URL leaked before reveal');
      if (source.textUrl) assert.ok(!serialized.includes(source.textUrl), 'Source text URL leaked before reveal');
    }
    assert.ok(!serialized.includes(question.evidence.sourceId), 'Source identifier leaked before reveal');
    assert.ok(!serialized.includes(question.evidence.sourceTextSha256), 'Source text hash leaked before reveal');
  }
}
function questionForSynopsis(synopsis) {
  const question = allFixtureQuestions.find((q) => q.synopsis === synopsis);
  assert.ok(question, 'CPU synopsis must come from the trusted question bank');
  return question;
}

async function bot(t, transport = 'websocket') {
  const socket = connect(url, {
    transports: [transport], extraHeaders: { Origin: 'https://game.example' },
    reconnection: false,
  });
  const events = [];
  const client = { socket, events };
  socket.onAny((name, data) => {
    if (data?.round?.id) socket.currentRoundId = data.round.id;
    events.push({ name, data });
  });
  t.after(() => {
    socket.disconnect();
    for (const entry of events) {
      if (client.allowGenre && ['round:synopsis_loading', 'round:synopsis_fetched', 'round:synopsis_presented'].includes(entry.name)) {
        const { workKind, workKindLabel, ...safe } = entry.data;
        assertNoSources(safe);
      } else if (entry.name !== 'round:revealed') assertNoSources(entry.data);
    }
  });
  await once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
  return client;
}
async function ack(b, event, payload = null) {
  await new Promise(resolve => setTimeout(resolve, 10));
  if (event.startsWith('round:') || event === 'game:next_round') {
    payload = { roundId: b.socket.currentRoundId, ...payload };
  }
  return new Promise((resolve, reject) => b.socket.timeout(3000).emit(event, payload,
    (error, response) => {
      if (error) return reject(error);
      if (response?.gameData?.round?.id) b.socket.currentRoundId = response.gameData.round.id;
      try {
        const { questionId, ...publicResponse } = response || {};
        if (event === 'round:prepare_question' && response?.ok) assertNoSources(publicResponse);
        else if (event === 'round:get_synopsis' && b.allowGenre) { const {workKind,workKindLabel,...safe}=response;assertNoSources(safe); }
        else if (event === 'room:resume' && b.allowGenre && response?.gameData) {
          const { workKind, workKindLabel, ...round } = response.gameData.round;
          const { workKind: selectedGenre, ...resumeState } = response.gameData.resumeState;
          assertNoSources({ ...response, gameData: { ...response.gameData, round, resumeState } });
        }
        else assertNoSources(response);
        resolve(response);
      } catch (failure) {
        reject(failure);
      }
    }));
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
async function event(b, name, allowGenre = false) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const index = b.events.findIndex((e) => e.name === name);
    if (index !== -1) {
      const data = b.events.splice(index, 1)[0].data;
      if (name !== 'round:revealed') {
        const {workKind,workKindLabel,...safe}=data;
        assertNoSources(allowGenre ? safe : data);
      }
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Missing event: ${name}`);
}
async function confirmCpuAndStart(controller, bots) {
  await ok(controller, 'round:confirm_synopsis');
  await Promise.all(bots.filter((b) => b.socket.connected).map((b) => ok(b, 'round:declare_unknown')));
  await ok(controller, 'round:start_submitting');
}
async function roomWith(t, count) {
  const bots = [];
  for (let i = 0; i < count; i++) bots.push(await bot(t, i % 2 ? 'polling' : 'websocket'));
  const created = await ok(bots[0], 'room:create', { nickname: '参加者0' });
  assertNoSources(created);
  bots[0].player = created.player;
  assert.match(created.room.code, /^\d{6}$/);
  for (let i = 1; i < count; i++) {
    const joined = await ok(bots[i], 'room:join', { code: created.room.code, nickname: `参加者${i}` });
    assertNoSources(joined);
    bots[i].player = joined.player;
    assert.equal(joined.allPlayers.length, i + 1);
  }
  return { bots, room: created.room, entry: created };
}

test('human questioner never declares known/unknown and answerers alone unlock submission', async t => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find(b => b.player.id === started.round.questioner_id);
  const answerers = bots.filter(b => b !== questioner);
  await ok(questioner, 'round:submit_synopsis', { synopsis: '港町で手紙を探す物語。', realTitle: '秘密の正解' });
  await denied(questioner, 'round:declare_known');
  await denied(questioner, 'round:declare_unknown');
  await denied(questioner, 'round:start_submitting');
  for (const answerer of answerers) await ok(answerer, 'round:declare_unknown');
  await event(questioner, 'round:all_declared');
  const round = rooms.get(room.code).rounds.at(-1);
  assert.equal(round.declarations.has(questioner.player.id), false);
  assert.equal(round.declarations.size, answerers.length);
  await ok(questioner, 'round:start_submitting');
  assert.equal(round.status, 'submitting');
});

test('title inputs accept 200 characters and reject 201 without changing the round', async t => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find(b => b.player.id === started.round.questioner_id);
  const answerers = bots.filter(b => b !== questioner);
  const round = rooms.get(room.code).rounds.at(-1);
  const realTitle = '本'.repeat(200), fakeTitle = '案'.repeat(200);
  const rejected = await ack(questioner, 'round:submit_synopsis', { synopsis: '港町で手紙を探す物語。', realTitle: realTitle + '字' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /200文字以内/);
  assert.equal(round.real_title, null);
  await ok(questioner, 'round:submit_synopsis', { synopsis: '港町で手紙を探す物語。', realTitle: ` ${realTitle} ` });
  assert.equal(round.real_title, realTitle);
  for (const answerer of answerers) await ok(answerer, 'round:declare_unknown');
  await ok(questioner, 'round:start_submitting');
  const before = round.answers.length;
  for (const invalid of [fakeTitle + '字', '', 200]) {
    const result = await ack(answerers[0], 'round:submit_fake', { title: invalid });
    assert.equal(result.ok, false);
    assert.equal(round.answers.length, before);
    if (typeof invalid === 'string' && invalid.length > 200) assert.match(result.error, /200文字以内/);
  }
  await ok(answerers[0], 'round:submit_fake', { title: ` ${fakeTitle} ` });
  for (const [i, answerer] of answerers.slice(1).entries()) await ok(answerer, 'round:submit_fake', { title: `案${i}` });
  const { choices } = await event(questioner, 'round:choices_presented');
  assert(choices.some(choice => choice.title === fakeTitle));
  const real = choices.find(choice => choice.title === realTitle);
  assert(real);
  for (const answerer of answerers) await ok(answerer, 'round:submit_vote', { answerId: real.id });
  const revealed = await event(questioner, 'round:revealed');
  assert.equal(revealed.realTitle, realTitle);
  assert(revealed.answers.some(answer => answer.title === fakeTitle));
});

test('health, CORS and both Socket.IO transports without database configuration', async (t) => {
  const res = await fetch(`${url}/health`, { headers: { Origin: 'https://game.example' } });
  const health = await res.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.questionCollection.enabled, false);
  assert.equal(health.questionCollection.running, false);
  assert.equal(health.questionCollection.scheduled, false);
  assert.equal(health.questionCollection.lastSuccessfulAt, null);
  assertNoSources(health);
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

test('solo needs a second seat, concurrent joins stop at 6, duplicate names rejected', async (t) => {
  const { bots, room } = await roomWith(t, 3);
  const newcomers = await Promise.all(Array.from({ length: 5 }, () => bot(t)));
  const results = await Promise.all(newcomers.map((b, i) => ack(b, 'room:join', { code: room.code, nickname: `追加${i}` })));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal((await ok(bots[0], 'room:get_state')).room.players.length, 6);
  const other = await bot(t);
  await denied(other, 'room:join', { code: 'XXXXXX', nickname: 'なし' });
  const small = await roomWith(t, 1);
  await denied(small.bots[0], 'game:start', { mode: 'cpu' });
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
      assertNoSources(data);
      assert.equal(data.totalRounds, mode === 'player' ? count : 2);
      assert.equal(data.round.real_title, null);
      if (mode === 'player') assert.equal(new Set(data.playerOrder.map((p) => p.turnOrder)).size, count);
      const expected = new Map(bots.map((b) => [b.player.id, 0]));
      const usedQuestionIds = new Set();
      let previousAnswerId;
      for (let r = 1; r <= data.totalRounds; r++) {
        const questioner = bots.find((b) => b.player.id === data.questioner?.id);
        const answerers = bots.filter((b) => b !== questioner);
        let realTitle;
        let selectedQuestion;
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
          const fetched = await event(host, 'round:synopsis_fetched');
          assertNoSources(fetched);
          selectedQuestion = questionForSynopsis(fetched.synopsis);
          assert.equal(usedQuestionIds.has(selectedQuestion.id), false, 'CPU repeated a work within one room');
          usedQuestionIds.add(selectedQuestion.id);
          await denied(bots[1], 'round:confirm_synopsis');
          await confirmCpuAndStart(host, bots);
          realTitle = selectedQuestion.realTitle;
          for (const b of bots) {
            const presented = await event(b, 'round:synopsis_presented');
            assertNoSources(presented);
            assert.ok(!presented.synopsis.includes('■■■'));
            assert.ok(!presented.synopsis.includes(realTitle));
          }
        }
        const state = await ok(answerers[0], 'room:get_state');
        assertNoSources(state);
        assert.ok(!JSON.stringify(state).includes(realTitle));
        assert.equal(state.room.rounds, undefined);
        await denied(host, 'game:next_round');
        const firstFake = await ack(answerers[0], 'round:submit_fake', { title: '仮の案' });
        const replacedFake = await ack(answerers[0], 'round:submit_fake', { title: '偽物0' });
        assert.equal(firstFake.ok, true);
        assert.equal(replacedFake.ok, true);
        assert.equal((await event(answerers[0], 'round:fake_saved')).title, '仮の案');
        await Promise.all(answerers.slice(1).map((b, i) => ok(b, 'round:submit_fake', { title: `偽物${i + 1}` })));
        for (const b of answerers) assert.equal((await event(b, 'round:fake_saved')).roundId, data.round.id);
        const presentedChoices = await Promise.all(bots.map((b) => event(b, 'round:choices_presented')));
        const { choices } = presentedChoices[0];
        assert.equal(choices.length, answerers.length + 1);
        assert.ok(choices.every((c) => Object.keys(c).sort().join() === 'displayOrder,id,title'));
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i];
          assertNoSources(presentedChoices[i]);
          assert.deepEqual(presentedChoices[i].choices, choices);
          const ownChoice = b === questioner ? null : choices.find((c) => c.title === `偽物${answerers.indexOf(b)}`);
          if (b !== questioner) assert.ok(ownChoice);
          assert.equal(presentedChoices[i].ownAnswerId, ownChoice?.id ?? null);
          assert.equal(b.events.filter((e) => e.name === 'round:choices_presented').length, 0);
        }
        const real = choices.find((c) => c.title === realTitle);
        const lure = choices.find((c) => c.title === '偽物0');
        assert.ok(real);
        await denied(answerers[0], 'round:submit_vote', { answerId: lure.id });
        await denied(answerers[0], 'round:submit_vote', { answerId: previousAnswerId || 'invalid' });
        const votes = await Promise.all([ack(answerers[0], 'round:submit_vote', { answerId: real.id }), ack(answerers[0], 'round:submit_vote', { answerId: real.id })]);
        assert.equal(votes.filter((v) => v.ok).length, 1);
        await Promise.all(answerers.slice(1).map((b) => ok(b, 'round:submit_vote', { answerId: lure.id })));
        for (const b of answerers) assert.equal((await event(b, 'round:vote_saved')).roundId, data.round.id);
        const revealed = await event(host, 'round:revealed');
        assert.equal(revealed.realTitle, realTitle);
        if (mode === 'cpu') assert.deepEqual(revealed.sources, selectedQuestion.sources);
        else assert.ok(!revealed.sources || revealed.sources.length === 0);
        assert.equal(revealed.votes.length, answerers.length);
        const scorer = answerers[0].player.id;
        expected.set(scorer, expected.get(scorer) + answerers.length);
        const points = revealed.roundScores.find((p) => p.player_id === scorer);
        assert.deepEqual(points, { player_id: scorer, correct_pts: 1, deceive_pts: answerers.length - 1, total_pts: answerers.length });
        for (const p of revealed.playerScores) assert.equal(p.score, expected.get(p.id));
        if (questioner) {
          await denied(host, 'game:next_round');
          await denied(questioner, 'game:next_round');
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
        if (r < data.totalRounds) {
          data = await event(host, 'game:round_started');
          assertNoSources(data);
        }
      }
      const finished = await event(host, 'game:finished');
      for (const p of finished.finalScores) assert.equal(p.score, expected.get(p.id));
      assert.equal(finished.winner.score, Math.max(...expected.values()));
      await denied(host, 'game:next_round');
    });
  }
}

test('CPU recognition declarations block submissions and only the host discards a known work', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  const host = bots[0];
  await ok(host, 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(host, 'round:synopsis_fetched');
  const original = rooms.get(room.code).rounds[0].real_title;
  await denied(host, 'round:declare_unknown');
  await denied(host, 'round:start_submitting');
  await denied(bots[1], 'round:reselect');
  await ok(host, 'round:confirm_synopsis');
  await denied(host, 'round:confirm_synopsis');
  await denied(host, 'round:reroll_synopsis');
  await denied(host, 'round:use_manual');
  await denied(host, 'round:start_submitting');
  await denied(bots[1], 'round:submit_fake', { title: '早すぎる回答' });
  await ok(bots[1], 'round:declare_known');
  for (const b of [host, bots[2], bots[3]]) await ok(b, 'round:declare_unknown');
  await denied(host, 'round:start_submitting');
  await denied(bots[1], 'round:reselect');
  await ok(host, 'round:reselect');
  for (const b of bots) assert.equal((await event(b, 'round:question_discarded')).realTitle, original);
  const replacement = await event(host, 'round:synopsis_fetched');
  assert.notEqual(questionForSynopsis(replacement.synopsis).realTitle, original);
  assertNoSources(await ok(bots[1], 'room:get_state'));
  await ok(host, 'round:confirm_synopsis');
  await denied(host, 'round:start_submitting');
  for (const b of bots) await ok(b, 'round:declare_unknown');
  await denied(bots[1], 'round:start_submitting');
  await ok(host, 'round:start_submitting');
  await denied(host, 'round:reselect');
  await denied(host, 'round:declare_known');
});

test('player reselection reveals only the discarded answer and resets declarations', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const data = await event(bots[0], 'game:started');
  const q = bots.find((b) => b.player.id === data.questioner.id);
  const others = bots.filter((b) => b !== q);
  await ok(q, 'round:submit_synopsis', { synopsis: '取り下げる作品の紹介です。', realTitle: '取り下げる正解' });
  await ok(others[0], 'round:declare_known');
  await denied(others[0], 'round:reselect');
  await ok(q, 'round:reselect');
  for (const b of bots) assert.deepEqual(await event(b, 'round:question_discarded'), {
    roundId: data.round.id, realTitle: '取り下げる正解',
  });
  await ok(q, 'round:submit_synopsis', { synopsis: '選び直した作品の紹介です。', realTitle: 'まだ隠す正解' });
  await denied(q, 'round:start_submitting');
  assert.equal(rooms.get(room.code).rounds[0].declarations.size, 0);
  assert.ok(!JSON.stringify(await ok(others[0], 'room:get_state')).includes('まだ隠す正解'));
  for (const b of others) await ok(b, 'round:declare_unknown');
  await ok(q, 'round:start_submitting');
});

test('CPU exhaustion switches one round to manual while keeping scores, remaining CPU rounds and privacy', async (t) => {
  t.after(() => writeBank());
  writeBank([]);
  const { bots, room } = await roomWith(t, 4);
  const host = bots[0];
  await ok(host, 'game:start', { mode: 'cpu', totalRounds: 2 });
  await event(host, 'round:synopsis_fetch_failed');
  rooms.get(room.code).players[0].score = 7;
  await denied(bots[1], 'round:use_manual');
  await ok(host, 'round:use_manual');
  const manual = await event(host, 'game:round_started');
  assert.equal(manual.mode, 'player');
  assert.equal(manual.currentRound, 1);
  assert.equal(manual.totalRounds, 2);
  assert.equal(manual.questioner.id, host.player.id);
  assert.equal(manual.round.manualCpu, undefined);
  assert.equal(rooms.get(room.code).players[0].score, 7);
  await denied(host, 'round:use_manual');
  await denied(host, 'round:confirm_synopsis');
  await ok(host, 'round:submit_synopsis', { synopsis: '手動で用意した紹介文です。', realTitle: '手動の正解' });
  assert.ok(!JSON.stringify(await ok(bots[1], 'room:get_state')).includes('手動の正解'));
  for (const b of bots.slice(1)) await ok(b, 'round:declare_unknown');
  await ok(host, 'round:start_submitting');
  for (const [i,b] of bots.slice(1).entries()) await ok(b, 'round:submit_fake', { title: `手動の案${i}` });
  const { choices } = await event(host, 'round:choices_presented');
  const real = choices.find((c) => c.title === '手動の正解');
  for (const b of bots.slice(1)) await ok(b, 'round:submit_vote', { answerId: real.id });
  const revealed = await event(host, 'round:revealed');
  assert.equal(revealed.playerScores.find((p) => p.id === host.player.id).score, 7);
  assert.deepEqual(revealed.sources, []);
  await denied(host, 'game:next_round');
  await ok(host, 'round:submit_mvp', { answerId: choices.find((c) => c.id !== real.id).id });
  writeBank();
  await ok(host, 'game:next_round');
  const next = await event(host, 'game:round_started');
  assert.equal(next.currentRound, 2);
  assert.equal(next.totalRounds, 2);
  assert.equal(next.mode, 'cpu');
  assert.equal(next.questioner, null);
  await event(host, 'round:synopsis_fetched');
  await confirmCpuAndStart(host, bots);
});

test('a late CPU source completion cannot replace a manual fallback or reserve its work', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  const delayed = delayNextQuestionSelection(t);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await delayed.started;
  await ok(bots[0], 'round:use_manual');
  await ok(bots[0], 'round:submit_synopsis', { synopsis: '手動入力を優先する紹介文。', realTitle: '手入力の正解' });
  delayed.release();
  await new Promise((r) => setImmediate(r));
  const current = rooms.get(room.code);
  assert.equal(current.rounds[0].real_title, '手入力の正解');
  assert.deepEqual(current.usedQuestionIds, []);
  assert.equal(bots[0].events.some((e) => e.name === 'round:synopsis_fetched'), false);
  for (const b of bots.slice(1)) await ok(b, 'round:declare_unknown');
  await ok(bots[0], 'round:start_submitting');
});

test('own choice IDs distinguish identical titles and self-votes remain rejected', async (t) => {
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(bots[0], 'round:synopsis_fetched');
  await confirmCpuAndStart(bots[0], bots);
  const titles = ['同じタイトル', '同じタイトル', '別のタイトル2', '別のタイトル3'];
  await Promise.all(bots.map((b, i) => ok(b, 'round:submit_fake', { title: titles[i] })));
  const presented = await Promise.all(bots.map((b) => event(b, 'round:choices_presented')));
  const choices = presented[0].choices;
  assert.equal(choices.length, 5);
  assert.ok(choices.every((c) => Object.keys(c).sort().join() === 'displayOrder,id,title'));
  assert.equal(new Set(presented.map((p) => p.ownAnswerId)).size, bots.length);
  for (let i = 0; i < bots.length; i++) {
    assert.deepEqual(presented[i].choices, choices);
    assert.equal(choices.find((c) => c.id === presented[i].ownAnswerId)?.title, titles[i]);
    await denied(bots[i], 'round:submit_vote', { answerId: presented[i].ownAnswerId });
  }
  // A matching title written by another player is still an eligible choice.
  await ok(bots[0], 'round:submit_vote', { answerId: presented[1].ownAnswerId });
  const real = choices.find((c) => c.title.startsWith('正解'));
  assert.ok(real);
  await Promise.all(bots.slice(1).map((b) => ok(b, 'round:submit_vote', { answerId: real.id })));
  const revealed = await event(bots[0], 'round:revealed');
  assert.equal(revealed.votes.length, bots.length);
  assert.equal(revealed.roundScores.find((p) => p.player_id === bots[1].player.id).deceive_pts, 1);
});

for (const question of [...genreQuestions, directNDLQuestion]) {
  test(`CPU ${question.id} preserves its description and reveals its kind and sources only after voting`, async (t) => {
    t.after(() => writeBank());
    writeBank([question]);
    const { bots, room } = await roomWith(t, 4);
    await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
    const started = await event(bots[0], 'game:started');
    const fetched = await event(bots[0], 'round:synopsis_fetched');
    assertNoSources(started);
    assertNoSources(fetched);
    assert.equal(fetched.contentType, question.contentType);
    assert.equal(fetched.synopsis, question.synopsis);
    assert.ok(!fetched.synopsis.includes(question.realTitle));
    const request = { roomId: room.id, roundId: started.round.id };
    assert.equal((await ok(bots[0], 'round:get_synopsis', request)).contentType, question.contentType);
    await confirmCpuAndStart(bots[0], bots);
    for (const b of bots) {
      const presented = await event(b, 'round:synopsis_presented');
      assertNoSources(presented);
      assert.equal(presented.contentType, question.contentType);
    }
    await Promise.all(bots.map((b, i) => ok(b, 'round:submit_fake', { title: `ジャンル候補${i}` })));
    const { choices } = await event(bots[0], 'round:choices_presented');
    const real = choices.find((choice) => choice.title === question.realTitle);
    assert.ok(real);
    await Promise.all(bots.map((b) => ok(b, 'round:submit_vote', { answerId: real.id })));
    const revealed = await event(bots[0], 'round:revealed');
    const genre = require('../server/src/questions/kinds').getGameGenre(question.kind);
    assert.equal(revealed.workKind, genre.id);
    assert.equal(revealed.workKindLabel, genre.label);
    assert.equal(revealed.contentType, question.contentType);
    assert.deepEqual(revealed.sources, question.sources);
    assert.equal(revealed.evidence, undefined);
  });
}

test('an open-resource CPU question reveals Aozora and NDL references only after every vote', async (t) => {
  t.after(() => writeBank());
  writeBank([openResourceQuestion]);
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  assertNoSources(started);
  const fetched = await event(bots[0], 'round:synopsis_fetched');
  assert.equal(fetched.synopsis, openResourceQuestion.synopsis);
  assert.ok(!fetched.synopsis.includes(openResourceQuestion.realTitle));
  await confirmCpuAndStart(bots[0], bots);
  for (const b of bots) {
    const presented = await event(b, 'round:synopsis_presented');
    assertNoSources(presented);
    assert.equal(presented.synopsis, openResourceQuestion.synopsis);
  }
  await Promise.all(bots.map((b, i) => ok(b, 'round:submit_fake', { title: `資料候補${i}` })));
  const choices = (await event(bots[0], 'round:choices_presented')).choices;
  const real = choices.find((choice) => choice.title === openResourceQuestion.realTitle);
  assert.ok(real);
  for (const b of bots.slice(0, 3)) await ok(b, 'round:submit_vote', { answerId: real.id });
  assert.equal(bots[0].events.some((entry) => entry.name === 'round:revealed'), false);
  assertNoSources(await ok(bots[0], 'room:get_state'));
  await ok(bots[3], 'round:submit_vote', { answerId: real.id });
  for (const b of bots) {
    const revealed = await event(b, 'round:revealed');
    assert.equal(revealed.realTitle, openResourceQuestion.realTitle);
    assert.deepEqual(revealed.sources, openResourceQuestion.sources);
    assert.equal(revealed.evidence, undefined);
    assert.equal(revealed.sourceQuestion, undefined);
  }
});

test('an empty CPU bank remains retryable after restoring the trusted file', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  t.after(() => writeBank());
  writeBank([]);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  const failure = await event(bots[0], 'round:synopsis_fetch_failed');
  assert.deepEqual(await ack(bots[0], 'round:get_synopsis', {
    roomId: room.id, roundId: started.round.id,
  }), { ok: false, error: failure.error });
  await denied(bots[0], 'round:confirm_synopsis');
  writeBank();
  await ok(bots[0], 'round:reroll_synopsis');
  questionForSynopsis((await event(bots[0], 'round:synopsis_fetched')).synopsis);
  await confirmCpuAndStart(bots[0], bots);
});

test('CPU rerolls exhaust the bank without reusing a work and recover when more works are supplied', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  t.after(() => writeBank());
  writeBank(fixtureQuestions.slice(0, 2));
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  const first = questionForSynopsis((await event(bots[0], 'round:synopsis_fetched')).synopsis);
  await denied(bots[1], 'round:reroll_synopsis');
  await ok(bots[0], 'round:reroll_synopsis');
  const second = questionForSynopsis((await event(bots[0], 'round:synopsis_fetched')).synopsis);
  assert.notEqual(second.id, first.id);
  await ok(bots[0], 'round:reroll_synopsis');
  const failure = await event(bots[0], 'round:synopsis_fetch_failed');
  assert.deepEqual(await ack(bots[0], 'round:get_synopsis', {
    roomId: room.id, roundId: started.round.id,
  }), { ok: false, error: failure.error });
  await denied(bots[0], 'round:confirm_synopsis');
  writeBank();
  await ok(bots[0], 'round:reroll_synopsis');
  const replacement = questionForSynopsis((await event(bots[0], 'round:synopsis_fetched')).synopsis);
  assert.ok(![first.id, second.id].includes(replacement.id));
  await confirmCpuAndStart(bots[0], bots);
});

test('invalid CPU bank data fails closed instead of issuing an unsupported work', async (t) => {
  const { bots } = await roomWith(t, 4);
  t.after(() => writeBank());
  writeFileSync(fixturePath, '{ invalid JSON');
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(bots[0], 'round:synopsis_fetch_failed');
  await denied(bots[0], 'round:confirm_synopsis');
  writeBank([{ ...fixtureQuestions[0], kind: 'island' }]);
  await ok(bots[0], 'round:reroll_synopsis');
  await event(bots[0], 'round:synopsis_fetch_failed');
  await denied(bots[0], 'round:confirm_synopsis');
  const malformedProvenance = [
    {
      ...fixtureQuestions[0],
      sources: [{ ...fixtureQuestions[0].sources[0], url: fixtureQuestions[0].sources[0].url.replace('oldid=100', 'oldid=999') }],
    },
    {
      ...fixtureQuestions[0],
      evidence: { ...fixtureQuestions[0].evidence, sourceId: 'wikipedia-ja-1000-999' },
    },
    {
      ...fixtureQuestions[0],
      sources: [{ ...fixtureQuestions[0].sources[0], license: undefined }],
    },
    {
      ...fixtureQuestions[0],
      synopsis: `${fixtureQuestions[0].synopsis}出典にはない文章。`,
    },
  ];
  for (const question of malformedProvenance) {
    writeBank([question]);
    await ok(bots[0], 'round:reroll_synopsis');
    await event(bots[0], 'round:synopsis_fetch_failed');
    await denied(bots[0], 'round:confirm_synopsis');
  }
  writeBank();
  await ok(bots[0], 'round:reroll_synopsis');
  await event(bots[0], 'round:synopsis_fetched');
  await confirmCpuAndStart(bots[0], bots);
});

test('CPU host can recover the current masked synopsis snapshot only while confirming that round', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  await denied(bots[0], 'round:get_synopsis', { roomId: room.id, roundId: 'not-started' });
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  const initial = await event(bots[0], 'round:synopsis_fetched');
  const request = { roomId: room.id, roundId: started.round.id };
  const snapshot = await ok(bots[0], 'round:get_synopsis', request);
  assert.deepEqual(snapshot, { ok: true, roundId: request.roundId, synopsis: initial.synopsis, contentType: 'synopsis' });
  assert.ok(!JSON.stringify(snapshot).includes(questionForSynopsis(initial.synopsis).realTitle));
  await denied(bots[1], 'round:get_synopsis', request);
  const outsider = await bot(t);
  await denied(outsider, 'round:get_synopsis', request);
  await denied(bots[0], 'round:get_synopsis', { ...request, roomId: 'another-room' });
  await denied(bots[0], 'round:get_synopsis', { ...request, roundId: 'another-round' });
  await denied(bots[0], 'round:get_synopsis', null);
  await ok(bots[0], 'round:reroll_synopsis');
  const replacement = await event(bots[0], 'round:synopsis_fetched');
  assert.notEqual(replacement.synopsis, initial.synopsis);
  assert.deepEqual(await ok(bots[0], 'round:get_synopsis', request), {
    ok: true, roundId: request.roundId, synopsis: replacement.synopsis, contentType: 'synopsis',
  });
  await confirmCpuAndStart(bots[0], bots);
  await denied(bots[0], 'round:get_synopsis', request);
});

test('player mode does not expose a CPU synopsis snapshot to host or questioner', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  const request = { roomId: room.id, roundId: started.round.id };
  await denied(bots[0], 'round:get_synopsis', request);
  const questioner = bots.find((b) => b.player.id === started.questioner.id);
  await ok(questioner, 'round:submit_synopsis', { realTitle: '作品', synopsis: '手動のあらすじ。' });
  await denied(questioner, 'round:get_synopsis', request);
});

test('player introduction length is enforced before publication and the questioner can correct it', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find((b) => b.player.id === started.questioner.id);
  const rejected = await ack(questioner, 'round:submit_synopsis', { realTitle: '作品', synopsis: '文'.repeat(281) });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /280文字以内/u);
  assert.equal(rooms.get(room.code).rounds.at(-1).synopsis, null);
  const synopsis = '文'.repeat(279)+'。';
  await ok(questioner, 'round:submit_synopsis', { realTitle: '作品', synopsis });
  const shown = await event(bots.find((b)=>b!==questioner), 'round:synopsis_presented');
  assert.equal(shown.synopsis,synopsis);
});

for (const variant of ['exact', 'modified title', 'modified synopsis', 'unknown ID', 'reselected manual entry']) {
  test(`player helper source attribution: ${variant}`, async (t) => {
    const { bots } = await roomWith(t, 4);
    await ok(bots[0], 'game:start', { mode: 'player' });
    const started = await event(bots[0], 'game:started');
    const questioner = bots.find((b) => b.player.id === started.questioner.id);
    const answerers = bots.filter((b) => b !== questioner);
    const work = await ok(questioner, 'round:prepare_question', { roomId:started.round.room_id, roundId:started.round.id });
    assert.deepEqual(Object.keys(work).sort(), ['contentType', 'kind', 'ok', 'questionId', 'roundId', 'synopsis', 'title']);
    assert.equal(work.ok, true);
    const question = fixtureQuestions.find((q) => q.id === work.questionId);
    assert.ok(question);
    assert.equal(work.title, question.realTitle);
    assert.equal(work.synopsis, question.synopsis);
    const payload = { synopsis: work.synopsis, realTitle: work.title, questionId: work.questionId };
    if (variant === 'modified title') payload.realTitle += 'という変更';
    if (variant === 'modified synopsis') payload.synopsis += '出題者が加えた文章。';
    if (variant === 'unknown ID') payload.questionId = 'nonexistent-question';
    await ok(questioner, 'round:submit_synopsis', payload);
    if (variant === 'reselected manual entry') {
      await ok(questioner, 'round:reselect');
      payload.realTitle = '手動の作品名';
      payload.synopsis = '出題者が自分で記述したあらすじ。';
      delete payload.questionId;
      await ok(questioner, 'round:submit_synopsis', payload);
    }
    await Promise.all(answerers.map((b) => ok(b, 'round:declare_unknown')));
    await ok(questioner, 'round:start_submitting');
    await Promise.all(answerers.map((b, i) => ok(b, 'round:submit_fake', { title: `候補${i}` })));
    const { choices } = await event(bots[0], 'round:choices_presented');
    const real = choices.find((c) => c.title === payload.realTitle);
    assert.ok(real);
    await Promise.all(answerers.map((b) => ok(b, 'round:submit_vote', { answerId: real.id })));
    const revealed = await event(bots[0], 'round:revealed');
    assert.equal(revealed.realTitle, payload.realTitle);
    if (variant === 'exact') assert.deepEqual(revealed.sources, question.sources);
    else assert.ok(!revealed.sources || revealed.sources.length === 0, 'Unverified player text inherited source attribution');
    assert.equal(revealed.sourceQuestion, undefined);
    assert.equal(revealed.evidence, undefined);
    assertNoSources(await ok(bots[0], 'room:get_state'));
  });
}

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
  await confirmCpuAndStart(bots[0], bots);
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
  await confirmCpuAndStart(bots[1], bots);
});

test('a source completion reaches the new CPU host when the previous host leaves during collection', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  const delayed = delayNextQuestionSelection(t);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  await delayed.started;
  const snapshotRequest = { roomId: room.id, roundId: started.round.id };
  assert.deepEqual(await ok(bots[0], 'round:get_synopsis', snapshotRequest), {
    ok: true, roundId: started.round.id, synopsis: null, loading: true,
  });
  await denied(bots[0], 'round:confirm_synopsis');
  bots[0].socket.disconnect();
  await event(bots[1], 'room:player_disconnected');
  assert.deepEqual(await ok(bots[1], 'round:get_synopsis', snapshotRequest), {
    ok: true, roundId: started.round.id, synopsis: null, loading: true,
  });
  delayed.release();
  const fetched = await event(bots[1], 'round:synopsis_fetched');
  questionForSynopsis(fetched.synopsis);
  assert.deepEqual(await ok(bots[1], 'round:get_synopsis', snapshotRequest), {
    ok: true, roundId: started.round.id, synopsis: fetched.synopsis, contentType: 'synopsis',
  });
  await confirmCpuAndStart(bots[1], bots);
});

test('a delayed collection failure reaches the new CPU host and remains retryable', async (t) => {
  t.after(() => writeBank());
  writeBank([]);
  const { bots, room } = await roomWith(t, 4);
  const delayed = delayNextQuestionSelection(t);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  await delayed.started;
  bots[0].socket.disconnect();
  await event(bots[1], 'room:player_disconnected');
  delayed.release();
  const failure = await event(bots[1], 'round:synopsis_fetch_failed');
  assert.deepEqual(await ack(bots[1], 'round:get_synopsis', {
    roomId: room.id, roundId: started.round.id,
  }), { ok: false, error: failure.error });
  await denied(bots[1], 'round:confirm_synopsis');
  writeBank();
  await ok(bots[1], 'round:reroll_synopsis');
  questionForSynopsis((await event(bots[1], 'round:synopsis_fetched')).synopsis);
  await confirmCpuAndStart(bots[1], bots);
});

test('a late source completion cannot replace a newer CPU reroll or consume its old work', async (t) => {
  t.after(() => writeBank());
  writeBank([fixtureQuestions[0]]);
  const { bots, room } = await roomWith(t, 4);
  const delayed = delayNextQuestionSelection(t);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  const started = await event(bots[0], 'game:started');
  await delayed.started;
  writeBank([fixtureQuestions[1]]);
  await ok(bots[0], 'round:reroll_synopsis');
  const current = await event(bots[0], 'round:synopsis_fetched');
  assert.equal(current.synopsis, fixtureQuestions[1].synopsis);
  delayed.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bots[0].events.filter((entry) => entry.name === 'round:synopsis_fetched').length, 0);
  assert.deepEqual(await ok(bots[0], 'round:get_synopsis', {
    roomId: room.id, roundId: started.round.id,
  }), { ok: true, roundId: started.round.id, synopsis: current.synopsis, contentType: 'synopsis' });
  assert.deepEqual(rooms.get(room.code).usedQuestionIds, [fixtureQuestions[1].id]);
  await confirmCpuAndStart(bots[0], bots);
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

test('questioner departure after presenting a synopsis is visible in the member snapshot and remains skippable', async (t) => {
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find((b) => b.player.id === started.questioner.id);
  const remaining = bots.filter((b) => b !== questioner);
  await ok(questioner, 'round:submit_synopsis', {
    synopsis: '街の青年が忘れられた手紙を探す物語。', realTitle: '手紙の物語',
  });
  questioner.socket.disconnect();
  const departure = await event(remaining[0], 'game:questioner_disconnected');
  assert.equal(departure.roundStatus, 'selecting');
  const host = remaining.find((b) => b.player.id === departure.fallbackHostId);
  const snapshot = await ok(host, 'room:get_state');
  assert.equal(snapshot.room.players.find((p) => p.id === questioner.player.id).is_connected, false);
  assert.equal(snapshot.room.players.find((p) => p.id === host.player.id).is_host, true);
  await ok(host, 'game:next_round');
  assert.equal((await event(host, 'game:round_started')).currentRound, 2);
});

for (const phase of ['selecting', 'submitting', 'voting']) {
  test(`the final member can safely exit after all answerers leave during ${phase}, preserving earned points`, async (t) => {
    const { bots, room } = await roomWith(t, 4);
    await ok(bots[0], 'game:start', { mode: 'player' });
    const first = await event(bots[0], 'game:started');
    const firstQuestioner = bots.find((b) => b.player.id === first.questioner.id);
    const firstAnswerers = bots.filter((b) => b !== firstQuestioner);
    await ok(firstQuestioner, 'round:submit_synopsis', { synopsis: '最初の紹介文。', realTitle: '最初の本物' });
    for (const b of firstAnswerers) await ok(b, 'round:declare_unknown');
    await ok(firstQuestioner, 'round:start_submitting');
    for (let i = 0; i < firstAnswerers.length; i++) await ok(firstAnswerers[i], 'round:submit_fake', { title: `最初のウソ${i}` });
    const choices = (await event(bots[0], 'round:choices_presented')).choices;
    const real = choices.find((choice) => choice.title === '最初の本物');
    for (const b of firstAnswerers) await ok(b, 'round:submit_vote', { answerId: real.id });
    await event(bots[0], 'round:revealed');
    await ok(firstQuestioner, 'round:submit_mvp', { answerId: choices.find((c) => c.id !== real.id).id });
    await ok(bots[0], 'game:next_round');
    const second = await event(bots[0], 'game:round_started');
    const questioner = bots.find((b) => b.player.id === second.questioner.id);
    const answerers = bots.filter((b) => b !== questioner);
    const earned = new Map(rooms.get(room.code).players.map((p) => [p.id, p.score]));
    assert.ok([...earned.values()].some((score) => score > 0));
    if (phase !== 'selecting') {
      await ok(questioner, 'round:submit_synopsis', { synopsis: '二回目の紹介文。', realTitle: '二回目の本物' });
      for (const b of answerers) await ok(b, 'round:declare_unknown');
      await ok(questioner, 'round:start_submitting');
    }
    if (phase === 'voting') {
      for (let i = 0; i < answerers.length; i++) await ok(answerers[i], 'round:submit_fake', { title: `二回目のウソ${i}` });
      // The questioner's copy of the first round's choices may still be queued.
      assert.equal(rooms.get(room.code).rounds.at(-1).status, 'voting');
    }
    for (const b of answerers) {
      b.socket.disconnect();
      await event(questioner, 'room:player_disconnected');
    }
    const stopped = await event(questioner, 'game:stopped');
    assert.equal(stopped.reason, 'not_enough_players');
    assert.ok(stopped.message.includes('ホーム'));
    const snapshot = await ok(questioner, 'room:get_state');
    assert.equal(snapshot.room.status, 'finished');
    assert.equal(snapshot.room.players.filter((p) => p.is_connected).length, 1);
    assert.equal(snapshot.room.players.find((p) => p.id === questioner.player.id).is_host, true);
    for (const p of snapshot.room.players) assert.equal(p.score, earned.get(p.id));
    assert.equal(questioner.events.filter((entry) => entry.name === 'game:finished').length, 0);
    await denied(questioner, 'game:next_round');
    await denied(questioner, 'round:submit_fake', { title: '終了後のウソ' });
    questioner.socket.disconnect();
    for (let i = 0; rooms.has(room.code) && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(rooms.has(room.code), false);
  });
}

function loadAlertHelper(platform, window, nativeAlert = {}) {
  // The small helper has no JSX. Supply the platform import as a normal test
  // dependency so Node can exercise its actual browser callbacks without
  // importing React Native's native-only module graph.
  const source = readFileSync(join(__dirname, '../client/src/utils/alert.js'), 'utf8')
    .replace(/^import .* from 'react-native';\r?\n/u, '')
    .replace('export const Alert =', 'const Alert =');
  return runInNewContext(`${source}\nAlert;`, {
    Platform: { OS: platform }, NativeAlert: nativeAlert, window,
  });
}

test('web notices display their message and run the single chosen callback', () => {
  const calls = [];
  const alert = loadAlertHelper('web', { alert: (text) => calls.push(text) });
  alert.alert('切断', 'ホームに戻ります', [{ text: '戻る', onPress: () => calls.push('returned') }]);
  assert.deepEqual(calls, ['切断\n\nホームに戻ります', 'returned']);
});

test('web confirmations execute only the accepted or cancelled action', () => {
  const calls = [];
  const answers = [false, true];
  const alert = loadAlertHelper('web', { confirm: (text) => {
    assert.ok(text.includes('部屋から出る'));
    return answers.shift();
  } });
  const buttons = [
    { text: '戻る', style: 'cancel', onPress: () => calls.push('cancel') },
    { text: '部屋から出る', onPress: () => calls.push('leave') },
  ];
  alert.alert('確認', '部屋から出ますか？', buttons);
  assert.deepEqual(calls, ['cancel']);
  alert.alert('確認', '部屋から出ますか？', buttons);
  assert.deepEqual(calls, ['cancel', 'leave']);
});

test('native notices retain the original platform Alert', () => {
  const native = { alert() {} };
  assert.equal(loadAlertHelper('ios', undefined, native), native);
  assert.equal(loadAlertHelper('android', undefined, native), native);
});

test('question preparation is private to the current player questioner and avoids repeated works', async (t) => {
  const { bots, room } = await roomWith(t,4);
  const outsider = await bot(t);
  await ok(bots[0], 'game:start', {mode:'player'});
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find(b=>b.player.id===started.questioner.id);
  const answerers = bots.filter(b=>b!==questioner);
  const request = {roomId:room.id,roundId:started.round.id};
  await denied(outsider,'round:prepare_question',request);
  await Promise.all(answerers.map(b=>denied(b,'round:prepare_question',request)));
  await denied(questioner,'round:prepare_question',{...request,roomId:'wrong-room'});
  await denied(questioner,'round:prepare_question',{...request,roundId:'wrong-round'});
  await denied(questioner,'round:prepare_question',null);
  const before = JSON.stringify((await ok(answerers[0],'room:get_state')).round);
  const first = await ok(questioner,'round:prepare_question',request);
  const second = await ok(questioner,'round:prepare_question',request);
  assert.notEqual(first.questionId,second.questionId);
  assert.equal(JSON.stringify((await ok(answerers[0],'room:get_state')).round),before);
  for (const b of bots) {
    const shared=JSON.stringify(b.events);
    assert.ok(!shared.includes(first.title) && !shared.includes(second.title));
    assert.ok(!shared.includes(first.synopsis) && !shared.includes(second.synopsis));
  }
  const oldPublicApi=await fetch(url+'/api/random-work');
  assert.equal(oldPublicApi.status,404);
  const body=await oldPublicApi.json();
  assert.equal(body.title,undefined);assert.equal(body.synopsis,undefined);
  await ok(questioner,'round:submit_synopsis',{realTitle:second.title,synopsis:second.synopsis,questionId:second.questionId});
  await denied(questioner,'round:prepare_question',request);
});

test('CPU mode cannot return a real title through player preparation', async (t) => {
  const { bots, room }=await roomWith(t,4);
  await ok(bots[0],'game:start',{mode:'cpu'});
  const started=await event(bots[0],'game:started');
  await event(bots[0],'round:synopsis_fetched');
  await Promise.all(bots.map(b=>denied(b,'round:prepare_question',{roomId:room.id,roundId:started.round.id})));
});

for (const action of ['manual submission','reselection']) {
  test(`late player preparation cannot overwrite ${action} or consume an unused work`,async(t)=>{
    const { bots,room }=await roomWith(t,4);
    await ok(bots[0],'game:start',{mode:'player'});
    const started=await event(bots[0],'game:started');
    const questioner=bots.find(b=>b.player.id===started.questioner.id);
    const request={roomId:room.id,roundId:started.round.id};
    const delayed=delayNextQuestionSelection(t);
    const pending=ack(questioner,'round:prepare_question',request);
    await delayed.started;
    await denied(questioner,'round:prepare_question',request);
    await ok(questioner,'round:submit_synopsis',{realTitle:'手動の作品名',synopsis:'出題者が考えて書いた文章。'});
    if(action==='reselection') await ok(questioner,'round:reselect');
    delayed.release();
    const result=await pending;
    assert.equal(result.ok,false);
    assert.equal(result.title,undefined);assert.equal(result.synopsis,undefined);
    assert.deepEqual(rooms.get(room.code).usedQuestionIds,[]);
    if(action==='reselection') assert.equal((await ok(questioner,'round:prepare_question',request)).ok,true);
  });
}


test('departure and next round suppress a pending private preparation result', async(t)=>{
  const {bots,room}=await roomWith(t,4);
  await ok(bots[0],'game:start',{mode:'player'});
  const started=await event(bots[0],'game:started');
  const questioner=bots.find(b=>b.player.id===started.questioner.id);
  const delayed=delayNextQuestionSelection(t);
  let delivered=false;
  questioner.socket.emit('round:prepare_question',{roomId:room.id,roundId:started.round.id},()=>{delivered=true;});
  await delayed.started;
  questioner.socket.disconnect();
  const remaining=bots.filter(b=>b!==questioner);
  await event(remaining[0],'game:questioner_disconnected');
  await ok(remaining[0],'game:next_round');
  delayed.release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delivered,false);
  assert.deepEqual(rooms.get(room.code).usedQuestionIds,[]);
  assert.notEqual(rooms.get(room.code).rounds.at(-1).id,started.round.id);
});

test('failed private assistance leaves player input and manual publication available', async(t)=>{
  t.after(()=>writeBank());
  const {bots,room}=await roomWith(t,4);
  await ok(bots[0],'game:start',{mode:'player'});
  const started=await event(bots[0],'game:started');
  const questioner=bots.find(b=>b.player.id===started.questioner.id);
  writeBank([]);
  const result=await ack(questioner,'round:prepare_question',{roomId:room.id,roundId:started.round.id});
  assert.equal(result.ok,false);assert.equal(result.title,undefined);assert.equal(result.synopsis,undefined);
  assert.equal(rooms.get(room.code).rounds.at(-1).synopsis,null);
  writeBank();
  const text='出題者が自分で用意した紹介文。';
  await ok(questioner,'round:submit_synopsis',{realTitle:'手入力の正解',synopsis:text});
  const shown=await event(bots.find(b=>b!==questioner),'round:synopsis_presented');
  assert.equal(shown.synopsis,text);
  assert.ok(!JSON.stringify(shown).includes('手入力の正解'));
});

test('genre rule is a validated host-only lobby setting, synchronized to guests and fixed after start',async t=>{
  const {bots}=await roomWith(t,4);assert.equal((await ok(bots[0],'room:get_state')).room.settings.genreDisclosure,false);
  await denied(bots[1],'room:update_settings',{genreDisclosure:true});await denied(bots[0],'room:update_settings',{genreDisclosure:'yes'});
  await ok(bots[0],'room:update_settings',{genreDisclosure:true});
  for(const b of bots)assert.equal((await event(b,'room:settings_updated')).settings.genreDisclosure,true);
  await denied(bots[0],'game:start',{mode:'player',genreDisclosure:1});await ok(bots[0],'game:start',{mode:'player'});
  const start=await event(bots[0],'game:started');assert.equal(start.settings.genreDisclosure,true);assert.equal(start.round.workKind,undefined);
  await denied(bots[0],'room:update_settings',{genreDisclosure:false});
});
for (const seconds of [0, 60, 180, 300, 420]) test(`duration ${seconds}s limits title submission only and voting recovery stays untimed`, async t => {
  const { bots, room, entry } = await roomWith(t, 4);
  const settings = { genreDisclosure: false, advanceMode: 'consent', timeLimitSeconds: seconds };
  await denied(bots[1], 'room:update_settings', settings);
  assert.deepEqual((await ok(bots[0], 'room:update_settings', settings)).settings, settings);
  for (const b of bots) assert.deepEqual((await event(b, 'room:settings_updated')).settings, settings);
  if (seconds === 60) {
    for (const invalid of [30, 120, 240, 480, '300', {}]) {
      await denied(bots[0], 'room:update_settings', { ...settings, timeLimitSeconds: invalid });
      assert.deepEqual((await ok(bots[0], 'room:get_state')).room.settings, settings);
    }
  }
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  assert.deepEqual(started.settings, settings);
  await denied(bots[0], 'room:update_settings', { ...settings, timeLimitSeconds: 180 });
  const q = bots.find(b => b.player.id === started.round.questioner_id);
  const answerers = bots.filter(b => b !== q);
  await ok(q, 'round:submit_synopsis', { synopsis: '港町で手紙を探す物語。', realTitle: '秘密の正解' });
  for (const b of answerers) await ok(b, 'round:declare_unknown');
  const before = Date.now();
  await ok(q, 'round:start_submitting');
  const submitting = await event(bots[0], 'round:submitting_started');
  if (seconds) assert.ok(submitting.deadlineAt >= before + seconds * 1000 && submitting.deadlineAt <= Date.now() + seconds * 1000);
  else assert.equal(submitting.deadlineAt, null);
  for (const [i, b] of answerers.entries()) await ok(b, 'round:submit_fake', { title: `回答案${i}` });
  await ok(q, 'round:advance_phase');
  const voting = await event(bots[0], 'round:choices_presented');
  assert.equal(voting.deadlineAt, null);
  const restored = await bot(t);
  const resume = await ok(restored, 'room:resume', { code: room.code, playerId: entry.player.id, token: entry.token });
  assert.deepEqual(resume.room.settings, settings);
  assert.deepEqual(resume.gameData.settings, settings);
  assert.equal(resume.gameData.round.deadlineAt, voting.deadlineAt);
  assert.equal(resume.gameData.resumeState.phase, 'voting');
});
for(const disclosure of [false,true])test(`manual genre disclosure ${disclosure} follows declaration/title phases and clears on reselection`,async t=>{
  const {bots}=await roomWith(t,4);await ok(bots[0],'game:start',{mode:'player',genreDisclosure:disclosure});
  const start=await event(bots[0],'game:started'),q=bots.find(b=>b.player.id===start.questioner.id),others=bots.filter(b=>b!==q);
  if(disclosure)await denied(q,'round:submit_synopsis',{synopsis:'手動で用意する紹介文です。',realTitle:'非公開の答え'});
  await denied(q,'round:submit_synopsis',{synopsis:'手動で用意する紹介文です。',realTitle:'非公開の答え',workKind:'INVALID'});
  await ok(q,'round:submit_synopsis',{synopsis:'手動で用意する紹介文です。',realTitle:'非公開の答え',workKind:'film'});
  for(const b of bots){const shown=await event(b,'round:synopsis_presented',disclosure);assert.equal(shown.workKind,disclosure?'film':undefined);assert.equal(shown.workKindLabel,disclosure?'映画':undefined);assert(!JSON.stringify(shown).includes('非公開の答え'));}
  assertNoSources(await ok(others[0],'room:get_state'));
  await ok(others[0],'round:declare_known');await ok(q,'round:reselect');
  for(const b of bots)assert.equal((await event(b,'round:reselect_started')).workKind,undefined);
  await ok(q,'round:submit_synopsis',{synopsis:'変更後の紹介文です。',realTitle:'変更後の答え',workKind:'game'});
  for(const b of bots){const shown=await event(b,'round:synopsis_presented',disclosure);assert.equal(shown.workKind,disclosure?'game':undefined);}
  for(const b of others)await ok(b,'round:declare_unknown');await ok(q,'round:start_submitting');
  for(const b of bots)assert.equal((await event(b,'round:synopsis_presented',disclosure)).workKind,disclosure?'game':undefined);
});
for(const disclosure of [false,true])test(`CPU genre disclosure ${disclosure} keeps title and provenance private in preview and declaration`,async t=>{
  writeBank();const {bots}=await roomWith(t,4);for(const b of bots)b.allowGenre=disclosure;await ok(bots[0],'game:start',{mode:'cpu',totalRounds:1,genreDisclosure:disclosure});
  const start=await event(bots[0],'game:started');
  if(disclosure)await ok(bots[0],'round:reroll_synopsis',{workKind:'novel'});
  const preview=await event(bots[0],'round:synopsis_fetched',disclosure),work=questionForSynopsis(preview.synopsis);
  assert.equal(preview.workKind,disclosure?work.kind:undefined);assert.equal(bots[1].events.some(e=>e.name==='round:synopsis_fetched'),false);
  const recovered=await ok(bots[0],'round:get_synopsis',{roomId:bots[0].player.room_id,roundId:start.round.id});assert.equal(recovered.workKind,disclosure?work.kind:undefined);assert(!JSON.stringify(recovered).includes(work.realTitle));
  await ok(bots[0],'round:confirm_synopsis');for(const b of bots){const shown=await event(b,'round:synopsis_presented',disclosure);assert.equal(shown.workKind,disclosure?work.kind:undefined);assert(!JSON.stringify(shown).includes(work.realTitle));}
  assertNoSources(await ok(bots[1],'room:get_state'));
});


test('editing the helper genre keeps the declared medium and drops incompatible automatic attribution',async t=>{
  writeBank();const {bots,room}=await roomWith(t,4);await ok(bots[0],'game:start',{mode:'player',genreDisclosure:true});
  const start=await event(bots[0],'game:started'),q=bots.find(b=>b.player.id===start.questioner.id);
  const helper=await ok(q,'round:prepare_question',{roomId:room.id,roundId:start.round.id,workKind:'novel'});assert.equal(helper.kind,'novel');
  await ok(q,'round:submit_synopsis',{realTitle:helper.title,synopsis:helper.synopsis,questionId:helper.questionId,workKind:'film'});
  const shown=await event(q,'round:synopsis_presented',true);assert.equal(shown.workKind,'film');
  const round=rooms.get(room.code).rounds.at(-1);assert.equal(round.workKind,'film');assert.equal(round.sourceQuestion,null);
  for(const b of bots){while(b.events.some(e=>e.name==='round:synopsis_presented'))await event(b,'round:synopsis_presented',true);}
});

for (const chosenKind of ['manga', 'any']) test(`genre-enabled CPU ${chosenKind} waits for its host and keeps its choice across retry and recovery`, async t => {
  writeBank(allFixtureQuestions);
  const { bots, room, entry } = await roomWith(t, 4);
  for (const b of bots) b.allowGenre = true;
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 2, genreDisclosure: true });
  const start = await event(bots[0], 'game:started');
  const request = { roomId: room.id, roundId: start.round.id };
  const waiting = await ok(bots[0], 'round:get_synopsis', request);
  assert.equal(waiting.synopsis, null);
  assert.equal(waiting.loading, false);
  assert.equal(bots[0].events.some(e => e.name === 'round:synopsis_fetched'), false);
  await denied(bots[1], 'round:reroll_synopsis', { workKind: 'manga' });
  await denied(bots[0], 'round:reroll_synopsis');
  for (const workKind of ['INVALID', ['manga'], null]) await denied(bots[0], 'round:reroll_synopsis', { workKind });
  await ok(bots[0], 'round:reroll_synopsis', { workKind: chosenKind });
  const preview = await event(bots[0], 'round:synopsis_fetched', true);
  assert.equal(preview.workKind, chosenKind);
  assert.equal(preview.workKindLabel, chosenKind === 'any' ? 'ノンジャンル' : '漫画');
  assert.equal(bots[1].events.some(e => e.name === 'round:synopsis_fetched'), false);
  const restored = await bot(t);
  restored.allowGenre = true;
  const resume = await ok(restored, 'room:resume', { code: room.code, playerId: entry.player.id, token: entry.token });
  assert.equal(resume.gameData.resumeState.workKind, chosenKind);
  assert.equal(resume.gameData.resumeState.fetchedSynopsis, preview.synopsis);
  await ok(restored, 'round:reroll_synopsis');
  assert.equal((await event(restored, 'round:synopsis_fetched', true)).workKind, chosenKind);
  await ok(restored, 'round:reroll_synopsis', { workKind: 'novel' });
  assert.equal((await event(restored, 'round:synopsis_fetched', true)).workKind, 'novel');
  await ok(restored, 'round:confirm_synopsis');
  const answerers = [restored, ...bots.slice(1)];
  for (const b of answerers) assert.equal((await event(b, 'round:synopsis_presented', true)).workKind, 'novel');
  await ok(bots[1], 'round:declare_known');
  await ok(restored, 'round:reselect');
  assert.equal((await event(restored, 'round:synopsis_fetched', true)).workKind, 'novel');
  writeBank();
});

for (const chosenKind of ['manga', 'any']) test(`genre-enabled human helper ${chosenKind} validates the choice and keeps attribution`, async t => {
  writeBank(allFixtureQuestions);
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player', genreDisclosure: true });
  const start = await event(bots[0], 'game:started'), q = bots.find(b => b.player.id === start.questioner.id);
  const request = { roomId: room.id, roundId: start.round.id };
  await denied(q, 'round:prepare_question', request);
  for (const workKind of ['INVALID', ['manga'], null]) await denied(q, 'round:prepare_question', { ...request, workKind });
  await denied(bots.find(b => b !== q), 'round:prepare_question', { ...request, workKind: 'manga' });
  const helper = await ok(q, 'round:prepare_question', { ...request, workKind: chosenKind });
  assert.equal(helper.kind, chosenKind);
  await denied(q, 'round:prepare_question', { ...request, workKind: 'film' });
  await ok(q, 'round:submit_synopsis', { synopsis: helper.synopsis, realTitle: helper.title,
    questionId: helper.questionId, workKind: chosenKind });
  for (const b of bots) {
    const shown = await event(b, 'round:synopsis_presented', true);
    assert.equal(shown.workKind, chosenKind);
    assert.equal(JSON.stringify(shown).includes(helper.title), false);
  }
  assert.equal(rooms.get(room.code).rounds.at(-1).sourceQuestion.id, helper.questionId);
  writeBank();
});

for (const kind of ['short-story', 'literary-work']) test(`human novel helper includes ${kind} and retains original verified classification`, async t => {
  t.after(() => writeBank());
  const question = genreQuestions.find(q => q.kind === kind);
  writeBank([question, genreQuestions[0]]);
  const { bots, room } = await roomWith(t, 4);
  for (const b of bots) b.allowGenre = true;
  await ok(bots[0], 'game:start', { mode: 'player', genreDisclosure: true });
  const start = await event(bots[0], 'game:started'), q = bots.find(b => b.player.id === start.questioner.id);
  const helper = await ok(q, 'round:prepare_question', { roomId: room.id, roundId: start.round.id, workKind: 'novel' });
  assert.equal(helper.kind, 'novel');
  assert.equal(helper.questionId, question.id);
  await ok(q, 'round:submit_synopsis', { synopsis: helper.synopsis, realTitle: helper.title, questionId: helper.questionId, workKind: 'novel' });
  const stored = rooms.get(room.code).rounds.at(-1);
  assert.equal(stored.workKind, 'novel');
  assert.equal(stored.sourceQuestion.kind, kind);
  assert.deepEqual(stored.sourceQuestion.evidence, question.evidence);
  assert.equal((await event(bots.find(b => b !== q), 'round:synopsis_presented', true)).workKindLabel, '小説');
});

test('changing a CPU genre cancels a late old selection and the next round waits for a new genre', async t => {
  writeBank(allFixtureQuestions);
  const { bots, room } = await roomWith(t, 4);
  for (const b of bots) b.allowGenre = true;
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 2, genreDisclosure: true });
  await event(bots[0], 'game:started');
  const delayed = delayNextQuestionSelection(t);
  await ok(bots[0], 'round:reroll_synopsis', { workKind: 'manga' });
  await delayed.started;
  await ok(bots[0], 'round:reroll_synopsis', { workKind: 'novel' });
  const preview = await event(bots[0], 'round:synopsis_fetched', true);
  assert.equal(preview.workKind, 'novel');
  delayed.release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(rooms.get(room.code).rounds.at(-1).workKind, 'novel');
  assert.equal(bots[0].events.some(e => e.name === 'round:synopsis_fetched'), false);
  await confirmCpuAndStart(bots[0], bots);
  for (const b of bots) await ok(b, 'round:submit_fake', { title: `検証用の案${b.player.id}` });
  const choices = await event(bots[0], 'round:choices_presented');
  for (const b of bots) await ok(b, 'round:submit_vote', { answerId: choices.choices.find(c => c.id !== rooms.get(room.code).rounds.at(-1).answers.find(a => a.player_id === b.player.id)?.id).id });
  await event(bots[0], 'round:revealed');
  await ok(bots[0], 'game:next_round');
  const next = await event(bots[0], 'game:round_started');
  const waiting = await ok(bots[0], 'round:get_synopsis', { roomId: room.id, roundId: next.round.id });
  assert.equal(waiting.synopsis, null);
  assert.equal(waiting.loading, false);
  assert.equal(waiting.workKind, undefined);
  writeBank();
});

test('computer titles are complete, distinct and bounded for every supported seat count and short or unknown introductions', () => {
  for (const synopsis of ['宇宙船。惑星。', '港町。手紙。', 'あああ。', '', '代償。政策。処遇。']) {
    for (let count = 0; count <= 5; count++) {
      const titles = generateComputerTitles(synopsis, count);
      assert.equal(titles.length, count);
      assert.equal(new Set(titles).size, count);
      assert.ok(titles.every(title => typeof title === 'string' && title.length > 0 && title.length <= 50));
      assert.ok(titles.every(title => !/代償|政策|処遇|港町の手紙|手紙と港町|宇宙船の惑星/u.test(title)));
      if (synopsis.startsWith('宇宙船')) assert.ok(titles.every(title => /星|銀河|宇宙|帰還|故郷|地球/u.test(title)));
      if (synopsis.startsWith('港町')) assert.ok(titles.every(title => /手紙|便り|宛先|差出人|届|一通|ポスト/u.test(title)));
    }
  }
});

test('computer titles prioritize plot events over repeated settings, cast credits and quoted work names', () => {
  const cases = [
    ['家族が宇宙の歴史を語る港町。父は息子を誘拐され、取り戻すために奔走する。', /返して|帰って|奪われた|取り戻す|無事|帰り|連れて/u],
    ['高校の教室で同級生と過ごす高校生が、同じ日を何度も繰り返してしまう。', /今日|朝|明日|一日|やり直し/u],
    ['会社の社長が地球滅亡の危機を招き、社員と会社から世界を救おうとする。', /世界|明日|朝|終わり|時間|夜明け/u],
    ['会社で働く女性が職場で嫌がらせを受け、弁護士と共に裁判に挑む。', /法廷|証言|判決|沈黙|正しさ|訴え|弁護/u],
    ['研究所に捕獲された生き物が、知恵を使って脱出し、生き残る道を探す。', /帰る|出口|脱出|逃げ|自由|外の世界|留まれない/u],
    ['会社で働く警備員が、情報を統制し歴史を書き換える体制に抗う。', /嘘|昨日|真実|沈黙|書き換え|従わない|言葉/u],
    ['学校の生徒たちが、放課後の教室に現れる幽霊の正体を探る。', /誰|気づいて|まだ|見えない|ひとり|振り返/u],
    ['部活の仲間と全国大会を目指し、試合で敗れながら成長する。', /秒|勝|負け|越え|夢|挑/u],
    ['農場で作物を育て、収穫しながら暮らすゲーム。', /種|実り|土地|土|畑|収穫|育て/u],
    ['色と形を組み合わせ、パズルの仕掛けを解くゲーム。', /ひらめき|答え|解|手がかり/u],
    ['町で暮らす青年と少女が出会い、さまざまな壁を越えて愛情を深めていく。', /あなた|ふたり|愛|君|となり|好き/u],
    ['港町に届いた手紙の差出人を探す。『タイムリープ捜査』などの俳優が主演を務める。', /手紙|便り|宛先|差出人|届|一通|ポスト/u],
    ['人質を取り戻す物語。『幽霊裁判』などの俳優が父親を演じる。女優たちが共演する。', /返して|帰って|奪われた|取り戻す|無事|帰り|連れて/u],
  ];
  for (const [synopsis, relevant] of cases) {
    const titles = generateComputerTitles(synopsis, 5);
    assert.ok(titles.every(title => relevant.test(title)), `${synopsis}: ${titles.join(' / ')}`);
    assert.ok(titles.every(title => !/主演|俳優|社長|警備員|生徒|同級生|研究所/u.test(title)));
  }
});

test('computer titles do not mistake ordinary memories, a shared date or artificial intelligence for unrelated plots', () => {
  const ordinary = generateComputerTitles('同じ日を過ごした同級生が、学校で夏休みの思い出と過去の記憶を語り合う。', 5);
  assert.ok(ordinary.every(title => /放課後|卒業|夏休み|制服|校庭|春|教室/u.test(title)));
  const artificial = generateComputerTitles('人工知能を備えたロボットが、人間と一緒に町で暮らす。', 5);
  assert.ok(artificial.every(title => /人間|心|機械|何者|つくられた/u.test(title)));
  assert.ok(artificial.every(title => !/銀河|宇宙|惑星|航路|地球/u.test(title)));
  const lost = generateComputerTitles('記憶を失った青年が、自分の過去を知る人を探す。', 5);
  assert.ok(lost.every(title => /自分|記憶|思い出せ|覚えて|昨日|名前|忘れた/u.test(title)));
});

test('computer seats are host-only, bounded, synchronized and cannot be forged by a joining human', async (t) => {
  const { bots, room } = await roomWith(t, 2);
  const host = bots[0];
  await denied(bots[1], 'room:set_computers', { count: 2 });
  for (const count of [-1, 6, 1.5, '2', null, true]) await denied(host, 'room:set_computers', { count });
  const added = await ok(host, 'room:set_computers', { count: 2 });
  const ids = added.allPlayers.filter((p) => p.isComputer).map((p) => p.id);
  assert.equal(ids.length, 2);
  assert.deepEqual((await event(bots[1], 'room:players_updated')).allPlayers, added.allPlayers);
  assert.ok(rooms.get(room.code).players.filter((p) => p.is_computer).every((p) => !p.is_host && p.socket_id === null));
  const same = await ok(host, 'room:set_computers', { count: 2 });
  assert.deepEqual(same.allPlayers.filter((p) => p.isComputer).map((p) => p.id), ids);
  const joining = await bot(t);
  const joined = await ok(joining, 'room:join', { code: room.code, nickname: 'コンピュータ3', isComputer: true, is_computer: true });
  assert.equal(joined.player.is_computer, false);
  assert.equal(joined.allPlayers.find((p) => p.id === joined.player.id).isComputer, false);
  const filled = await ok(host, 'room:set_computers', { count: 3 });
  assert.equal(filled.allPlayers.length, 6);
  assert.equal(new Set(filled.allPlayers.map((p) => p.nickname)).size, 6);
  await denied(host, 'room:set_computers', { count: 4 });
  const outsider = await bot(t);
  await denied(outsider, 'room:join', { code: room.code, nickname: '満員' });
  await ok(host, 'room:set_computers', { count: 0 });
  assert.equal(rooms.get(room.code).players.length, 3);
  await ok(host, 'game:start', { mode: 'cpu' });
});

for (const [humanCount, computerCount, mode] of [[2, 2, 'player'], [2, 2, 'cpu'], [1, 1, 'cpu'], [1, 3, 'cpu'], [1, 4, 'cpu'], [1, 5, 'cpu']]) {
  test(`${humanCount} humans + ${computerCount} title-only computers / ${mode}: complete every round without computer votes or questions`, async (t) => {
    writeBank();
    const { bots, room } = await roomWith(t, humanCount);
    const host = bots[0];
    await ok(host, 'room:set_computers', { count: computerCount });
    await ok(host, 'game:start', { mode, totalRounds: 2 });
    await denied(host, 'room:set_computers', { count: 0 });
    const totalRounds = mode === 'player' ? humanCount : 2;
    for (let number = 1; number <= totalRounds; number++) {
      const start = await event(host, number === 1 ? 'game:started' : 'game:round_started');
      assert.equal(start.humanCount, humanCount);
      assert.equal(start.totalRounds, totalRounds);
      assert.ok((start.playerOrder || []).every((p) => bots.some((b) => b.player.id === p.id)));
      const questioner = bots.find((b) => b.player.id === start.questioner?.id);
      const controller = questioner || host;
      const answerers = bots.filter((b) => b !== questioner);
      let realTitle;
      if (mode === 'cpu') {
        const fetched = await event(host, 'round:synopsis_fetched');
        realTitle = questionForSynopsis(fetched.synopsis).realTitle;
        if (humanCount === 1) await denied(host, 'round:use_manual');
        await ok(host, 'round:confirm_synopsis');
      } else {
        realTitle = `本物の答え${number}`;
        await ok(questioner, 'round:submit_synopsis', { synopsis: '港町に届いた手紙から家族の秘密を知り、青年は旅に出る。', realTitle });
      }
      await denied(controller, 'round:start_submitting');
      for (const b of answerers) await ok(b, 'round:declare_unknown');
      const declared = await event(controller, 'round:all_declared');
      assert.equal(declared.totalCount, answerers.length);
      await ok(controller, 'round:start_submitting');
      await denied(controller, 'round:start_submitting');
      const state = rooms.get(room.code);
      const round = state.rounds.at(-1);
      const computerIds = state.players.filter((p) => p.is_computer).map((p) => p.id);
      assert.equal(round.answers.length, computerCount);
      assert.equal(new Set(round.answers.map((a) => a.title)).size, computerCount);
      assert.ok(round.answers.every((a) => computerIds.includes(a.player_id) && !a.is_real));
      assert.ok(round.answers.every(a => typeof a.title === 'string' && a.title.length > 0 && a.title.length <= 50));
      if (mode === 'player') assert.ok(round.answers.every(a => /手紙|便り|宛先|差出人|届|一通|ポスト/u.test(a.title)));
      assert.ok(!JSON.stringify((await ok(host, 'room:get_state')).room).includes(realTitle));
      for (let i = 0; i < answerers.length; i++) {
        await ok(answerers[i], 'round:submit_fake', { title: `人間の案${number}-${i}`, playerId: computerIds[0] });
        await denied(answerers[i], 'round:submit_fake', { title: '二重提出' });
      }
      const shown = await event(host, 'round:choices_presented');
      assert.equal(shown.choices.length, computerCount + answerers.length + 1);
      assert.ok(shown.choices.every((choice) => !('author' in choice) && !('isReal' in choice)));
      const computerAnswer = round.answers.find((a) => a.player_id === computerIds[0]);
      const realAnswer = round.answers.find((a) => a.is_real);
      for (let i = 0; i < answerers.length; i++) {
        const own = round.answers.find((a) => a.player_id === answerers[i].player.id);
        await denied(answerers[i], 'round:submit_vote', { answerId: own.id });
        await ok(answerers[i], 'round:submit_vote', { answerId: i === 0 ? computerAnswer.id : realAnswer.id });
      }
      const revealed = await event(host, 'round:revealed');
      assert.equal(revealed.realTitle, realTitle);
      assert.equal(revealed.votes.length, answerers.length);
      assert.ok(revealed.votes.every((v) => !computerIds.includes(v.voterId)));
      const computerScore = revealed.roundScores.find((score) => score.player_id === computerIds[0]);
      assert.equal(computerScore.correct_pts, 0);
      assert.equal(computerScore.deceive_pts, 1);
      if (questioner) await ok(questioner, 'round:submit_mvp', { answerId: computerAnswer.id });
      await ok(host, 'game:next_round');
    }
    const finished = await event(host, 'game:finished');
    assert.equal(finished.finalScores.length, humanCount + computerCount);
    const computer = rooms.get(room.code).players.find((p) => p.is_computer);
    assert.equal(computer.score, totalRounds * (mode === 'player' ? 2 : 1));
    assert.equal(computer.turn_order, null);
  });
}

test('a human inherits host duties ahead of computers and can continue CPU play alone', async (t) => {
  writeBank();
  const { bots, room } = await roomWith(t, 1);
  const host = bots[0];
  await ok(host, 'room:set_computers', { count: 3 });
  const guest = await bot(t);
  guest.player = (await ok(guest, 'room:join', { code: room.code, nickname: '引継ぎ' })).player;
  await ok(host, 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(host, 'round:synopsis_fetched');
  host.socket.disconnect();
  await event(guest, 'room:player_disconnected');
  await event(guest, 'round:synopsis_fetched');
  const snapshot = await ok(guest, 'room:get_state');
  assert.equal(snapshot.room.status, 'playing');
  assert.equal(snapshot.room.players.find((p) => p.id === guest.player.id).is_host, true);
  assert.ok(snapshot.room.players.filter((p) => p.is_computer).every((p) => !p.is_host));
  await confirmCpuAndStart(guest, [guest]);
  await ok(guest, 'round:submit_fake', { title: '引継ぎ後の案' });
  const shown = await event(guest, 'round:choices_presented');
  await ok(guest, 'round:submit_vote', { answerId: shown.choices.find((c) => c.id !== shown.ownAnswerId).id });
  await event(guest, 'round:revealed');
  await ok(guest, 'game:next_round');
  await event(guest, 'game:finished');
  guest.socket.disconnect();
  for (let i = 0; rooms.has(room.code) && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rooms.has(room.code), false);
});

test('computers do not keep a room alive or replace a departed human questioner', async (t) => {
  const waiting = await roomWith(t, 1);
  await ok(waiting.bots[0], 'room:set_computers', { count: 5 });
  waiting.bots[0].socket.disconnect();
  for (let i = 0; rooms.has(waiting.room.code) && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rooms.has(waiting.room.code), false);
  const { bots, room } = await roomWith(t, 2);
  await ok(bots[0], 'room:set_computers', { count: 2 });
  await ok(bots[0], 'game:start', { mode: 'player' });
  bots[0].socket.disconnect();
  assert.equal((await event(bots[1], 'game:stopped')).reason, 'not_enough_players');
  assert.equal(rooms.get(room.code).status, 'finished');
  await denied(bots[1], 'game:next_round');
});

for (const index of [0, 1]) {
  test(`temporary ${index ? 'polling' : 'websocket'} interruption restores identity, scores and missed choices`, async (t) => {
    const { bots, room } = await roomWith(t, 4);
    const subject = bots[index];
    const observer = bots[1 - index];
    await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
    await event(bots[0], 'round:synopsis_fetched');
    await confirmCpuAndStart(bots[0], bots);
    await ok(subject, 'round:submit_fake', { title: '通信を戻す人の案' });
    const socketId = subject.socket.id;
    rooms.get(room.code).players[index].score = 7;
    const serverSocket = io.sockets.sockets.get(socketId);
    const disconnected = once(serverSocket, 'disconnect', { signal: AbortSignal.timeout(3000) });
    subject.socket.io.engine.close();
    await disconnected;
    assert.equal(rooms.get(room.code).players[index].is_connected, true);
    assert.equal(observer.events.some((e) => e.name === 'room:player_disconnected'), false);
    for (const [i, b] of bots.entries()) {
      if (b !== subject) await ok(b, 'round:submit_fake', { title: `通信中の案${i}` });
    }
    const expected = await event(observer, 'round:choices_presented');
    const reconnected = once(subject.socket, 'connect', { signal: AbortSignal.timeout(3000) });
    subject.socket.connect();
    await reconnected;
    assert.equal(subject.socket.recovered, true);
    assert.equal(subject.socket.id, socketId);
    const replayed = await event(subject, 'round:choices_presented');
    assert.deepEqual(replayed.choices, expected.choices);
    assert.ok(replayed.ownAnswerId);
    const state = await ok(subject, 'room:get_state');
    assert.equal(state.room.players.find((p) => p.id === subject.player.id).score, 7);
    const real = replayed.choices.find((c) => c.title.startsWith('正解'));
    for (const b of bots) await ok(b, 'round:submit_vote', { answerId: real.id });
    await event(subject, 'round:revealed');
    await ok(bots[0], 'game:next_round');
    await event(subject, 'game:finished');
  });
}

test('a lone lobby host recovers without losing the room or host role', async (t) => {
  const { bots: [host], room } = await roomWith(t, 1);
  await event(host, 'room:session_ready');
  const socketId = host.socket.id;
  const disconnected = once(io.sockets.sockets.get(socketId), 'disconnect', { signal: AbortSignal.timeout(3000) });
  host.socket.io.engine.close();
  await disconnected;
  assert.equal(rooms.has(room.code), true);
  const reconnected = once(host.socket, 'connect', { signal: AbortSignal.timeout(3000) });
  host.socket.connect();
  await reconnected;
  assert.equal(host.socket.recovered, true);
  const state = await ok(host, 'room:get_state');
  assert.equal(state.room.players.length, 1);
  assert.equal(state.room.players[0].is_host, true);
});

test('expired packet replay reserves the room and rejects unauthenticated fresh membership', async (t) => {
  const { bots: [host], room } = await roomWith(t, 1);
  await event(host, 'room:session_ready');
  const duration = io.opts.connectionStateRecovery.maxDisconnectionDuration;
  t.after(() => { io.opts.connectionStateRecovery.maxDisconnectionDuration = duration; });
  io.opts.connectionStateRecovery.maxDisconnectionDuration = 30;
  const disconnected = once(io.sockets.sockets.get(host.socket.id), 'disconnect', { signal: AbortSignal.timeout(3000) });
  host.socket.io.engine.close();
  await disconnected;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(rooms.has(room.code), true);
  assert.equal(rooms.get(room.code).players[0].is_online, false);
  const currentTime = Date.now();
  const now = t.mock.method(Date, 'now', () => currentTime + duration + 1000);
  const reconnected = once(host.socket, 'connect', { signal: AbortSignal.timeout(3000) });
  host.socket.connect();
  await reconnected;
  now.mock.restore();
  assert.equal(host.socket.recovered, false);
  await denied(host, 'room:get_state');
  await denied(host, 'game:start', { mode: 'player' });
});

test('replayed transport state cannot restore a removed game membership', async (t) => {
  const { bots: [host], room } = await roomWith(t, 1);
  await event(host, 'room:session_ready');
  const socketId = host.socket.id;
  const disconnected = once(io.sockets.sockets.get(socketId), 'disconnect', { signal: AbortSignal.timeout(3000) });
  host.socket.io.engine.close();
  await disconnected;
  rooms.delete(room.code);
  const rejected = once(host.socket, 'disconnect', { signal: AbortSignal.timeout(3000) });
  host.socket.connect();
  assert.equal((await rejected)[0], 'io server disconnect');
  assert.equal(host.socket.connected, false);
  assert.equal(io.sockets.sockets.has(socketId), false);
});

test('a snapshot write failure leaves no orphan seat and returns no storage path', async (t) => {
  const host = await bot(t);
  const count = rooms.size;
  const before = readFileSync(process.env.ROOM_STATE_PATH, 'utf8');
  t.mock.method(require('node:fs'), 'renameSync', () => { throw new Error('private-storage-path'); });
  const result = await ack(host, 'room:create', { nickname: '保存障害の確認' });
  assert.equal(result.ok, false);
  assert.match(result.error, /部屋を保存できません/);
  assert(!JSON.stringify(result).includes('private-storage-path'));
  assert.equal(rooms.size, count);
  assert.equal(readFileSync(process.env.ROOM_STATE_PATH, 'utf8'), before);
});

test('browser room bookmarks survive reload, observe deletion and tolerate unavailable storage', () => {
  const source = readFileSync(join(__dirname, '../client/src/utils/roomSession.js'), 'utf8')
    .replaceAll('export function ', 'function ') + '\n({ getRoomSession, saveRoomSession, clearRoomSession })';
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const api = runInNewContext(source, { localStorage: storage });
  const saved = { code: '000123', playerId: 'own-seat', token: 'x'.repeat(43), nickname: '本人', serverUrl: 'https://game.example' };
  api.saveRoomSession(saved);
  const reloaded = runInNewContext(source, { localStorage: storage });
  assert.equal(reloaded.getRoomSession().token, saved.token);
  api.clearRoomSession();
  assert.equal(reloaded.getRoomSession(), null, 'another tab must observe explicit exit');
  api.saveRoomSession(saved);
  values.set([...values.keys()][0], JSON.stringify({ ...saved, token: 'invalid' }));
  assert.equal(reloaded.getRoomSession(), null);
  const unavailable = runInNewContext(source, { localStorage: {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); },
  } });
  unavailable.saveRoomSession(saved);
  assert.equal(unavailable.getRoomSession().code, saved.code);
  unavailable.clearRoomSession();
  assert.equal(unavailable.getRoomSession(), null);
});

test('a transport lost during the resume reply keeps recovery active; an unavailable seat still returns home', { timeout: 10000 }, async (t) => {
  const host = await bot(t);
  const entry = await ok(host, 'room:create', { nickname: '復帰中に再切断' });
  let markPending;
  const pending = new Promise((resolve) => { markPending = resolve; });
  let delayed;
  const holdOneReply = (socket) => socket.use((packet, next) => {
    if (packet[0] === 'room:resume' && !delayed) { delayed = next; markPending(); }
    else next();
  });
  io.on('connection', holdOneReply);
  t.after(() => { io.off('connection', holdOneReply); delayed?.(); });
  const home = [];
  const alerts = [];
  const leaving = { current: false };
  let cleared = false;
  let restored;
  let markRestored;
  const returned = new Promise((resolve) => { markRestored = resolve; });
  let markUnavailable;
  const unavailable = new Promise((resolve) => { markUnavailable = resolve; });
  let cleanup;
  const source = readFileSync(join(__dirname, '../client/src/hooks/useRoomRecovery.js'), 'utf8')
    .replace(/^import .*;\r?\n/gmu, '').replace('export default function ', 'function ');
  const useRecovery = runInNewContext(`${source}\nuseRoomRecovery;`, {
    useState: (value) => [value, () => {}], useEffect: (effect) => { cleanup = effect(); }, setTimeout, clearTimeout,
    useIsFocused: () => true,
    getSocket: () => host.socket,
    getRoomSession: () => ({ code: entry.room.code, playerId: entry.player.id, token: entry.token }),
    clearRoomSession: () => { cleared = true; },
    disconnectSocket: () => host.socket.disconnect(),
    showRoom: (_, result) => { restored = result; markRestored(); },
    Alert: { alert: (...args) => { alerts.push(args); markUnavailable(); } },
  });
  useRecovery({ reset: state => {
    assert.equal(state.index, 0);
    assert.equal(JSON.stringify(state.routes), JSON.stringify([{ name: 'Home' }]));
    home.push('Home');
  }, isFocused: () => true }, leaving);
  t.after(() => cleanup());
  async function interrupt() {
    const disconnected = once(host.socket, 'disconnect', { signal: AbortSignal.timeout(3000) });
    const serverDisconnected = once(io.sockets.sockets.get(host.socket.id), 'disconnect', { signal: AbortSignal.timeout(3000) });
    host.socket.io.engine.close();
    await Promise.all([disconnected, serverDisconnected]);
  }
  await interrupt();
  host.socket.connect();
  await pending;
  await interrupt();
  assert.deepEqual(home, [], 'a failed transport must not cancel automatic recovery');
  assert.deepEqual(alerts, []);
  assert.equal(cleared, false);
  assert.equal(leaving.current, false);
  assert.equal(host.socket.active, true);
  host.socket.connect();
  await returned;
  assert.equal(restored.room.code, entry.room.code);
  assert.equal(restored.player.id, entry.player.id);
  await ok(host, 'room:leave');
  await interrupt();
  const currentTime = Date.now();
  const clock = t.mock.method(Date, 'now', () => currentTime + io.opts.connectionStateRecovery.maxDisconnectionDuration + 1000);
  host.socket.connect();
  await unavailable;
  clock.mock.restore();
  assert.deepEqual(home, ['Home']);
  assert.equal(cleared, true, 'a genuinely unavailable seat must revoke the bookmark');
  assert.equal(leaving.current, true);
});

const recoveryTestModules = new WeakMap();
function focusedRecovery(socket, session, navigation, leaving, showRoom, onState = () => {}) {
  let focused = true;
  let cleanup;
  navigation.isFocused = () => focused;
  navigation.onShowRoom = result => showRoom(navigation, result);
  if (!recoveryTestModules.has(socket)) {
    const source = readFileSync(join(__dirname, '../client/src/hooks/useRoomRecovery.js'), 'utf8')
      .replace(/^import .*;\r?\n/gmu, '').replace('export default function ', 'function ');
    const context = {};
    recoveryTestModules.set(socket, { context, hook: runInNewContext(`${source}\nuseRoomRecovery;`, context) });
  }
  const { context, hook } = recoveryTestModules.get(socket);
  const globals = {
      setTimeout, clearTimeout,
    useIsFocused: () => focused, useState: value => { onState(value); return [value, onState]; },
    useEffect: effect => { cleanup = effect(); },
    getSocket: () => socket, getRoomSession: () => session,
    clearRoomSession: () => assert.fail('Focus changes must keep the private seat'),
    disconnectSocket: () => assert.fail('Focus changes must keep the shared socket'),
    showRoom: (route, result) => route.onShowRoom(result), Alert: { alert: message => assert.fail(message) },
  };
  return {
    render(value) { cleanup?.(); focused = value; Object.assign(context, globals); hook(navigation, leaving); },
    close() { cleanup?.(); },
  };
}

test('only the focused name editor resumes the shared real transport; blurred routes register no duplicate recovery', { timeout: 10000 }, async t => {
  let covered;
  let editor;
  t.after(() => { covered?.close(); editor?.close(); });
  const host = await bot(t);
  const entry = await ok(host, 'room:create', { nickname: '編集復帰検証' });
  const session = { code: entry.room.code, playerId: entry.player.id, token: entry.token };
  const calls = [];
  let resumes = 0;
  const count = socket => socket.use((packet, next) => { if (packet[0] === 'room:resume') resumes++; next(); });
  io.on('connection', count); t.after(() => io.off('connection', count));
  let returned;
  const done = new Promise(resolve => { returned = resolve; });
  covered = focusedRecovery(host.socket, session, { route: 'Lobby' }, { current: false }, () => calls.push('covered'));
  editor = focusedRecovery(host.socket, session, { route: 'NameEntry' }, { current: false }, (_, result) => { calls.push('editor'); returned(result); });
  covered.render(true); covered.render(false); editor.render(true);
  assert.equal(host.socket.listeners('connect').length, 1);
  const gone = once(host.socket, 'disconnect'); host.socket.io.engine.close(); await gone;
  host.socket.connect(); const restored = await done;
  assert.equal(resumes, 1); assert.deepEqual(calls, ['editor']);
  assert.equal(restored.player.id, entry.player.id);
  assert.equal(restored.room.code, entry.room.code);
});

test('returning to a covered route catches a reconnect and ignores the editor reply after cancel or leave', { timeout: 10000 }, async t => {
  let covered;
  let editor;
  t.after(() => { covered?.close(); editor?.close(); });
  const host = await bot(t);
  const entry = await ok(host, 'room:create', { nickname: '編集キャンセル検証' });
  const session = { code: entry.room.code, playerId: entry.player.id, token: entry.token };
  const calls = [];
  let held;
  let pending;
  const wait = new Promise(resolve => { pending = resolve; });
  const delay = socket => socket.use((packet, next) => {
    if (packet[0] === 'room:resume' && !held) { held = next; pending(); }
    else next();
  });
  io.on('connection', delay); t.after(() => { io.off('connection', delay); held?.(); });
  let returned;
  const done = new Promise(resolve => { returned = resolve; });
  covered = focusedRecovery(host.socket, session, { route: 'Game' }, { current: false }, (_, result) => { calls.push('covered'); returned(result); });
  const leaving = { current: false };
  editor = focusedRecovery(host.socket, session, { route: 'NameEntry' }, leaving, () => calls.push('editor'));
  covered.render(true); covered.render(false); editor.render(true);
  const gone = once(host.socket, 'disconnect'); host.socket.io.engine.close(); await gone;
  host.socket.connect(); await wait;
  editor.render(false); covered.render(true);
  const restored = await done; assert.equal(restored.player.id, entry.player.id);
  leaving.current = true; held();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['covered']);
  assert.equal(host.socket.connected, true);
});

test('a name editor mounted before resume ACK keeps controls pending on the already-connected transport', { timeout: 10000 }, async t => {
  let covered;
  let editor;
  t.after(() => { covered?.close(); editor?.close(); });
  const host = await bot(t);
  const entry = await ok(host, 'room:create', { nickname: '復帰待ち中の編集' });
  const session = { code: entry.room.code, playerId: entry.player.id, token: entry.token };
  const held = [];
  let pending;
  const waiting = new Promise(resolve => { pending = resolve; });
  const delay = socket => socket.use((packet, next) => {
    if (packet[0] === 'room:resume') { held.push(next); pending(); } else next();
  });
  io.on('connection', delay); t.after(() => { io.off('connection', delay); held.forEach(next => next()); });
  const calls = [];
  covered = focusedRecovery(host.socket, session, { route: 'Lobby' }, { current: false }, () => calls.push('covered'));
  covered.render(true);
  const gone = once(host.socket, 'disconnect'); host.socket.io.engine.close(); await gone;
  host.socket.connect(); await waiting;
  covered.render(false);
  let returned;
  const done = new Promise(resolve => { returned = resolve; });
  const editorStates = [];
  editor = focusedRecovery(host.socket, session, { route: 'NameEntry' }, { current: false }, (_, result) => { calls.push('editor'); returned(result); }, value => editorStates.push(value));
  editor.render(true);
  assert.equal(host.socket.connected, true);
  assert.equal(editorStates[0], true, 'Initial editor controls must wait for room authentication, even if transport is connected');
  assert.equal(editorStates.every(Boolean), true, 'Focusing the editor must not clear recovery before resume ACK');
  while (held.length < 2) await new Promise(resolve => setImmediate(resolve));
  const [oldResume, editorResume] = held.splice(0);
  editorResume();
  const restored = await done; assert.equal(restored.player.id, entry.player.id);
  assert.equal(editorStates.at(-1), false, 'Only the successful active resume ACK enables controls');
  oldResume(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['editor']);
});

test('authoritative recovery removes the covered editor route without changing ordinary entry navigation', () => {
  const source = readFileSync(join(__dirname, '../client/src/utils/roomSession.js'), 'utf8').replace(/export function /gu, 'function ');
  const { showRoom } = runInNewContext(`${source}\n({ showRoom });`, {});
  for (const covered of ['Lobby', 'Game']) {
    for (const target of ['NameEntry', 'Lobby', 'Game', 'Result']) {
      const result = { player: { id: 'same-seat', profile_ready: target !== 'NameEntry' }, room: { code: '123456', status: target === 'Result' ? 'finished' : 'waiting' },
        finalScores: [{ id: 'same-seat', score: 9 }], allPlayers: [], ...(target === 'Game' ? { gameData: { round: { id: 'latest-round' } } } : {}) };
      let restored;
      const navigation = { getState: () => ({ index: 2, routes: [{ name: 'Home', key: 'home' }, { name: covered, key: 'stale' }, { name: 'NameEntry', params: { editing: true } }] }),
        reset: state => { restored = state; }, replace: () => assert.fail('Editor recovery must remove the covered screen') };
      showRoom(navigation, result);
      assert.equal(restored.index, 1); assert.equal(JSON.stringify(restored.routes.map(r => r.name)), JSON.stringify(['Home', target]));
      assert.equal(restored.routes[0].key, 'home');
      assert.equal(restored.routes[1].params.player?.id || restored.routes[1].params.winner.id, 'same-seat');
    }
  }
  let replaced;
  showRoom({ getState: () => ({ index: 0, routes: [{ name: 'NameEntry', params: { editing: false } }] }),
    replace: (name, params) => { replaced = { name, params }; }, reset: () => assert.fail('Initial entry keeps its normal replace') },
    { player: { profile_ready: false }, room: { code: '123456' } });
  assert.equal(replaced.name, 'NameEntry');
});

test('failed start, introduction, reselection, profile and explicit leave preserve authoritative state', async (t) => {
  const { bots, room: entry } = await roomWith(t, 4);
  const room = rooms.get(entry.code);
  const fs = require('node:fs');
  const fail = () => t.mock.method(fs, 'renameSync', () => { throw new Error('private-storage-failure'); });
  fail();
  await denied(bots[0], 'game:start', { mode: 'player' });
  assert.equal(room.status, 'waiting');
  assert.equal(room.rounds.length, 0);
  t.mock.restoreAll();
  await ok(bots[0], 'game:start', { mode: 'player' });
  const round = room.rounds[0];
  const questioner = bots.find((b) => b.player.id === round.questioner_id);
  fail();
  await denied(questioner, 'round:submit_synopsis', { synopsis: '保存対象の紹介文', realTitle: '保存対象の答え' });
  assert.equal(room.rounds[0], round);
  assert.equal(round.synopsis, null);
  const oldName = room.players[0].nickname;
  await denied(bots[0], 'room:update_profile', { nickname: '未保存の変更', icon: '🐧' });
  assert.equal(room.players[0].nickname, oldName);
  await denied(bots[0], 'room:leave');
  assert.equal(room.players[0].is_connected, true);
  assert(room.players[0].resume_hash);
  t.mock.restoreAll();
  await ok(questioner, 'round:submit_synopsis', { synopsis: '保存対象の紹介文', realTitle: '保存対象の答え' });
  fail();
  await denied(questioner, 'round:reselect');
  assert.equal(round.synopsis, '保存対象の紹介文');
  t.mock.restoreAll();
});

test('password admission precedes profile entry; renaming preserves UUID declarations and private credentials', async (t) => {
  const host = await bot(t);
  const entry = await ok(host, 'room:create', { password: '鍵付きの部屋' });
  assert.equal(entry.player.profile_ready, false);
  assert.equal(entry.room.password_hash, undefined);
  const guest = await bot(t);
  await denied(guest, 'room:join', { code: entry.room.code, password: '違う鍵' });
  const joined = await ok(guest, 'room:join', { code: entry.room.code, password: '鍵付きの部屋' });
  assert.equal(joined.player.profile_ready, false);
  await ok(host, 'room:update_profile', { nickname: '名前を決めたホスト' });
  await denied(guest, 'room:update_profile', { nickname: '名前を決めたホスト' });
  await denied(guest, 'room:update_profile', { nickname: '   ' });
  await ok(guest, 'room:update_profile', { nickname: 'ゲスト' });
  await ok(host, 'room:set_computers', { count: 2 });
  await ok(host, 'game:start', { mode: 'cpu', totalRounds: 1 });
  const room = rooms.get(entry.room.code);
  const round = room.rounds[0];
  room.rounds[0].synopsis = '手動の検証用紹介';
  room.rounds[0].real_title = '正解';
  await ok(host, 'round:confirm_synopsis');
  await ok(guest, 'round:declare_known');
  await ok(guest, 'room:update_profile', { nickname: '変更後', icon: '🦊' });
  assert.equal(round.declarations.get(joined.player.id), 'known');
  const resumed = await ok(guest, 'room:resume', { code: entry.room.code, playerId: joined.player.id, token: joined.token });
  assert.equal(resumed.player.nickname, '変更後');
  assert.equal(resumed.player.icon, null);
  assert.deepEqual(resumed.gameData.resumeState.knownPlayerIds, [joined.player.id]);
  assert.deepEqual(resumed.gameData.resumeState.knownDeclarations, ['変更後']);
});

test('one human and one computer automatically use computer questions even if player mode is requested', async t => {
  writeBank();
  const { bots } = await roomWith(t, 1);
  const host = bots[0];
  await ok(host, 'room:set_computers', { count: 1 });
  await ok(host, 'game:start', { mode: 'player', totalRounds: 3 });
  const start = await event(host, 'game:started');
  assert.equal(start.mode, 'cpu');
  assert.equal(start.questioner, null);
  assert.equal(start.totalRounds, 3);
  await event(host, 'round:synopsis_fetched');
});

test('computer preview can recover from a failed search and fetch ten different works in one round', async t => {
  writeBank([]);
  const { bots, room } = await roomWith(t, 1);
  const host = bots[0];
  await ok(host, 'room:set_computers', { count: 1 });
  await ok(host, 'game:start', { mode: 'cpu', totalRounds: 3 });
  const start = await event(host, 'game:started');
  await event(host, 'round:synopsis_fetch_failed');
  writeBank(allFixtureQuestions);
  const seen = new Set();
  for (let index = 0; index < 10; index++) {
    await ok(host, 'round:reroll_synopsis');
    const preview = await event(host, 'round:synopsis_fetched');
    assert.equal(preview.roundId, start.round.id);
    const source = rooms.get(room.code).rounds[0].sourceQuestion;
    assert.equal(source.synopsis, preview.synopsis);
    assert.equal(seen.has(source.id), false);
    seen.add(source.id);
    const state = await ok(host, 'room:get_state');
    assert.equal(JSON.stringify(state.room).includes(source.realTitle), false);
    assert.equal(rooms.get(room.code).rounds[0].fetchError, null);
  }
  assert.equal(seen.size, 10);
  writeBank();
});

test('private question assistance recovers from failure and can be replaced ten times without sharing its answer', async t => {
  const { bots, room } = await roomWith(t, 2);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const start = await event(bots[0], 'game:started');
  const questioner = bots.find(b => b.player.id === start.questioner.id);
  const other = bots.find(b => b !== questioner);
  const payload = { roomId: room.id, roundId: start.round.id };
  writeBank([]);
  await denied(questioner, 'round:prepare_question', payload);
  writeBank(allFixtureQuestions);
  const seen = new Set();
  let latest;
  for (let index = 0; index < 10; index++) {
    latest = await ok(questioner, 'round:prepare_question', payload);
    assert.equal(seen.has(latest.questionId), false);
    seen.add(latest.questionId);
    const state = await ok(other, 'room:get_state');
    assert.equal(JSON.stringify(state.room).includes(latest.title), false);
    assert.equal(JSON.stringify(state.room).includes(latest.synopsis), false);
  }
  assert.equal(seen.size, 10);
  await ok(questioner, 'round:submit_synopsis', { synopsis: latest.synopsis, realTitle: latest.title, questionId: latest.questionId });
  writeBank();
});

test('resuming a seat during password admission cannot attach one socket to two rooms', async (t) => {
  for (const admission of ['room:create', 'room:join']) {
    const owner = await bot(t);
    const original = await ok(owner, 'room:create', { nickname: `元の席${admission}`.slice(0, 12) });
    const targetOwner = await bot(t);
    const target = await ok(targetOwner, 'room:create', { password: '照合を待つ鍵' });
    const returning = await bot(t);
    const serverSocket = io.sockets.sockets.get(returning.socket.id);
    let reply;
    // Run both real handlers in one turn to hold the async password boundary.
    const pending = serverSocket.listeners(admission)[0]({
      password: '照合を待つ鍵', code: target.room.code,
    }, (result) => { reply = result; });
    let resumed;
    await serverSocket.listeners('room:resume')[0]({ code: original.room.code,
      playerId: original.player.id, token: original.token }, (result) => { resumed = result; });
    assert.equal(resumed.ok, true);
    await pending;
    assert.equal(reply.ok, false);
    assert.match(reply.error, /すでにルーム/);
    assert.equal(serverSocket.data.roomCode, original.room.code);
    assert.equal(serverSocket.rooms.has(target.room.code), false);
    assert.equal(rooms.get(target.room.code).players.length, 1);
    assert.equal([...rooms.values()].flatMap((room) => room.players)
      .filter((player) => player.socket_id === serverSocket.id).length, 1);
  }
});

test('CPU snapshot failures produce a retry screen instead of an unhandled asynchronous error', async (t) => {
  const { bots } = await roomWith(t, 4);
  const delayed = delayNextQuestionSelection(t);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await delayed.started;
  t.mock.method(require('node:fs'), 'renameSync', () => { throw new Error('private-storage-path'); });
  delayed.release();
  const failure = await event(bots[0], 'round:synopsis_fetch_failed');
  assert.match(failure.error, /部屋を保存できません/);
  assert(!JSON.stringify(failure).includes('private-storage-path'));
  assert.equal(bots[0].events.some((e) => e.name === 'round:synopsis_fetched'), false);
});

test('only the questioner receives the real title and submitted titles; host chooses MVP after departure', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find((b) => b.player.id === started.questioner.id);
  const answerers = bots.filter((b) => b !== questioner);
  await ok(questioner, 'round:submit_synopsis', { synopsis: '手紙を探して旅をする紹介文。', realTitle: '出題者だけが知る本物' });
  const privateView = await event(questioner, 'round:questioner_view');
  assert.equal(privateView.realTitle, '出題者だけが知る本物');
  assert.deepEqual(privateView.answers, []);
  for (const b of answerers) await ok(b, 'round:declare_unknown');
  await ok(questioner, 'round:start_submitting');
  await event(questioner, 'round:questioner_view');
  await ok(answerers[0], 'round:submit_fake', { title: '出題者が見られる回答' });
  const submission = await event(questioner, 'round:questioner_view');
  assert.deepEqual(submission.answers.map((a) => a.title), ['出題者が見られる回答']);
  for (const b of answerers) {
    assert.equal(b.events.some((e) => e.name === 'round:questioner_view'), false);
    assert.ok(!JSON.stringify(b.events).includes('出題者だけが知る本物'));
    assert.ok(!JSON.stringify(await ok(b, 'room:get_state')).includes('出題者だけが知る本物'));
  }
  for (const [i, b] of answerers.slice(1).entries()) await ok(b, 'round:submit_fake', { title: `ほかの案${i}` });
  const { choices } = await event(questioner, 'round:choices_presented');
  const real = choices.find((c) => c.title === privateView.realTitle);
  for (const b of answerers) await ok(b, 'round:submit_vote', { answerId: real.id });
  await event(questioner, 'round:revealed');
  questioner.socket.disconnect();
  const departure = await event(answerers[0], 'game:questioner_disconnected');
  const host = answerers.find((b) => b.player.id === departure.fallbackHostId);
  const fake = choices.find((c) => c.id !== real.id);
  await denied(host, 'game:next_round');
  await denied(answerers.find((b) => b !== host), 'round:submit_mvp', { answerId: fake.id });
  await denied(host, 'round:submit_mvp', { answerId: real.id });
  await ok(host, 'round:submit_mvp', { answerId: fake.id });
  await denied(host, 'round:submit_mvp', { answerId: fake.id });
  await ok(host, 'game:next_round');
  assert.equal((await event(host, 'game:round_started')).currentRound, 2);
});

test('short transport loss delivers buffered former-round submission but cannot mutate the new round', async (t) => {
  const { bots, room } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'player' });
  const started = await event(bots[0], 'game:started');
  const questioner = bots.find(b => b.player.id === started.questioner.id);
  const answerers = bots.filter(b => b !== questioner);
  await ok(questioner, 'round:submit_synopsis', { synopsis: '断線中に進む検証作品', realTitle: '検証の正解' });
  for (const b of answerers) await ok(b, 'round:declare_unknown');
  await ok(questioner, 'round:start_submitting');
  const subject = answerers[0]; const state = rooms.get(room.code); const oldRound = state.rounds[0];
  const serverSocket = io.sockets.sockets.get(subject.socket.id);
  const lost = once(serverSocket, 'disconnect'); subject.socket.io.engine.close(); await lost;
  const buffered = new Promise((resolve, reject) => subject.socket.timeout(10000).emit('round:submit_fake',
    { roundId: oldRound.id, title: '旧画面からの送信待ちタイトル' }, (error, response) => error ? reject(error) : resolve(response)));
  assert.equal(subject.socket.sendBuffer.length, 1);
  // Model an authoritative next round while the old browser is offline. The
  // protocol under test is actual Socket.IO buffering/delivery, not UI mocking.
  const nextRound = structuredClone(oldRound); nextRound.id = require('node:crypto').randomUUID();
  nextRound.round_number = 2; nextRound.answers = nextRound.answers.filter(a => a.is_real); nextRound.votes = [];
  state.rounds.push(nextRound); state.current_round = 2;
  const returned = once(subject.socket, 'connect'); subject.socket.connect(); await returned;
  const response = await buffered;
  assert.equal(response.ok, false); assert.match(response.error, /古いラウンド/);
  assert.equal(nextRound.answers.some(a => a.title === '旧画面からの送信待ちタイトル'), false);
  assert.equal((await ack(subject, 'round:submit_fake', { roundId: nextRound.id, title: '新画面のタイトル' })).ok, true);
  assert.equal(nextRound.answers.filter(a => a.player_id === subject.player.id).length, 1);
});

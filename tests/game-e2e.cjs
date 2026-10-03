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
  const synopsis = `■■■のあらすじ識別${i + 1}。` +
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
const openResourceText = '公開資料の物語では、' +
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
].map(([kind, contentType], index) => {
  const realTitle = `ジャンル検証作品${index + 1}のお話`;
  const text = `${realTitle}について、` + '作品の内容と表現には作者の工夫が込められている。制作の背景や特徴を資料で確かめながら、作品に込められた思いとその表現を紹介する。'.repeat(3);
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
// Keep these socket-level tests independent from remote discovery. Dedicated
// question-service tests exercise on-demand collection with controlled sources.
process.env.QUESTION_COLLECTION_ENABLED = 'false';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const questionApi = require('../server/src/questions');
const originalQuestionSelection = questionApi.selectQuestionAsync;
let nextQuestionDeferral = null;
// Preserve the real selector and validator, but let selected socket tests hold
// one completion to reproduce a slow source collection deterministically.
questionApi.selectQuestionAsync = async (excludedIds) => {
  const deferral = nextQuestionDeferral;
  nextQuestionDeferral = null;
  let selected;
  let failure;
  try { selected = await originalQuestionSelection(excludedIds); }
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
  socket.onAny((name, data) => events.push({ name, data }));
  t.after(() => {
    socket.disconnect();
    for (const entry of events) {
      if (entry.name !== 'round:revealed') assertNoSources(entry.data);
    }
  });
  await once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
  return { socket, events };
}
function ack(b, event, payload = null) {
  return new Promise((resolve, reject) => b.socket.timeout(3000).emit(event, payload,
    (error, response) => {
      if (error) return reject(error);
      try {
        assertNoSources(response);
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
async function event(b, name) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const index = b.events.findIndex((e) => e.name === name);
    if (index !== -1) {
      const data = b.events.splice(index, 1)[0].data;
      if (name !== 'round:revealed') assertNoSources(data);
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Missing event: ${name}`);
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
  return { bots, room: created.room };
}

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
          await ok(host, 'round:confirm_synopsis');
          realTitle = selectedQuestion.realTitle;
          for (const b of bots) {
            const presented = await event(b, 'round:synopsis_presented');
            assertNoSources(presented);
            assert.ok(presented.synopsis.includes('■■■'));
            assert.ok(!presented.synopsis.includes(realTitle));
          }
        }
        const state = await ok(answerers[0], 'room:get_state');
        assertNoSources(state);
        assert.ok(!JSON.stringify(state).includes(realTitle));
        assert.equal(state.room.rounds, undefined);
        await denied(host, 'game:next_round');
        const duplicates = await Promise.all([ack(answerers[0], 'round:submit_fake', { title: '偽物0' }), ack(answerers[0], 'round:submit_fake', { title: '重複' })]);
        assert.equal(duplicates.filter((v) => v.ok).length, 1);
        await Promise.all(answerers.slice(1).map((b, i) => ok(b, 'round:submit_fake', { title: `偽物${i + 1}` })));
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

test('own choice IDs distinguish identical titles and self-votes remain rejected', async (t) => {
  const { bots } = await roomWith(t, 4);
  await ok(bots[0], 'game:start', { mode: 'cpu', totalRounds: 1 });
  await event(bots[0], 'round:synopsis_fetched');
  await ok(bots[0], 'round:confirm_synopsis');
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
    await ok(bots[0], 'round:confirm_synopsis');
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
    assert.equal(revealed.workKind, question.kind);
    assert.equal(revealed.workKindLabel, require('../server/src/questions/kinds').getKind(question.kind).label);
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
  await ok(bots[0], 'round:confirm_synopsis');
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
  await ok(bots[0], 'round:confirm_synopsis');
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
  await ok(bots[0], 'round:confirm_synopsis');
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
  await ok(bots[0], 'round:confirm_synopsis');
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
  await ok(bots[0], 'round:confirm_synopsis');
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
    const response = await fetch(`${url}/api/random-work`);
    assert.equal(response.ok, true);
    const work = await response.json();
    assert.deepEqual(Object.keys(work).sort(), ['contentType', 'ok', 'questionId', 'synopsis', 'title']);
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
  await ok(bots[1], 'round:confirm_synopsis');
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
  await ok(bots[1], 'round:confirm_synopsis');
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
  await ok(bots[0], 'round:confirm_synopsis');
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

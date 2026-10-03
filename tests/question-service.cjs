const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { createQuestionService } = require('../server/src/questions/service');

function question(number) {
  const realTitle = `収集作品${number}の物語`;
  const sourceText =
    '海辺に暮らす青年は、届いた手紙をきっかけに故郷を離れる。友人とともに旅を続け、街に隠された家族の秘密を知る。二人は住民たちと助け合いながら新たな道を探す。'.repeat(2);
  return {
    id: `service-work-${number}`, realTitle, aliases: [], kind: 'novel',
    synopsis: sourceText.replaceAll(realTitle, '■■■'),
    sources: [{
      label: `Wikipedia：${realTitle}`,
      url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(realTitle)}?oldid=${number + 100}`,
      revisionId: number + 100, retrievedAt: '2026-10-01T00:00:00.000Z',
      license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    }],
    generationMethod: 'extractive-v1',
    evidence: {
      sourceId: `wikipedia-ja-${number + 1000}-${number + 100}`, section: 'あらすじ',
      sourceTextSha256: createHash('sha256').update(sourceText).digest('hex'),
      excerpts: sourceText.match(/[^。]+。/gu),
    },
  };
}

function fixture(t, questions = []) {
  const directory = mkdtempSync(join(tmpdir(), 'title-question-service-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bankPath = join(directory, 'bank.json');
  const statePath = join(directory, 'collection-state.json');
  const seedPath = join(directory, 'seed.json');
  writeFileSync(bankPath, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-10-01T00:00:00Z', questions }));
  writeFileSync(seedPath, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-10-01T00:00:00Z', questions: [] }));
  const service = (options = {}) => {
    const instance = createQuestionService({
      bankPath, statePath, seedPath, enabled: true, minimumAvailable: 1,
      ...options,
    });
    t.after(() => instance.stop());
    return instance;
  };
  return { bankPath, statePath, seedPath, service };
}

function collected(questions, state = {}) {
  return { questions, state, added: questions, rejected: [], discovered: questions.length, requests: 1, exhausted: false };
}

test('a populated store selects an unused verified question without requesting remote sources', async (t) => {
  const saved = [question(1), question(2), question(3)];
  const files = fixture(t, saved);
  let calls = 0;
  const service = files.service({ collectImpl: async () => { calls++; throw new Error('Unexpected source request'); } });
  const selected = await service.selectQuestion([saved[0].id]);
  assert.ok(saved.slice(1).some((entry) => entry.id === selected.id));
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, saved);
});

test('an empty store discovers, saves and serves new works with its resumable discovery state', async (t) => {
  const files = fixture(t);
  const discovered = question(4);
  let calls = 0;
  const service = files.service({ collectImpl: async ({ questions, state }) => {
    calls++;
    assert.deepEqual(questions, []);
    assert.ok(state && typeof state === 'object');
    return collected([discovered], { providerCursor: 'next-page' });
  } });
  assert.deepEqual(await service.selectQuestion(), discovered);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [discovered]);
  assert.ok(existsSync(files.statePath), 'Discovery state was not persisted');
  assert.match(readFileSync(files.statePath, 'utf8'), /next-page/);
  assert.deepEqual(await service.selectQuestion(), discovered);
  assert.equal(calls, 1);
});

test('famous initial seed questions trigger discovery and become a fallback once new work is verified', async (t) => {
  const initial = question(20);
  const discovered = question(21);
  const files = fixture(t, [initial]);
  writeFileSync(files.seedPath, JSON.stringify({ schemaVersion: 1, questions: [initial] }));
  let calls = 0;
  const service = files.service({ collectImpl: async () => { calls++; return collected([initial, discovered]); } });
  assert.equal((await service.selectQuestion()).id, discovered.id);
  assert.equal(calls, 1);
  for (let i=0; i<10; i++) assert.equal((await service.selectQuestion()).id, discovered.id);
  assert.equal((await service.selectQuestion([discovered.id])).id,initial.id);
});

test('when seed discovery is unavailable the initial questions remain playable', async (t) => {
  const initial = question(22);
  const files = fixture(t, [initial]);
  writeFileSync(files.seedPath, JSON.stringify({ schemaVersion: 1, questions: [initial] }));
  const service = files.service({ collectImpl: async () => { throw new Error('Search unavailable'); } });
  assert.equal((await service.selectQuestion()).id,initial.id);
});

test('explicitly disabled collection performs no network work for empty or exhausted stores', async (t) => {
  const saved = question(5);
  const files = fixture(t, [saved]);
  let calls = 0;
  const service = files.service({ enabled: false, collectImpl: async () => { calls++; return collected([question(6)]); } });
  const initialStatus = service.getStatus();
  assert.deepEqual(initialStatus, {
    enabled: false, running: false, scheduled: false,
    lastStartedAt: null, lastCompletedAt: null, lastSuccessfulAt: null,
    nextScheduledAt: null, intervalMilliseconds: 3_600_000, failure: null,
  });
  service.start();
  assert.deepEqual(await service.selectQuestion(), saved);
  await assert.rejects(service.selectQuestion([saved.id]));
  await service.collectNow();
  assert.equal(calls, 0);
  assert.deepEqual(service.getStatus(), initialStatus);
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [saved]);
});

test('simultaneous empty-store requests share collection and apply each room exclusion independently', async (t) => {
  const files = fixture(t);
  const first = question(7);
  const second = question(8);
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = files.service({ collectImpl: async () => { calls++; await gate; return collected([first, second]); } });
  const firstRoom = service.selectQuestion([first.id]);
  const secondRoom = service.selectQuestion([second.id]);
  // Give both asynchronous readers time to join the same collection task.
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const selections = await Promise.all([firstRoom, secondRoom]);
  assert.deepEqual(selections, [second, first]);
  assert.equal(calls, 1, 'Each waiting room triggered its own collection');
  assert.equal(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions.length, 2);
});

test('room exhaustion collects another work and preserves the previously verified bank', async (t) => {
  const previous = question(9);
  const next = question(10);
  const files = fixture(t, [previous]);
  let calls = 0;
  const service = files.service({ collectImpl: async ({ questions }) => {
    calls++;
    assert.deepEqual(questions, [previous]);
    return collected([...questions, next], { providerCursor: 'continued' });
  } });
  assert.deepEqual(await service.selectQuestion([previous.id]), next);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [previous, next]);
});

test('a source failure keeps the stored works and cooldown prevents repeated failing requests', async (t) => {
  const previous = question(11);
  const next = question(12);
  const files = fixture(t, [previous]);
  let clock = 1_000;
  let calls = 0;
  const service = files.service({ now: () => clock, cooldownMilliseconds: 1_000, collectImpl: async ({ questions }) => {
    calls++;
    if (calls === 1) throw new Error('Source temporarily unavailable');
    return collected([...questions, next]);
  } });
  await assert.rejects(service.selectQuestion([previous.id]));
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [previous]);
  await assert.rejects(service.selectQuestion([previous.id]));
  assert.equal(calls, 1);
  assert.deepEqual(await service.selectQuestion(), previous);
  clock += 1_001;
  assert.deepEqual(await service.selectQuestion([previous.id]), next);
  assert.equal(calls, 2);
});

test('a low populated store serves immediately while one background refill is pending', async (t) => {
  const previous = question(13);
  const next = question(14);
  const files = fixture(t, [previous]);
  let calls = 0;
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const service = files.service({ minimumAvailable: 2, collectImpl: async ({ questions }) => {
    calls++;
    markStarted();
    await gate;
    return collected([...questions, next]);
  } });
  assert.deepEqual(await service.selectQuestion(), previous);
  await started;
  assert.deepEqual(await service.selectQuestion(), previous);
  assert.equal(calls, 1);
  const pending = service.collectNow();
  release();
  await pending;
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [previous, next]);
});

test('collection timeout aborts waiting requests and ignores a late remote result', async (t) => {
  const files = fixture(t);
  let signal;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = files.service({ collectionTimeoutMilliseconds: 10, collectImpl: async (options) => {
    signal = options.signal;
    await gate; // Model an upstream implementation that fails to obey abort.
    return collected([question(15)]);
  } });
  await assert.rejects(service.selectQuestion());
  assert.equal(signal.aborted, true);
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.failure.code, 'timed_out');
  assert.equal(status.failure.at, status.lastCompletedAt);
  assert.equal(status.lastSuccessfulAt, null);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, []);
});

test('stopping collection aborts a pending request without saving its late result', async (t) => {
  const files = fixture(t);
  let signal;
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const service = files.service({ collectImpl: async (options) => {
    signal = options.signal;
    markStarted();
    await gate;
    return collected([question(16)]);
  } });
  const selection = service.selectQuestion();
  await started;
  service.stop();
  await assert.rejects(selection);
  assert.equal(signal.aborted, true);
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.scheduled, false);
  assert.equal(status.nextScheduledAt, null);
  assert.equal(status.failure.code, 'cancelled');
  assert.equal(status.lastSuccessfulAt, null);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, []);
});

test('invalid new collector output is rejected without replacing previously verified works', async (t) => {
  const previous = question(17);
  const unsupported = { ...question(18), kind: 'island' };
  const files = fixture(t, [previous]);
  const service = files.service({ collectImpl: async ({ questions }) => collected([...questions, unsupported]) });
  await assert.rejects(service.selectQuestion([previous.id]));
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [previous]);
  assert.deepEqual(await service.selectQuestion(), previous);
});

test('a source-aware timeout saves completed works and the checkpoint returned during its abort grace', async (t) => {
  const files = fixture(t);
  const completed = question(19);
  let signal;
  const service = files.service({ collectionTimeoutMilliseconds: 10, collectImpl: async (options) => {
    signal = options.signal;
    await new Promise((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    return collected([completed], { providerCursor: 'partial-batch-checkpoint' });
  } });
  assert.deepEqual(await service.selectQuestion(), completed);
  assert.equal(signal.aborted, true);
  const status = service.getStatus();
  assert.equal(status.failure.code, 'timed_out');
  assert.equal(status.lastSuccessfulAt, status.lastCompletedAt);
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [completed]);
  assert.match(readFileSync(files.statePath, 'utf8'), /partial-batch-checkpoint/);
});

test('starting the service automatically collects subsequent batches and stopping ends the schedule', { timeout: 3_000 }, async (t) => {
  const files = fixture(t);
  const first = question(20);
  const second = question(21);
  let calls = 0;
  const intervalMilliseconds = 80;
  const service = files.service({ intervalMilliseconds, collectImpl: async ({ questions, state }) => {
    calls++;
    if (calls === 1) {
      assert.deepEqual(questions, []);
      assert.equal(state.providerCursor, undefined);
      return collected([first], { providerCursor: 1 });
    }
    assert.equal(calls, 2, 'A scheduled collection ran after the service stopped');
    assert.deepEqual(questions, [first], 'Later batches did not retain the previously collected work');
    assert.equal(state.providerCursor, 1, 'Later batches did not resume the stored discovery position');
    return collected([...questions, second], { providerCursor: 2 });
  } });
  // Start alone must supply both batches; this test makes no selection or
  // manual collection request.
  service.start();
  const firstScheduledAt = service.getStatus().nextScheduledAt;
  assert.equal(service.getStatus().scheduled, true);
  assert.ok(Number.isFinite(Date.parse(firstScheduledAt)));
  const deadline = Date.now() + 2_000;
  let persistedState;
  while (Date.now() < deadline) {
    if (existsSync(files.statePath)) persistedState = JSON.parse(readFileSync(files.statePath, 'utf8'));
    if (persistedState?.providerCursor === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(Date.parse(service.getStatus().nextScheduledAt) > Date.parse(firstScheduledAt));
  service.stop();
  assert.equal(persistedState?.providerCursor, 2, 'Automatic collection did not persist its next batch');
  assert.equal(service.getStatus().scheduled, false);
  assert.equal(service.getStatus().nextScheduledAt, null);
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(readFileSync(files.bankPath, 'utf8')).questions, [first, second]);
  await new Promise((resolve) => setTimeout(resolve, intervalMilliseconds * 2 + 10));
  assert.equal(calls, 2, 'Stopping the service left its periodic collection running');
  assert.deepEqual(JSON.parse(readFileSync(files.statePath, 'utf8')), { providerCursor: 2 });
});

test('collection status records the scheduled start, saved completion and next due time without question data', async (t) => {
  const files = fixture(t);
  const saved = question(22);
  let clock = Date.parse('2026-10-01T00:00:00.000Z');
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  t.after(() => release());
  const service = files.service({ now: () => clock, collectImpl: async () => {
    markStarted();
    await gate;
    return collected([saved]);
  } });
  assert.equal(service.getStatus().lastStartedAt, null);
  service.start();
  await started;
  assert.deepEqual(service.getStatus(), {
    enabled: true, running: true, scheduled: true,
    lastStartedAt: '2026-10-01T00:00:00.000Z', lastCompletedAt: null, lastSuccessfulAt: null,
    nextScheduledAt: '2026-10-01T01:00:00.000Z', intervalMilliseconds: 3_600_000, failure: null,
  });
  const pending = service.collectNow();
  clock += 2_000;
  release();
  await pending;
  const completed = service.getStatus();
  assert.equal(completed.running, false);
  assert.equal(completed.scheduled, true);
  assert.equal(completed.lastCompletedAt, '2026-10-01T00:00:02.000Z');
  assert.equal(completed.lastSuccessfulAt, completed.lastCompletedAt);
  assert.equal(completed.failure, null);
  assert.ok(!JSON.stringify(completed).includes(saved.realTitle));
  assert.ok(!JSON.stringify(completed).includes(saved.sources[0].url));
  service.stop();
  assert.equal(service.getStatus().nextScheduledAt, null);
  assert.equal(service.getStatus().scheduled, false);
  assert.equal(service.getStatus().failure, null);
});

test('failure status sanitizes source errors and preserves the last successful collection time', async (t) => {
  const files = fixture(t);
  const saved = question(23);
  const privateError = '秘密の作品名 https://source.example/private-title raw-text';
  let clock = Date.parse('2026-10-01T00:00:00.000Z');
  let calls = 0;
  const service = files.service({ now: () => clock, cooldownMilliseconds: 0, collectImpl: async () => {
    calls++;
    clock += 25;
    if (calls === 2) return { ...collected([]), error: privateError };
    if (calls === 3) return collected([saved]);
    throw new Error(privateError);
  } });
  await service.collectNow();
  const failed = service.getStatus();
  assert.equal(failed.running, false);
  assert.equal(failed.failure.code, 'failed');
  assert.equal(failed.failure.at, failed.lastCompletedAt);
  assert.equal(failed.lastSuccessfulAt, null);
  assert.ok(Date.parse(failed.lastCompletedAt) > Date.parse(failed.lastStartedAt));
  clock += 100;
  await service.collectNow();
  const noWork = service.getStatus();
  assert.equal(noWork.failure.code, 'no_new_work');
  assert.equal(noWork.lastSuccessfulAt, null);
  clock += 100;
  await service.collectNow();
  const successful = service.getStatus();
  assert.equal(successful.failure, null);
  assert.equal(successful.lastSuccessfulAt, successful.lastCompletedAt);
  clock += 100;
  await service.collectNow();
  const laterFailure = service.getStatus();
  assert.equal(laterFailure.failure.code, 'failed');
  assert.equal(laterFailure.lastSuccessfulAt, successful.lastSuccessfulAt);
  for (const status of [failed, noWork, successful, laterFailure]) {
    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes(privateError));
    assert.ok(!serialized.includes('秘密の作品名'));
    assert.ok(!serialized.includes('https://'));
    assert.ok(!serialized.includes(saved.realTitle));
  }
});

function withVisibility(q, input) {
  const {visibilityEvidence} = require('../server/src/questions/selection-policy');
  return {...q,evidence:{...q.evidence,visibility:visibilityEvidence({title:q.realTitle,aliases:q.aliases,
    kind:q.kind,sourceUrl:q.sources[0].url,...input})}};
}

test('source-backed small works outrank unknown and widely promoted works across domains',async(t)=>{
  const unknown=question(40);
  const small=withVisibility(question(41),{introductions:['本作は自主出版の小説として制作された作品である。']});
  const wide=withVisibility(question(42),{introductions:['原作シリーズの累計発行部数は1,000万部を超えている。']});
  const files=fixture(t,[unknown,small,wide]);const service=files.service({enabled:false});
  for(let i=0;i<10;i++)assert.equal((await service.selectQuestion()).id,small.id);
  assert.equal((await service.selectQuestion([small.id])).id,unknown.id);
  assert.equal((await service.selectQuestion([small.id,unknown.id])).id,wide.id);
  await assert.rejects(service.selectQuestion([small.id,unknown.id,wide.id]));
  assert.equal(JSON.parse(readFileSync(files.bankPath)).questions.length,3);
});

test('a seed re-collected under a different source ID remains a fallback and triggers discovery',async(t)=>{
  const seed=question(43),copy={...seed,id:'different-source-id'};
  const unknown=question(44);const files=fixture(t,[copy]);
  writeFileSync(files.seedPath,JSON.stringify({schemaVersion:1,questions:[seed]}));
  let calls=0;const service=files.service({collectImpl:async()=>{calls++;return collected([copy,unknown]);}});
  assert.equal((await service.selectQuestion()).id,unknown.id);assert.equal(calls,1);
  assert.equal((await service.selectQuestion([unknown.id])).id,copy.id);
});

test('few reviews, minor search wording, missing Wikipedia and a character making indie games do not prove low visibility',()=>{
  const {createSelectionPolicy}=require('../server/src/questions/selection-policy');const policy=createSelectionPolicy();
  for(const input of [{reviewCount:1},{reviewCount:999},{introductions:['少年は趣味で同人漫画を制作している。']},
    {introductions:['本作はインディーゲームではありません。']}])assert.equal(policy.tier(withVisibility(question(45),input)),1);
  assert.equal(policy.tier({...question(45),discovery:{angle:'インディー'},popularity:{score:0}}),1);
});

test('large sales and structured review counts override indie labels; invalid preference evidence is ignored',()=>{
  const {createSelectionPolicy}=require('../server/src/questions/selection-policy');const policy=createSelectionPolicy();
  const small=withVisibility(question(46),{genres:['インディー']});assert.equal(policy.tier(small),0);
  for(const input of [{genres:['インディー'],reviewCount:'1,000'},
    {genres:['インディー'],introductions:['累計販売本数100万本を突破した。']},
    {introductions:['本作は世界的な人気を集めた作品である。']}])assert.equal(policy.tier(withVisibility(question(46),input)),2);
  const visibility=small.evidence.visibility;
  for(const changed of [{version:99},{sourceUrl:'https://other.example.org/'},{workTitle:'他の作品'},{kind:'game'},
    {sha256:'a'.repeat(64)},{signals:[{type:'genre',excerpt:'これは普通の作品'}]}]){
    assert.equal(policy.tier({...small,evidence:{...small.evidence,visibility:{...visibility,...changed}}}),1);
  }
});

test('both sync gameplay selection and service use the shared preference policy',async(t)=>{
  const {spawnSync}=require('node:child_process');
  const small=withVisibility(question(47),{genres:['自主出版']});
  const unknown=question(48),files=fixture(t,[unknown,small]);
  const api=join(__dirname,'../server/src/questions/index.js');
  const program=`const api=require(${JSON.stringify(api)}); Promise.all([api.selectQuestion(),api.selectQuestionAsync()]).then(q=>console.log(JSON.stringify(q.map(x=>x.id))));`;
  const child=spawnSync(process.execPath,['-e',program],{encoding:'utf8',env:{...process.env,QUESTION_COLLECTION_ENABLED:'false',QUESTION_BANK_PATH:files.bankPath}});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),[small.id,small.id]);
  assert.equal((await files.service({enabled:false}).selectQuestion()).id,small.id);
});

test('low small-work stock refills in the background without stalling the preferred choice',async(t)=>{
  const small=withVisibility(question(49),{genres:['自主出版']});const files=fixture(t,[small,question(50),question(51)]);
  let release;const gate=new Promise(r=>{release=r;});let started;const begun=new Promise(r=>{started=r;});
  const service=files.service({minimumAvailable:2,collectImpl:async({questions})=>{started();await gate;return collected(questions);}});
  assert.equal((await service.selectQuestion()).id,small.id);await begun;
  assert.equal((await service.selectQuestion()).id,small.id);
  const pending=service.collectNow();release();await pending;
});

test('saved source excerpts can supply small-work evidence without changing the stored record',async(t)=>{
  const old=question(52),text='本作は自主出版の小説として刊行された作品である。'+old.synopsis;
  old.synopsis=text;old.evidence={...old.evidence,excerpts:text.match(/[^。]+。/gu),sourceTextSha256:createHash('sha256').update(text).digest('hex')};
  const files=fixture(t,[question(53),old]);const before=readFileSync(files.bankPath,'utf8');
  assert.equal((await files.service({enabled:false}).selectQuestion()).id,old.id);
  assert.equal(readFileSync(files.bankPath,'utf8'),before);
});

test('source production credits identify a small independent film but fictional characters do not',()=>{
  const {createSelectionPolicy}=require('../server/src/questions/selection-policy');const policy=createSelectionPolicy();
  const q={...question(54),kind:'film'};
  const credit='監督が企画・脚本・監督を務め、着想から10年の歳月を経て自主制作で完成させたヒューマンドラマ。';
  assert.equal(policy.tier(withVisibility(q,{introductions:[credit]})),0);
  assert.equal(policy.tier(withVisibility(q,{introductions:['本作の主人公は自主制作で完成させた映画を持って旅に出る。']})),1);
});

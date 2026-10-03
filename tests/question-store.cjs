const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readStore, saveStore, withStoreLock } = require('../server/src/questions/store');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'title-question-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const paths = { bankPath: join(directory, 'bank.json'), statePath: join(directory, 'state.json') };
  writeFileSync(paths.bankPath, JSON.stringify({ schemaVersion: 1, questions: [] }));
  writeFileSync(paths.statePath, JSON.stringify({ cursor: 0 }));
  return { ...paths, directory };
}

function question(number, revision = 100) {
  return {
    id: `store-question-${number}`, realTitle: `保存作品${number}`,
    sources: [{ url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(`保存作品${number}`)}?oldid=${revision}` }],
    synopsis: `保存用の問題${number}、版${revision}`,
  };
}

test('simultaneous independent saves retain works from both collectors', async (t) => {
  const paths = fixture(t);
  const first = question(1);
  const second = question(2);
  await Promise.all([
    saveStore(paths, { questions: [first], state: { cursor: 1 } }),
    saveStore(paths, { questions: [second], state: { cursor: 2 } }),
  ]);
  const saved = await readStore(paths);
  assert.deepEqual(new Set(saved.questions.map((entry) => entry.id)), new Set([first.id, second.id]));
  assert.equal(saved.questions.length, 2);
  assert.equal(JSON.parse(readFileSync(paths.bankPath, 'utf8')).schemaVersion, 1);
  assert.equal(readdirSync(paths.directory).some((name) => name.endsWith('.tmp')), false);
});

test('web work pages distinguished by query IDs survive saving and later appends', async (t) => {
  const paths = fixture(t);
  const first = { ...question(30), sources: [{ provider: 'web', url: 'https://shop.example.org/detail?id=1' }] };
  const second = { ...question(31), sources: [{ provider: 'web', url: 'https://shop.example.org/detail?id=2' }] };
  await saveStore(paths, { questions: [first, second], state: {} });
  assert.equal((await readStore(paths)).questions.length,2);
  await saveStore(paths, { questions: [{ ...first, synopsis: '更新した紹介文' }], state: {} });
  const saved = await readStore(paths);
  assert.equal(saved.questions.length,2);
  assert.equal(saved.questions.find((q)=>q.id===first.id).synopsis,'更新した紹介文');
});

test('serialized discovery transactions read the latest checkpoint before appending new works', async (t) => {
  const paths = fixture(t);
  let release;
  let markFirstStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  let active = 0;
  let maximumActive = 0;
  const transaction = (number) => withStoreLock(paths, async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      const stored = await readStore(paths);
      if (number === 1) {
        markFirstStarted();
        await gate;
        assert.equal(stored.state.cursor, 0);
      } else {
        assert.equal(stored.state.cursor, 1, 'Second collector read an old discovery cursor');
        assert.deepEqual(stored.questions.map((entry) => entry.id), ['store-question-3']);
      }
      return await saveStore(paths, {
        questions: [...stored.questions, question(number + 2)],
        state: { cursor: stored.state.cursor + 1 },
      }, { lockHeld: true });
    } finally { active--; }
  });
  const first = transaction(1);
  await firstStarted;
  const second = transaction(2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 1);
  release();
  await Promise.all([first, second]);
  const saved = await readStore(paths);
  assert.equal(maximumActive, 1);
  assert.equal(saved.state.cursor, 2);
  assert.deepEqual(new Set(saved.questions.map((entry) => entry.id)), new Set(['store-question-3', 'store-question-4']));
});

test('a failed collection transaction releases its lock and leaves its checkpoint unchanged', async (t) => {
  const paths = fixture(t);
  await assert.rejects(withStoreLock(paths, async () => {
    const stored = await readStore(paths);
    assert.deepEqual(stored, { questions: [], state: { cursor: 0 } });
    throw new Error('Source fetch failed before saving');
  }), /Source fetch failed/);
  assert.deepEqual(await readStore(paths), { questions: [], state: { cursor: 0 } });
  await saveStore(paths, { questions: [question(5)], state: { cursor: 1 } });
  assert.equal((await readStore(paths)).questions[0].id, 'store-question-5');
});

test('saving a newer revision replaces that source while retaining other works', async (t) => {
  const paths = fixture(t);
  const previous = question(6, 100);
  const unrelated = question(7);
  const updated = question(6, 101);
  await saveStore(paths, { questions: [previous, unrelated], state: { cursor: 1 } });
  await saveStore(paths, { questions: [updated], state: { cursor: 2 } });
  const saved = await readStore(paths);
  assert.equal(saved.questions.length, 2);
  assert.deepEqual(saved.questions.find((entry) => entry.id === updated.id), updated);
  assert.deepEqual(saved.questions.find((entry) => entry.id === unrelated.id), unrelated);
});

test('a lock left by an absent process is recovered before saving verified works', async (t) => {
  const paths = fixture(t);
  const absentPid = 2_147_483_647;
  assert.throws(() => process.kill(absentPid, 0), (error) => error.code === 'ESRCH');
  writeFileSync(`${paths.bankPath}.collection.lock`, JSON.stringify({
    pid: absentPid, token: 'previous-collector', createdAt: '2020-01-01T00:00:00.000Z',
  }));
  await saveStore(paths, { questions: [question(8)], state: { cursor: 1 } });
  assert.equal((await readStore(paths)).questions[0].id, 'store-question-8');
  assert.equal(readdirSync(paths.directory).some((name) => name.endsWith('.collection.lock')), false);
});

test('aborting a waiting collector leaves the active writer and its lock intact', async (t) => {
  const paths = fixture(t);
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  t.after(() => release());
  const active = withStoreLock(paths, async () => { markStarted(); await gate; });
  await started;
  const before = readFileSync(`${paths.bankPath}.collection.lock`, 'utf8');
  const controller = new AbortController();
  let entered = false;
  const waiting = withStoreLock(paths, async () => { entered = true; }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(waiting, (error) => error.name === 'AbortError');
  assert.equal(entered, false);
  assert.equal(readFileSync(`${paths.bankPath}.collection.lock`, 'utf8'), before);
  release();
  await active;
  assert.deepEqual(await readStore(paths), { questions: [], state: { cursor: 0 } });
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectQuestions, identityKeys, DEFAULT_PROVIDERS, curlResponse } = require('../server/src/questions/collector');
const { parseArgs } = require('../server/scripts/generate-questions.cjs');

function candidate(number, provider = 'wikipedia') {
  return { id: provider === 'wikipedia' ? `wiki-ja-${number}` : `aozora-${number}`,
    provider, title: `新しい作品${number}`, kind: 'novel', aliases: [],
    ...(provider === 'wikipedia' ? { discovery: { pageId: number } } : { workId: number }) };
}
function question(entry) {
  return { ...entry, realTitle: entry.realTitle || entry.title, synopsis: `あらすじ${entry.id}`,
    evidence: { sourceId: entry.provider === 'aozora' ? `aozora-${entry.workId}`
      : `wikipedia-ja-${entry.discovery?.pageId || entry.workId}-99` },
    sources: [{ url: entry.provider === 'aozora' ? `https://www.aozora.gr.jp/cards/000879/card${entry.workId}.html`
      : `https://ja.wikipedia.org/wiki/${encodeURIComponent(entry.title)}?oldid=99` }] };
}
function ndlCandidate(recordId, overrides = {}) {
  return { id: `ndl-${recordId.toLowerCase()}`, provider: 'ndl', title: '同じ題名',
    realTitle: '同じ題名', aliases: [], kind: 'manga',
    ndl: { recordId, url: `https://ndlsearch.ndl.go.jp/books/${recordId}` }, ...overrides };
}
function discoveryOf(entries) {
  return async ({ state, limit }) => {
    const cursor = state.cursor || 0;
    const candidates = entries.slice(cursor, cursor + limit);
    return { candidates, state: { cursor: cursor + candidates.length },
      exhausted: cursor + candidates.length >= entries.length, requests: 0, errors: [] };
  };
}
function generatedWithFetch() {
  return async (entry, { fetchImpl }) => {
    await fetchImpl('https://ja.wikipedia.org/w/api.php');
    return question(entry);
  };
}
const options = { throttleMilliseconds: 0, fetchImpl: async () => Response.json({}),
  generateImpl: generatedWithFetch() };

test('online collection appends beyond the seed size and resumes buffered candidates across batches', async () => {
  const initial = Array.from({ length: 25 }, (_, index) => question(candidate(index + 1)));
  const discovery = discoveryOf(Array.from({ length: 12 }, (_, index) => candidate(index + 100)));
  let result = await collectQuestions({ ...options, questions: initial, limit: 3,
    maxRequests: 20, discoverImpl: discovery });
  assert.equal(result.questions.length, 28);
  assert.equal(result.added.length, 3);
  for (let index = 0; index < 3; index++) {
    result = await collectQuestions({ ...options, questions: result.questions, state: result.state,
      limit: 3, maxRequests: 20, discoverImpl: discovery });
  }
  assert.equal(result.questions.length, 37);
  assert.deepEqual(result.questions.slice(0, 25), initial);
  assert.equal(new Set(result.questions.map((q) => q.id)).size, 37);
});

test('one batch enforces the shared network budget and saves unprocessed discoveries', async () => {
  const result = await collectQuestions({ ...options, limit: 5, maxRequests: 3,
    discoverImpl: async ({ fetchImpl }) => {
      await fetchImpl('https://ja.wikipedia.org/w/api.php');
      return { candidates: [candidate(101), candidate(102), candidate(103)], state: { cursor: 3 },
        requests: 1, exhausted: true };
    } });
  assert.equal(result.requests, 3);
  assert.equal(result.added.length, 2);
  assert.equal(result.state.providers.wikipedia.cursor, 3);
  assert.equal(result.state.collector.pendingCandidates[0].id, 'wiki-ja-103');
  const next = await collectQuestions({ ...options, questions: result.questions, state: result.state,
    limit: 1, maxRequests: 2, discoverImpl: discoveryOf([]) });
  assert.equal(next.added[0].id, 'wiki-ja-103');
});

test('temporary source failures preserve bank and candidate through repeated later retries', async () => {
  const seed = question(candidate(1));
  let state = {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await collectQuestions({ ...options, questions: [seed], state, limit: 2, maxRequests: 6,
      discoverImpl: discoveryOf([candidate(100)]),
      generateImpl: async () => { throw new Error('出典を取得できませんでした (503)'); } });
    assert.deepEqual(result.questions, [seed]);
    assert.equal(result.added.length, 0);
    assert.equal(result.state.collector.pendingCandidates.length, 1);
    assert.equal(result.state.collector.pendingCandidates[0].id, 'wiki-ja-100');
    state = result.state;
  }
  const recovered = await collectQuestions({ ...options, questions: [seed], state, limit: 1,
    maxRequests: 3, discoverImpl: discoveryOf([]) });
  assert.equal(recovered.added[0].id, 'wiki-ja-100');
});

test('invalid story/type is skipped while later verified works can be appended', async () => {
  const result = await collectQuestions({ ...options, limit: 2, maxRequests: 10,
    discoverImpl: discoveryOf([candidate(100), candidate(101)]),
    generateImpl: async (entry) => {
      if (entry.id === 'wiki-ja-100') throw new Error('十分な長さのあらすじ・ストーリー節がありません');
      return question(entry);
    } });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'wiki-ja-101');
  assert.equal(result.state.collector.pendingCandidates.length, 0);
  assert.equal(result.rejected[0].id, 'wiki-ja-100');
});

test('rejecting an article as a novel does not suppress its later valid film classification', async () => {
  const result = await collectQuestions({ ...options, limit: 2, maxRequests: 10,
    discoverImpl: discoveryOf([candidate(100), { ...candidate(100), kind: 'film' }]),
    generateImpl: async (entry) => {
      if (entry.kind === 'novel') throw new Error('記事を登録した作品種別として確認できません');
      return question(entry);
    } });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].kind, 'film');
  assert.equal(result.state.collector.pendingCandidates.length, 0);
});

test('a one-request bootstrap saves discovered candidates for the next bounded batch', async () => {
  const result = await collectQuestions({ ...options, limit: 1, maxRequests: 1,
    discoverImpl: async ({ fetchImpl }) => {
      await fetchImpl('https://ja.wikipedia.org/w/api.php');
      return { candidates: [candidate(100)], state: { cursor: 1 }, requests: 1, exhausted: true };
    } });
  assert.equal(result.requests, 1);
  assert.equal(result.added.length, 0);
  assert.equal(result.state.collector.pendingCandidates[0].id, 'wiki-ja-100');
});

test('dedup uses source page identity while retaining distinct verified works with similar titles', async () => {
  const original = question(candidate(100));
  const result = await collectQuestions({ ...options, questions: [original], limit: 3, maxRequests: 10,
    discoverImpl: discoveryOf([
      { ...candidate(100), id: 'alternative-id' },
      { ...candidate(101), title: '新しい作品１００ (小説)' }, candidate(102),
    ]) });
  assert.equal(result.added.length, 2);
  assert.deepEqual(result.added.map(q => q.id), ['wiki-ja-101', 'wiki-ja-102']);
  assert.ok(identityKeys(candidate(999, 'aozora')).includes('aozora:999'));
});

test('same-title works in distinct genres or by distinct authors survive old title-only checkpoint keys', async () => {
  const first = question({ ...candidate(100), title: '春 (小説)', realTitle: '春' });
  const entries = [
    { ...candidate(101), title: '春 (楽曲)', realTitle: '春', kind: 'music-work' },
    { ...candidate(102), title: '春 (絵画)', realTitle: '春', kind: 'visual-art' },
    { ...candidate(103, 'aozora'), title: '春', realTitle: '春' },
  ];
  const result = await collectQuestions({ ...options, questions: [first],
    state: { collector: { processedKeys: ['title:春'] } }, limit: 3, maxRequests: 10,
    discoverImpl: discoveryOf(entries) });
  assert.equal(result.added.length, 3);
  assert.equal(result.questions.length, 4);
  assert.ok(result.questions.every(q => q.realTitle === '春'));
});

test('unverified legacy fixtures retain normalized title fallback', async () => {
  const result = await collectQuestions({ ...options,
    questions: [{ id: 'legacy-old', realTitle: '共通作品', aliases: [] }],
    limit: 1, maxRequests: 3,
    discoverImpl: discoveryOf([{ id: 'legacy-new', title: '共 通 作 品 (小説)', kind: 'novel', aliases: [] }]),
    generateImpl: async () => { throw new Error('Duplicate legacy title must not be generated'); } });
  assert.equal(result.added.length, 0);
  assert.equal(result.rejected.length, 0);
});

test('NDL volume records remain distinct candidates until resolver identifies the same primary work', async () => {
  let resolutions = 0;
  const records = [ndlCandidate('R100000002-I000001', { ndl: { recordId: 'R100000002-I000001', volume: '1' } }),
    ndlCandidate('R100000002-I000002', { ndl: { recordId: 'R100000002-I000002', volume: '2' } })];
  const result = await collectQuestions({ ...options, providers: ['ndl'], limit: 2, maxRequests: 10,
    discoverImpl: discoveryOf(records),
    generateImpl: async (entry, { fetchImpl }) => {
      resolutions++;
      await fetchImpl('https://ja.wikipedia.org/w/api.php');
      return { ...question(candidate(600)), sources: [question(candidate(600)).sources[0],
        { url: `https://ndlsearch.ndl.go.jp/books/${entry.ndl.recordId}` }] };
    } });
  assert.equal(resolutions, 2);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'wiki-ja-600');
  assert.equal(result.state.collector.pendingCandidates.length, 0);
});

test('NDL pre-generation dedup ignores title alone but protects known exact bibliography records', async () => {
  const existing = question({ ...candidate(100), title: '同じ題名 (作者甲)', realTitle: '同じ題名' });
  existing.sources.push({ url: 'https://ndlsearch.ndl.go.jp/books/R100000002-I000001' });
  const result = await collectQuestions({ ...options, questions: [existing], providers: ['ndl'], limit: 2,
    maxRequests: 10, state: { collector: { processedKeys: ['title:同じ題名'] } },
    discoverImpl: discoveryOf([ndlCandidate('R100000002-I000001'), ndlCandidate('R100000002-I000002')]),
    generateImpl: async (entry) => {
      assert.equal(entry.ndl.recordId, 'R100000002-I000002');
      return question({ ...candidate(101), title: '同じ題名 (作者乙)', realTitle: '同じ題名' });
    } });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'wiki-ja-101');
});

test('direct NDL introductions deduplicate by their case-normalized primary record evidence', async () => {
  const original = { id: 'previous-format-id', realTitle: '紹介付き作品', aliases: [],
    contentType: 'description', evidence: { sourceId: 'ndl-R100000002-I000006' },
    sources: [{ url: 'https://ndlsearch.ndl.go.jp/books/R100000002-I000006' }] };
  const result = await collectQuestions({ ...options, questions: [original], providers: ['ndl'],
    limit: 1, maxRequests: 3, discoverImpl: discoveryOf([ndlCandidate('R100000002-I000006')]),
    generateImpl: async () => { throw new Error('Previously saved primary source must not be regenerated'); } });
  assert.deepEqual(result.questions, [original]);
  assert.equal(result.added.length, 0);
  assert.equal(result.rejected.length, 0);
});

test('all default providers rotate fairly even when an older provider has a pending backlog', async () => {
  const generatedProviders = [];
  const state = { providers: { wikipedia: { oldCursor: 9 }, aozora: { oldCursor: 4 } }, collector: {
    nextProvider: 'wikipedia', pendingCandidates: [candidate(100), candidate(101), candidate(102)], processedKeys: [],
  } };
  const result = await collectQuestions({ ...options, providers: DEFAULT_PROVIDERS,
    state, limit: 4, maxRequests: 10,
    discoverImpl: async ({ provider, state }) => ({
      state: { ...state, newCursor: 1 }, requests: 0, exhausted: true,
      candidates: provider === 'aozora' ? [candidate(500, 'aozora')]
        : provider === 'ndl' ? [ndlCandidate('R100000002-I000003')]
          : provider === 'web' ? [{ ...candidate(800), provider: 'web' }] : [],
    }),
    generateImpl: async (entry, { fetchImpl }) => {
      generatedProviders.push(entry.provider);
      await fetchImpl('https://ja.wikipedia.org/w/api.php');
      return entry.provider === 'ndl' ? question(candidate(700)) : question(entry);
    } });
  assert.deepEqual(new Set(generatedProviders), new Set(DEFAULT_PROVIDERS));
  assert.equal(result.added.length, 4);
  assert.equal(result.state.providers.wikipedia.oldCursor, 9);
  assert.equal(result.state.providers.aozora.oldCursor, 4);
  assert.equal(result.state.providers.ndl.newCursor, 1);
  assert.ok(result.state.collector.pendingCandidates.some(q => q.id === 'wiki-ja-102'));
});

test('NDL resolver request-budget failures preserve the exact pending record for retry', async () => {
  const record = ndlCandidate('R100000002-I000005');
  const result = await collectQuestions({ ...options, providers: ['ndl'], limit: 1, maxRequests: 1,
    state: { providers: { ndl: { cursor: 2 } }, collector: { pendingCandidates: [record], nextProvider: 'ndl' } },
    discoverImpl: discoveryOf([]),
    generateImpl: async (entry, { fetchImpl }) => {
      await fetchImpl('https://ndlsearch.ndl.go.jp/api/opensearch');
      await fetchImpl('https://ja.wikipedia.org/w/api.php');
      return question(candidate(800));
    } });
  assert.equal(result.requests, 1);
  assert.deepEqual(result.state.collector.pendingCandidates, [record]);
  assert.equal(result.state.providers.ndl.cursor, 2);
  assert.equal(result.added.length, 0);
});

test('the default NDL adapter can discover and validate a source-backed non-novel introduction', async () => {
  const plot = '海辺の町で暮らす若者は、長く連絡が途絶えていた友人から届いた手紙をきっかけに、見知らぬ港へ向かう。' +
    'そこで出会った老人から町に伝わる古い約束を聞いた若者は、残された仲間とともに手紙の差出人を探し始める。' +
    '嵐によって帰り道を失いながらも、彼らは互いに助け合い、隠されていた家族の出来事を少しずつ知ることになる。';
  const xml = '<rss><channel><openSearch:totalResults>1</openSearch:totalResults><item>' +
    '<dc:title>資料付き漫画</dc:title><link>https://ndlsearch.ndl.go.jp/books/R100000002-I000010</link>' +
    '<category>図書</category><dc:subject xsi:type="dcndl:NDC10">726.1</dc:subject>' +
    `<dc:description>内容紹介：${plot}</dc:description></item></channel></rss>`;
  const { questionIsValid } = require('../server/src/questions/validation');
  const result = await collectQuestions({ providers: ['ndl'], limit: 1, maxRequests: 3,
    throttleMilliseconds: 0, validateQuestion: questionIsValid,
    fetchImpl: async (value) => {
      const url = new URL(value);
      assert.equal(url.hostname, 'ndlsearch.ndl.go.jp');
      assert.equal(url.pathname, '/api/opensearch');
      assert.equal(url.searchParams.get('ndc'), '726.1');
      return new Response(xml);
    } });
  assert.equal(result.requests, 1);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].kind, 'manga');
  assert.equal(result.added[0].contentType, 'description');
  assert.equal(result.added[0].synopsis, plot);
  assert.equal(result.added[0].evidence.sourceId, 'ndl-R100000002-I000010');
  assert.equal(questionIsValid(result.added[0]), true);
});

test('aborted generation returns partial results and retains unfinished candidate', async () => {
  const controller = new AbortController();
  const result = await collectQuestions({ ...options, signal: controller.signal, limit: 2, maxRequests: 10,
    discoverImpl: discoveryOf([candidate(100), candidate(101)]),
    generateImpl: async (entry) => {
      if (entry.id === 'wiki-ja-101') {
        controller.abort(new Error('batch deadline'));
        throw controller.signal.reason;
      }
      return question(entry);
    } });
  assert.equal(result.added.length, 1);
  assert.equal(result.state.collector.pendingCandidates[0].id, 'wiki-ja-101');
});

test('Wikipedia spacing persists across batches and applies to NDL resolution without delaying other sources', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  const calls = [];
  const record = ndlCandidate('R100000002-I000030');
  const firstPromise = collectQuestions({
    providers: ['wikipedia', 'aozora', 'ndl'], limit: 3, maxRequests: 3,
    state: { collector: { pendingCandidates: [candidate(100), candidate(500, 'aozora'), record] } },
    discoverImpl: discoveryOf([]),
    fetchImpl: async (value) => { calls.push({ host: new URL(value).hostname, at: Date.now() }); return Response.json({}); },
    generateImpl: async (entry, { fetchImpl }) => {
      await fetchImpl(entry.provider === 'aozora'
        ? 'https://www.aozora.gr.jp/cards/000879/files/work.html' : 'https://ja.wikipedia.org/w/api.php');
      return question(entry.provider === 'ndl' ? candidate(700) : entry);
    },
  });
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.deepEqual(calls.map(call => call.host), ['ja.wikipedia.org', 'www.aozora.gr.jp']);
  t.mock.timers.tick(5499);
  await new Promise(setImmediate);
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  const first = await firstPromise;
  assert.equal(first.added.length, 3);
  assert.equal(calls[2].at - calls[0].at, 6500);
  assert.equal(first.state.collector.requestPacing['ja.wikipedia.org'].nextAllowedAt, 23000);
  const state = structuredClone(first.state);
  state.collector.pendingCandidates.push(candidate(101));
  const secondPromise = collectQuestions({ providers: ['wikipedia'], limit: 1, maxRequests: 1,
    questions: first.questions, state, discoverImpl: discoveryOf([]), generateImpl: generatedWithFetch(),
    fetchImpl: async () => { calls.push({ at: Date.now() }); return Response.json({}); } });
  await new Promise(setImmediate);
  assert.equal(calls.length, 3);
  t.mock.timers.tick(6500);
  const second = await secondPromise;
  assert.equal(calls[3].at, 23000);
  assert.equal(second.added[0].id, 'wiki-ja-101');
});

test('a Wiki 429 checkpoints the exact candidate while other providers continue and later batches resume', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T12:00:00Z') });
  const original = candidate(100);
  const calls = [];
  const initialState = { providers: { wikipedia: { cursor: 3 }, aozora: { cursor: 7 }, ndl: { cursor: 9 } },
    collector: { pendingCandidates: [original, candidate(500, 'aozora'), ndlCandidate('R100000002-I000031')] } };
  const result = await collectQuestions({ ...options, providers: DEFAULT_PROVIDERS,
    state: initialState, limit: 3, maxRequests: 8,
    discoverImpl: async ({ state }) => ({ candidates: [], state, requests: 0, exhausted: true }),
    fetchImpl: async (value) => {
      const host = new URL(value).hostname;
      calls.push(host);
      return host === 'ja.wikipedia.org' ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : Response.json({});
    },
    generateImpl: async (entry, { fetchImpl }) => {
      const host = entry.provider === 'wikipedia' ? 'ja.wikipedia.org' : entry.provider === 'aozora' ? 'www.aozora.gr.jp' : 'ndlsearch.ndl.go.jp';
      await fetchImpl(`https://${host}/source`);
      return question(entry.provider === 'ndl' ? candidate(700) : entry);
    } });
  assert.equal(result.requests, 3);
  assert.deepEqual(calls, ['ja.wikipedia.org', 'www.aozora.gr.jp', 'ndlsearch.ndl.go.jp']);
  assert.equal(result.added.length, 2);
  assert.deepEqual(result.state.collector.pendingCandidates, [original]);
  assert.deepEqual(result.state.providers, { ...initialState.providers, web: {} });
  assert.ok(!result.state.collector.processedKeys.includes('attempt:wikipedia:novel:page:100'));
  assert.ok(!result.state.collector.processedKeys.includes('page:100'));
  const deadline = Date.now() + 120000;
  assert.equal(result.state.collector.requestPacing['ja.wikipedia.org'].cooldownUntil, deadline);
  const deferred = await collectQuestions({ ...options, questions: result.questions, state: result.state,
    providers: ['wikipedia'], limit: 1, maxRequests: 1, discoverImpl: discoveryOf([]),
    fetchImpl: async () => { throw new Error('A new batch must honor the saved cooldown'); } });
  assert.equal(deferred.requests, 0);
  assert.deepEqual(deferred.state.collector.pendingCandidates, [original]);
  t.mock.timers.tick(120000);
  const resumed = await collectQuestions({ ...options, questions: deferred.questions, state: deferred.state,
    providers: ['wikipedia'], limit: 1, maxRequests: 1, discoverImpl: discoveryOf([]) });
  assert.equal(resumed.requests, 1);
  assert.equal(resumed.added[0].id, original.id);
  assert.equal(resumed.state.collector.requestPacing['ja.wikipedia.org'].cooldownUntil, 0);
  assert.deepEqual(initialState.collector.pendingCandidates[0], original);
});

test('Wiki Retry-After preserves representable dates and seconds while invalid or overflowing values use the 30-second fallback', async (t) => {
  const start = Date.parse('2026-10-01T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const cases = [[undefined, 30000], ['nonsense', 30000], ['-10', 30000], ['0', 30000],
    ['2', 6500], ['60', 60000], ['Thu, 01 Oct 2026 12:01:00 GMT', 60000],
    ['3600', 3600000], ['Thu, 01 Oct 2026 13:00:00 GMT', 3600000],
    ['99999999999', 99999999999000], [String((8640000000000000 - start) / 1000), 8640000000000000 - start],
    ['999999999999999999999', 30000]];
  for (const [value, expected] of cases) {
    const result = await collectQuestions({ ...options, state: { collector: { pendingCandidates: [candidate(100)] } },
      providers: ['wikipedia'], limit: 1, maxRequests: 2, discoverImpl: discoveryOf([]),
      fetchImpl: async () => new Response('', { status: 429, ...(value && { headers: { 'Retry-After': value } }) }) });
    assert.equal(result.requests, 1);
    assert.equal(result.state.collector.requestPacing['ja.wikipedia.org'].nextAllowedAt, start + expected, String(value));
  }
});

test('a one-hour Wiki Retry-After deadline survives later batches without an early request or a blocking wait', async (t) => {
  const start = Date.parse('2026-10-01T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const original = candidate(100);
  const first = await collectQuestions({ ...options, providers: ['wikipedia'], limit: 1, maxRequests: 2,
    state: { collector: { pendingCandidates: [original] } }, discoverImpl: discoveryOf([]),
    fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }) });
  const expected = { nextAllowedAt: start + 3600000, cooldownUntil: start + 3600000 };
  assert.deepEqual(first.state.collector.requestPacing['ja.wikipedia.org'], expected);
  t.mock.timers.tick(1800000);
  const deferred = await collectQuestions({ ...options, providers: ['wikipedia'], limit: 1, maxRequests: 2,
    questions: first.questions, state: first.state, discoverImpl: discoveryOf([]),
    fetchImpl: async () => { throw new Error('A valid one-hour deadline must not become a five-minute deadline'); } });
  assert.equal(deferred.requests, 0);
  assert.deepEqual(deferred.state.collector.requestPacing['ja.wikipedia.org'], expected);
  assert.deepEqual(deferred.state.collector.pendingCandidates, [original]);
  assert.equal(deferred.state.collector.processedKeys.length, 0);
  t.mock.timers.tick(1800000);
  const resumed = await collectQuestions({ ...options, providers: ['wikipedia'], limit: 1, maxRequests: 1,
    questions: deferred.questions, state: deferred.state, discoverImpl: discoveryOf([]) });
  assert.equal(resumed.requests, 1);
  assert.equal(resumed.added[0].id, original.id);
  assert.equal(resumed.state.collector.requestPacing['ja.wikipedia.org'].cooldownUntil, 0);
});

test('a throttled discovery request preserves its page cursor and does not consume repeated network budget', async () => {
  const { discoverCandidates } = require('../server/src/questions/discovery');
  const initialized = await discoverCandidates({ limit: 1, maxRequests: 0, throttleMilliseconds: 0,
    fetchImpl: async () => { throw new Error('Initial cursor creation uses no request'); } });
  const result = await collectQuestions({ ...options, providers: ['wikipedia'], limit: 1, maxRequests: 8,
    state: { providers: { wikipedia: initialized.state } }, generateImpl: undefined,
    fetchImpl: async () => new Response('', { status: 429 }) });
  assert.equal(result.requests, 1);
  assert.deepEqual(result.state.providers.wikipedia, initialized.state);
  assert.equal(result.state.collector.processedKeys.length, 0);
});

test('the real NDL resolver propagates Wiki article cooldown instead of rejecting the bibliography record', async () => {
  const record = ndlCandidate('R100000002-I000032', { title: '同じ題名',
    ndl: { recordId: 'R100000002-I000032', url: 'https://ndlsearch.ndl.go.jp/books/R100000002-I000032',
      originalTitle: '同じ題名', authors: [{ name: '山田太郎' }], categories: ['図書'], genres: ['漫画'],
      classifications: ['726.1'], descriptions: [], volumeSeparated: false } });
  let calls = 0;
  const result = await collectQuestions({ throttleMilliseconds: 0, providers: ['ndl'], limit: 1, maxRequests: 8,
    state: { providers: { ndl: { cursor: 4 } }, collector: { pendingCandidates: [record] } },
    discoverImpl: async ({ state }) => ({ state, candidates: [], exhausted: true, requests: 0 }),
    fetchImpl: async (value) => {
      calls++;
      if (new URL(value).searchParams.get('list') === 'search') return Response.json({ query: { search: [{ pageid: 800, title: '同じ題名 (漫画)' }] } });
      return new Response('', { status: 429 });
    } });
  assert.equal(calls, 2);
  assert.equal(result.requests, 2);
  assert.deepEqual(result.state.collector.pendingCandidates, [record]);
  assert.deepEqual(result.state.providers.ndl, { cursor: 4 });
  assert.equal(result.state.collector.processedKeys.length, 0);
  assert.ok(result.state.collector.requestPacing['ja.wikipedia.org'].cooldownUntil > Date.now());
});

test('the service deadline aborts a Wiki pacing wait and saves already collected work within its grace period', async (t) => {
  const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { createQuestionService } = require('../server/src/questions/service');
  const directory = mkdtempSync(join(tmpdir(), 'title-wiki-pacing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bankPath = join(directory, 'bank.json');
  const statePath = join(directory, 'state.json');
  const service = createQuestionService({ bankPath, statePath, live: false, validateQuestion: () => true,
    collectionTimeoutMilliseconds: 75,
    collectionOptions: { providers: ['wikipedia'], limit: 2, maxRequests: 3,
      discoverImpl: discoveryOf([candidate(100), candidate(101)]), generateImpl: async (...args) => {
        const q = await generatedWithFetch()(...args);
        q.realTitle += 'の物語';
        q.evidence.visibility = require('../server/src/questions/selection-policy').visibilityEvidence({
          title:q.realTitle,kind:q.kind,sourceUrl:q.sources[0].url,genres:['小規模出版']});
        q.evidence.distribution = require('../server/src/questions/distribution-policy').distributionEvidence({title:q.realTitle,kind:q.kind,sourceUrl:q.sources[0].url,publisher:'検証出版社',date:'2026-01-01',identifier:'9784065373262'});
        return q;
      } },
    fetchImpl: async () => Response.json({}) });
  t.after(() => service.stop());
  const startedAt = Date.now();
  const result = await service.collectNow();
  assert.ok(Date.now() - startedAt < 1000, 'The collector did not settle before the service grace deadline');
  assert.equal(result.added.length, 1);
  assert.equal(JSON.parse(readFileSync(bankPath)).questions[0].id, 'wiki-ja-100');
  assert.deepEqual(JSON.parse(readFileSync(statePath)).collector.pendingCandidates, [candidate(101)]);
  assert.equal(service.getStatus().failure.code, 'timed_out');
});

test('the global throttle wait also aborts promptly and retains its unfinished candidate', async () => {
  const start = Date.now();
  const result = await collectQuestions({ providers: ['aozora'], throttleMilliseconds: 10000,
    signal: AbortSignal.timeout(25), limit: 2, maxRequests: 3,
    discoverImpl: discoveryOf([candidate(500, 'aozora'), candidate(501, 'aozora')]),
    generateImpl: async (entry, { fetchImpl }) => { await fetchImpl('https://www.aozora.gr.jp/source'); return question(entry); },
    fetchImpl: async () => Response.json({}) });
  assert.ok(Date.now() - start < 1000);
  assert.equal(result.requests, 1);
  assert.equal(result.added.length, 1);
  assert.deepEqual(result.state.collector.pendingCandidates, [candidate(501, 'aozora')]);
});

test('curl source responses preserve Retry-After and binary payload bytes', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x0a]);
  const response = curlResponse(Buffer.concat([bytes, Buffer.from('\n__TITLE_QUESTION_HTTP_STATUS__:429\n__TITLE_QUESTION_RETRY_AFTER__:60')]));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const normal = curlResponse(Buffer.concat([bytes, Buffer.from('\n__TITLE_QUESTION_HTTP_STATUS__:200\n__TITLE_QUESTION_RETRY_AFTER__:')]));
  assert.equal(normal.headers.get('retry-after'), null);
  assert.deepEqual(Buffer.from(await normal.arrayBuffer()), bytes);
  assert.throws(() => curlResponse(Buffer.from('unframed response')));
});

test('CLI defaults to online discovery and persistent accumulation rather than a fixed catalog', () => {
  const args = parseArgs([]);
  assert.equal(args.catalog, null);
  assert.match(args.output, /server\/data\/questions\/bank\.json$/u);
  assert.match(args.state, /server\/data\/questions\/discovery\.json$/u);
  assert.equal(args.batchSize, 8);
  assert.equal(args.minimum, null);
  assert.equal(parseArgs(['--catalog', 'fixture.json']).catalog.endsWith('/fixture.json'), true);
  assert.equal(parseArgs(['--batch-size', '30', '--max-requests', '40']).batchSize, 30);
  assert.throws(() => parseArgs(['--batch-size', '0']));
  assert.throws(() => parseArgs(['--max-requests', '301']));
});

test('CLI replenishes the same configured persistent store as the running server', (t) => {
  const originalBank = process.env.QUESTION_BANK_PATH;
  const originalState = process.env.QUESTION_DISCOVERY_STATE_PATH;
  t.after(() => {
    if (originalBank === undefined) delete process.env.QUESTION_BANK_PATH;
    else process.env.QUESTION_BANK_PATH = originalBank;
    if (originalState === undefined) delete process.env.QUESTION_DISCOVERY_STATE_PATH;
    else process.env.QUESTION_DISCOVERY_STATE_PATH = originalState;
  });
  process.env.QUESTION_BANK_PATH = '/tmp/title-custom-bank/bank.json';
  process.env.QUESTION_DISCOVERY_STATE_PATH = '/tmp/title-custom-bank/state.json';
  const args = parseArgs([]);
  assert.equal(args.output, '/tmp/title-custom-bank/bank.json');
  assert.equal(args.state, '/tmp/title-custom-bank/state.json');
  assert.equal(args.seedPath, undefined);
  const explicit = parseArgs(['--output', '/tmp/separate-bank/bank.json']);
  assert.equal(explicit.output, '/tmp/separate-bank/bank.json');
  assert.equal(explicit.state, '/tmp/separate-bank/discovery.json');
  assert.equal(explicit.explicitOutput, true);
});

test('small-work acceptance continues past unknown works while preserving the saved bank and request budget',async()=>{
  const saved=question(candidate(700)),unknown=candidate(701),small=candidate(702);
  const result=await collectQuestions({...options,questions:[saved],providers:['wikipedia'],limit:1,maxRequests:3,
    discoverImpl:discoveryOf([unknown,small]),acceptCandidate:q=>q.id===small.id});
  assert.equal(result.requests,2);assert.deepEqual(result.questions.map(q=>q.id),[saved.id,small.id]);
  assert.equal(result.added.length,1);assert.match(result.rejected[0].error,/小規模制作/);
});

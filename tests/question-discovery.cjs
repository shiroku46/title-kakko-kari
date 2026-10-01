const { test } = require('node:test');
const assert = require('node:assert/strict');
const { discoverCandidates, DEFAULT_ROOTS } = require('../server/src/questions/discovery');
const { WORK_KINDS, KIND_IDS, getKind } = require('../server/src/questions/kinds');

const roots = [{ category: 'Category:小説', kind: 'novel' }];
const member = (pageid, title, ns = 0) => ({ pageid, title, ns });
const page = (members, continuation = null) => Response.json({
  query: { categorymembers: members },
  ...(continuation ? { continue: { cmcontinue: continuation, continue: '-||' } } : {}),
});
const serialize = (value) => JSON.parse(JSON.stringify(value));
const options = { roots, throttleMilliseconds: 0, includeSearch: false };

test('default entry points are work categories and include broad roots beyond Japan', () => {
  assert.ok(DEFAULT_ROOTS.some((root) => root.category === 'Category:小説'));
  assert.ok(DEFAULT_ROOTS.some((root) => root.category === 'Category:映画作品'));
  assert.deepEqual(new Set(DEFAULT_ROOTS.map((root) => root.kind)), new Set(KIND_IDS));
  for (const root of DEFAULT_ROOTS) assert.match(root.category, /^Category:/);
});

test('genre registry includes story and descriptive works without requiring invented plots', () => {
  assert.equal(KIND_IDS.length, 16);
  for (const kind of KIND_IDS) {
    const definition = getKind(kind);
    assert.equal(definition, WORK_KINDS[kind]);
    assert.ok(definition.label);
    assert.ok(['story', 'description'].includes(definition.contentMode));
    assert.ok(definition.roots.length >= 2);
    assert.ok(definition.searchQueries.length >= 1);
  }
  for (const kind of ['manga', 'anime', 'game', 'drama']) assert.equal(getKind(kind).contentMode, 'story');
  for (const kind of ['song', 'album', 'music-work', 'poem', 'artwork', 'nonfiction', 'other-work']) {
    assert.equal(getKind(kind).contentMode, 'description');
  }
  assert.equal(getKind('__proto__'), null);
});

test('category discovery visits every registered genre before a second page of the first genre', async () => {
  const categoryKinds = new Map(DEFAULT_ROOTS.map((root) => [root.category, root.kind]));
  const visitedKinds = [];
  const result = await discoverCandidates({
    ...options, roots: DEFAULT_ROOTS, limit: KIND_IDS.length, maxRequests: KIND_IDS.length,
    fetchImpl: async (value) => {
      const category = new URL(value).searchParams.get('cmtitle');
      const kind = categoryKinds.get(category);
      assert.ok(kind);
      visitedKinds.push(kind);
      return page([member(1000 + KIND_IDS.indexOf(kind), `発見された${kind}作品`)], `next-${kind}`);
    },
  });
  assert.deepEqual(visitedKinds, KIND_IDS);
  assert.deepEqual(result.candidates.map((candidate) => candidate.kind), KIND_IDS);
  assert.equal(result.errors.length, 0);
});

test('upgrades a two-genre checkpoint and yields its partial novel page to new manga and song roots', async () => {
  const deepQueue = Array.from({ length: 100 }, (_, index) => ({
    category: `Category:小説深層${index}`, kind: 'novel', continuation: `saved-${index}`,
  }));
  const legacy = {
    schemaVersion: 1, queue: deepQueue, exhaustedAt: null,
    current: {
      category: 'Category:小説', kind: 'novel',
      members: [member(1, '既出の小説'), member(2, '未処理小説二'), member(3, '未処理小説三'), member(4, '未処理小説四')],
      offset: 1, nextContinuation: 'legacy-root-next',
    },
    visitedCategories: { novel: ['Category:小説', ...deepQueue.map((cursor) => cursor.category)], film: [] },
    seenPageIds: { novel: [1], film: [] },
  };
  const expandedRoots = [
    { category: 'Category:小説', kind: 'novel' },
    { category: 'Category:漫画作品', kind: 'manga' },
    { category: 'Category:楽曲', kind: 'song' },
  ];
  const snapshots = [];
  const candidates = [];
  const calls = [];
  let state = serialize(legacy);
  for (let run = 0; run < 7; run++) {
    const result = await discoverCandidates({
      ...options, roots: expandedRoots, state, limit: 1, maxRequests: 1,
      fetchImpl: async (value) => {
        const category = new URL(value).searchParams.get('cmtitle');
        calls.push(category);
        if (category === 'Category:漫画作品') return page([member(20, '漫画二十'), member(21, '漫画二十一')]);
        assert.equal(category, 'Category:楽曲', 'The old deep novel queue must wait while saved page buffers resume');
        return page([member(30, '楽曲三十'), member(31, '楽曲三十一')]);
      },
    });
    candidates.push(...result.candidates);
    snapshots.push(result.state);
    state = serialize(result.state);
  }
  assert.deepEqual(candidates.map((candidate) => [candidate.kind, candidate.discovery.pageId]), [
    ['novel', 2], ['manga', 20], ['song', 30], ['novel', 3], ['manga', 21], ['song', 31], ['novel', 4],
  ]);
  assert.deepEqual(calls, ['Category:漫画作品', 'Category:楽曲']);
  assert.equal(snapshots[0].queue.find((item) => item.type === 'buffer').page.offset, 2);
  assert.equal(snapshots[3].queue.find((item) => item.type === 'buffer' && item.kind === 'novel').page.offset, 3);
  assert.ok(state.queue.some((cursor) => cursor.category === 'Category:小説' && cursor.continuation === 'legacy-root-next'));
  for (const saved of deepQueue) assert.ok(state.queue.some((cursor) =>
    cursor.category === saved.category && cursor.continuation === saved.continuation));
  assert.deepEqual(legacy.current.offset, 1, 'Migration never mutates the previous saved snapshot');
  assert.ok(KIND_IDS.every((kind) => Array.isArray(state.seenPageIds[kind])));
});

test('empty categories fall back to general genre search with saved partial pages and search offsets', async () => {
  const mangaRoots = [{ category: 'Category:漫画作品', kind: 'manga' }];
  const searchCalls = [];
  const firstQuery = getKind('manga').searchQueries[0];
  const fetchImpl = async (value) => {
    const url = new URL(value);
    if (url.searchParams.get('list') === 'categorymembers') return page([]);
    assert.equal(url.origin, 'https://ja.wikipedia.org');
    assert.equal(url.searchParams.get('list'), 'search');
    assert.equal(url.searchParams.get('srnamespace'), '0');
    const query = url.searchParams.get('srsearch');
    const offset = url.searchParams.get('sroffset');
    searchCalls.push([query, offset]);
    if (query !== firstQuery) return Response.json({ query: { search: [] } });
    if (offset === null) return Response.json({
      query: { search: [member(1, 'ネットで発見した漫画一'), member(2, 'ネットで発見した漫画二')] },
      continue: { sroffset: 2, continue: '-||' },
    });
    assert.equal(offset, '2');
    return Response.json({ query: { search: [member(3, 'ネットで発見した漫画三')] } });
  };
  const first = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, limit: 1, maxRequests: 2, fetchImpl,
  });
  assert.equal(first.candidates[0].discovery.query, firstQuery);
  assert.equal(first.requests, 2);
  const second = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, state: serialize(first.state), limit: 1, maxRequests: 0, fetchImpl,
  });
  assert.equal(second.candidates[0].discovery.pageId, 2);
  assert.equal(second.requests, 0);
  const third = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, state: serialize(second.state), limit: 1, maxRequests: 2, fetchImpl,
  });
  assert.equal(third.candidates[0].discovery.pageId, 3);
  assert.equal(third.exhausted, true);
  assert.deepEqual(searchCalls, [[firstQuery, null], [getKind('manga').searchQueries[1], null], [firstQuery, '2']]);
});

test('a failed full-text search retains its continuation offset for the next collection', async () => {
  const mangaRoots = [{ category: 'Category:漫画作品', kind: 'manga' }];
  const firstQuery = getKind('manga').searchQueries[0];
  const first = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, limit: 2, maxRequests: 2,
    fetchImpl: async (value) => new URL(value).searchParams.get('list') === 'categorymembers' ? page([])
      : Response.json({ query: { search: [member(1, '漫画一'), member(2, '漫画二')] }, continue: { sroffset: 2 } }),
  });
  const ready = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, state: serialize(first.state), maxRequests: 1,
    fetchImpl: async () => Response.json({ query: { search: [] } }),
  });
  const saved = serialize(ready.state);
  const failed = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, state: saved,
    fetchImpl: async (value) => {
      const url = new URL(value);
      assert.equal(url.searchParams.get('srsearch'), firstQuery);
      assert.equal(url.searchParams.get('sroffset'), '2');
      return new Response('', { status: 429 });
    },
  });
  assert.equal(failed.requests, 1);
  assert.deepEqual(failed.state, saved);
  const recovered = await discoverCandidates({
    ...options, roots: mangaRoots, includeSearch: true, state: serialize(failed.state),
    fetchImpl: async (value) => {
      assert.equal(new URL(value).searchParams.get('sroffset'), '2');
      return Response.json({ query: { search: [member(3, '漫画三')] } });
    },
  });
  assert.equal(recovered.candidates[0].discovery.pageId, 3);
});

test('an empty provider state starts category discovery', async () => {
  const result = await discoverCandidates({
    ...options, state: {}, fetchImpl: async () => page([member(1, '作品')]),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.state.schemaVersion, 1);
});

test('resumes a partially consumed page without losing its tail or re-fetching it', async () => {
  const fetches = [];
  const fetchImpl = async (value) => {
    const url = new URL(value);
    fetches.push(url.searchParams.get('cmcontinue'));
    assert.equal(url.origin, 'https://ja.wikipedia.org');
    assert.equal(url.pathname, '/w/api.php');
    assert.equal(url.searchParams.get('cmnamespace'), '0|14');
    if (!url.searchParams.has('cmcontinue')) {
      return page([member(1, '第一作品'), member(2, '第二作品'), member(3, '第三作品')], 'page-two');
    }
    assert.equal(url.searchParams.get('cmcontinue'), 'page-two');
    return page([member(4, '第四作品')]);
  };
  const first = await discoverCandidates({ ...options, limit: 1, maxRequests: 1, fetchImpl });
  assert.deepEqual(first.candidates.map((candidate) => candidate.title), ['第一作品']);
  assert.equal(first.state.queue.find((item) => item.type === 'buffer').page.offset, 1);
  assert.equal(first.exhausted, false);
  const previous = serialize(first.state);
  const second = await discoverCandidates({ ...options, state: previous, limit: 2, maxRequests: 0, fetchImpl });
  assert.deepEqual(second.candidates.map((candidate) => candidate.title), ['第二作品', '第三作品']);
  assert.equal(second.requests, 0);
  assert.equal(previous.queue.find((item) => item.type === 'buffer').page.offset, 1, 'The caller snapshot remains unchanged');
  assert.equal(second.state.current, null);
  assert.equal(second.state.queue[0].continuation, 'page-two');
  const third = await discoverCandidates({ ...options, state: serialize(second.state), fetchImpl });
  assert.deepEqual(third.candidates.map((candidate) => candidate.title), ['第四作品']);
  assert.deepEqual(fetches, [null, 'page-two']);
  assert.equal(third.exhausted, true);
  assert.deepEqual(third.candidates[0], {
    id: 'wiki-ja-4', provider: 'wikipedia', title: '第四作品', kind: 'novel', aliases: [],
    discovery: { pageId: 4, category: 'Category:小説' },
  });
  const exhausted = await discoverCandidates({ ...options, state: serialize(third.state), fetchImpl });
  assert.equal(exhausted.requests, 0);
  assert.equal(exhausted.exhausted, true, 'An exhausted persisted walk waits before its next refresh');
});

test('refreshes a completed walk when due to find new works and subcategories without re-emitting old pages', async () => {
  const beginning = Date.parse('2026-10-01T00:00:00Z');
  const refreshMilliseconds = 1000;
  const first = await discoverCandidates({
    ...options, refreshMilliseconds, now: () => beginning,
    fetchImpl: async (value) => new URL(value).searchParams.get('cmtitle') === 'Category:小説'
      ? page([member(1, '旧作品一'), member(10, 'Category:子分類', 14)])
      : page([member(2, '旧作品二')]),
  });
  assert.equal(first.exhausted, true);
  assert.equal(first.state.exhaustedAt, '2026-10-01T00:00:00.000Z');
  const waiting = await discoverCandidates({
    ...options, state: serialize(first.state), refreshMilliseconds, now: () => beginning + 999,
    fetchImpl: async () => { throw new Error('Not due: network must remain idle'); },
  });
  assert.equal(waiting.requests, 0);
  assert.deepEqual(waiting.state, first.state);
  const categories = [];
  const refreshed = await discoverCandidates({
    ...options, state: serialize(waiting.state), refreshMilliseconds, now: () => beginning + 1000,
    fetchImpl: async (value) => {
      const category = new URL(value).searchParams.get('cmtitle');
      categories.push(category);
      if (category === 'Category:小説') {
        return page([
          member(1, '旧作品一'), member(3, '新作品三'),
          member(10, 'Category:子分類', 14), member(11, 'Category:新子分類', 14),
        ]);
      }
      if (category === 'Category:子分類') return page([member(2, '旧作品二'), member(4, '新作品四')]);
      assert.equal(category, 'Category:新子分類');
      return page([member(5, '新作品五')]);
    },
  });
  assert.deepEqual(categories, ['Category:小説', 'Category:子分類', 'Category:新子分類']);
  assert.deepEqual(refreshed.candidates.map((candidate) => candidate.id), ['wiki-ja-3', 'wiki-ja-4', 'wiki-ja-5']);
  assert.deepEqual(refreshed.state.seenPageIds.novel, [1, 2, 3, 4, 5]);
  assert.equal(refreshed.state.exhaustedAt, '2026-10-01T00:00:01.000Z');
});

test('older completed cursor snapshots without exhaustedAt start a refresh interval safely', async () => {
  const completed = await discoverCandidates({ ...options, fetchImpl: async () => page([member(1, '旧作品')]) });
  const oldState = serialize(completed.state);
  delete oldState.exhaustedAt;
  const resumed = await discoverCandidates({
    ...options, state: oldState, now: () => Date.parse('2026-10-01T00:00:00Z'),
    fetchImpl: async () => { throw new Error('Older completed cursor must not fetch immediately'); },
  });
  assert.equal(resumed.requests, 0);
  assert.equal(resumed.state.exhaustedAt, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(resumed.state.seenPageIds, oldState.seenPageIds);
});

test('walks subcategories, rotates pagination fairly, stops cycles, and deduplicates pages', async () => {
  const calls = [];
  const fetchImpl = async (value) => {
    const url = new URL(value);
    const category = url.searchParams.get('cmtitle');
    const continuation = url.searchParams.get('cmcontinue');
    calls.push([category, continuation]);
    if (category === 'Category:小説' && !continuation) {
      return page([member(10, 'Category:子分類', 14), member(1, '第一作品')], 'root-next');
    }
    if (category === 'Category:子分類') {
      return page([
        member(11, 'Category:小説', 14), member(10, 'Category:子分類', 14),
        member(1, '第一作品'), member(2, '第二作品'), member(12, 'Category:孫分類', 14),
      ]);
    }
    if (category === 'Category:小説' && continuation === 'root-next') return page([member(3, '第三作品')]);
    assert.equal(category, 'Category:孫分類');
    return page([member(2, '第二作品'), member(4, '第四作品')]);
  };
  const result = await discoverCandidates({ ...options, maxRequests: 10, fetchImpl });
  assert.deepEqual(calls, [
    ['Category:小説', null], ['Category:子分類', null],
    ['Category:小説', 'root-next'], ['Category:孫分類', null],
  ]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ['wiki-ja-1', 'wiki-ja-2', 'wiki-ja-3', 'wiki-ja-4']);
  assert.deepEqual(result.state.visitedCategories.novel, ['Category:小説', 'Category:子分類', 'Category:孫分類']);
  assert.equal(result.exhausted, true);
});

test('does not lose a possible film after encountering it through a novel-related category', async () => {
  const mixedRoots = [
    { category: 'Category:小説', kind: 'novel' },
    { category: 'Category:映画作品', kind: 'film' },
  ];
  const result = await discoverCandidates({
    ...options, roots: mixedRoots, fetchImpl: async () => page([member(50, '映像作品')]),
  });
  assert.deepEqual(result.candidates.map((candidate) => [candidate.id, candidate.kind]), [
    ['wiki-ja-50', 'novel'], ['wiki-ja-50', 'film'],
  ]);
  assert.deepEqual(result.state.seenPageIds.novel, [50]);
  assert.deepEqual(result.state.seenPageIds.film, [50]);
});

test('network and API failures preserve the exact unconsumed category cursor', async () => {
  const first = await discoverCandidates({
    ...options, maxRequests: 1, fetchImpl: async () => page([member(1, '第一作品')], 'resume-token'),
  });
  const saved = serialize(first.state);
  for (const fetchImpl of [
    async () => { throw new Error('temporary connection failure'); },
    async () => new Response('', { status: 503 }),
    async () => Response.json({ error: { code: 'maxlag', info: 'replica is busy' } }),
    async () => Response.json({ query: { categorymembers: 'bad response' } }),
    async () => page([], 'resume-token'),
  ]) {
    const failure = await discoverCandidates({ ...options, state: saved, fetchImpl });
    assert.equal(failure.requests, 1);
    assert.equal(failure.errors.length, 1);
    assert.equal(failure.exhausted, false);
    assert.deepEqual(failure.state, saved);
  }
  const retry = await discoverCandidates({
    ...options, state: saved,
    fetchImpl: async (value) => {
      assert.equal(new URL(value).searchParams.get('cmcontinue'), 'resume-token');
      return page([member(2, '再開後の作品')]);
    },
  });
  assert.deepEqual(retry.candidates.map((candidate) => candidate.title), ['再開後の作品']);
  assert.equal(retry.exhausted, true);
});

test('429 reports retry timing, retains the cursor, and never makes hidden extra requests', async () => {
  let calls = 0;
  const rateLimited = await discoverCandidates({
    ...options,
    fetchImpl: async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'Retry-After': '12' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(rateLimited.requests, 1);
  assert.equal(rateLimited.errors[0].retryAfterMilliseconds, 12000);
  assert.equal(rateLimited.state.queue[0].category, 'Category:小説');
  const dated = await discoverCandidates({
    ...options, now: () => Date.parse('2026-10-01T00:00:00Z'),
    fetchImpl: async () => new Response('', {
      status: 429, headers: { 'Retry-After': 'Thu, 01 Oct 2026 00:00:03 GMT' },
    }),
  });
  assert.equal(dated.errors[0].retryAfterMilliseconds, 3000);
});

test('ignores non-mainspace members and refuses to traverse fake namespace-14 titles', async () => {
  const result = await discoverCandidates({
    ...options,
    fetchImpl: async () => page([
      member(1, 'Template:ひな形', 10), member(2, 'File:画像.png', 6),
      member(3, 'User:利用者', 2), member(4, 'https://unrelated.example/', 14),
      member(5, '作品記事'),
    ]),
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.title), ['作品記事']);
  assert.equal(result.requests, 1);
  assert.equal(result.exhausted, true);
});

test('per-run request bounds do not impose a permanent global discovery limit', async () => {
  const fetchedTokens = [];
  const delays = [];
  const fetchImpl = async (value) => {
    const token = new URL(value).searchParams.get('cmcontinue');
    const index = token ? Number(token) : 0;
    fetchedTokens.push(token);
    return page([member(index + 1, `発見作品${index + 1}`)], String(index + 1));
  };
  let state;
  const allCandidates = [];
  for (let run = 0; run < 4; run++) {
    const batch = await discoverCandidates({
      roots, state, limit: 10, maxRequests: 2, throttleMilliseconds: 100, includeSearch: false,
      sleep: async (milliseconds) => { delays.push(milliseconds); }, fetchImpl,
    });
    assert.equal(batch.requests, 2);
    assert.equal(batch.exhausted, false);
    allCandidates.push(...batch.candidates);
    state = serialize(batch.state);
  }
  assert.deepEqual(fetchedTokens, [null, '1', '2', '3', '4', '5', '6', '7']);
  assert.equal(new Set(allCandidates.map((candidate) => candidate.id)).size, 8);
  assert.deepEqual(delays, [100, 100, 100, 100]);
});

test('rejects corrupt saved state and invalid per-run limits before network access', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return page([]); };
  for (const override of [
    { limit: 0 }, { maxRequests: -1 }, { pageSize: 501 }, { throttleMilliseconds: -1 },
    { state: { schemaVersion: 0 } },
    { roots: [{ category: 'https://external.example', kind: 'novel' }] },
  ]) {
    await assert.rejects(discoverCandidates({ ...options, fetchImpl, ...override }), /不正/);
  }
  assert.equal(called, false);
});

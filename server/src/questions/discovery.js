const { KIND_IDS, getKind, getDefaultRoots } = require('./kinds');

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const DEFAULT_REFRESH_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ROOTS = getDefaultRoots();
const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const emptyKindMap = () => Object.fromEntries(KIND_IDS.map((kind) => [kind, []]));

function categoryIsValid(value) {
  return typeof value === 'string' && value.startsWith('Category:') &&
    value.length > 'Category:'.length && value.length <= 512 && !/[\u0000-\u001f]/u.test(value);
}

function queryIsValid(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f]/u.test(value);
}

function cursorIsValid(cursor) {
  if (!cursor || !getKind(cursor.kind)) return false;
  if (cursor.type === 'search') {
    return queryIsValid(cursor.query) && (cursor.continuation === null ||
      (Number.isSafeInteger(cursor.continuation) && cursor.continuation >= 0));
  }
  return (!cursor.type || cursor.type === 'category') && categoryIsValid(cursor.category) &&
    (cursor.continuation === null || (typeof cursor.continuation === 'string' &&
      cursor.continuation.length > 0 && cursor.continuation.length <= 8192));
}

function memberIsValid(member) {
  return member && Number.isSafeInteger(member.pageid) && member.pageid > 0 &&
    Number.isSafeInteger(member.ns) && typeof member.title === 'string' &&
    member.title.trim().length > 0 && member.title.length <= 512;
}

function pageIsValid(page) {
  return page && cursorIsValid({ ...page, continuation: page.nextContinuation }) &&
    Array.isArray(page.members) && page.members.every(memberIsValid) &&
    Number.isSafeInteger(page.offset) && page.offset >= 0 && page.offset <= page.members.length;
}

function queueItemIsValid(item) {
  return item?.type === 'buffer'
    ? getKind(item.kind) && item.kind === item.page?.kind && pageIsValid(item.page)
    : cursorIsValid(item);
}

function copyCursor(cursor) {
  return cursor.type === 'search'
    ? { type: 'search', kind: cursor.kind, query: cursor.query, continuation: cursor.continuation }
    : { kind: cursor.kind, category: cursor.category, continuation: cursor.continuation };
}

function copyPage(page) {
  const cursor = copyCursor({ ...page, continuation: page.nextContinuation });
  delete cursor.continuation;
  return {
    ...cursor, members: page.members.map(({ pageid, ns, title }) => ({ pageid, ns, title })),
    offset: page.offset, nextContinuation: page.nextContinuation,
  };
}

function rootsAreValid(roots) {
  return Array.isArray(roots) && roots.length > 0 && roots.every((root) =>
    categoryIsValid(root?.category) && getKind(root?.kind));
}

function seedRoots(state, roots, includeSearch, previousKinds = KIND_IDS) {
  const addedRoots = [];
  const addedSearches = [];
  for (const { category, kind } of roots) {
    if (state.visitedCategories[kind].includes(category)) continue;
    state.visitedCategories[kind].push(category);
    addedRoots.push({ category, kind, continuation: null });
  }
  if (includeSearch) {
    for (const kind of [...new Set(roots.map((root) => root.kind))]) {
      for (const query of getKind(kind).searchQueries) {
        if (state.visitedSearchQueries[kind].includes(query)) continue;
        state.visitedSearchQueries[kind].push(query);
        addedSearches.push({ type: 'search', query, kind, continuation: null });
      }
    }
  }
  if (addedRoots.length || addedSearches.length) {
    // New genres go before an old, potentially very deep category queue. The
    // active page is preserved, then yields after its next single candidate.
    state.queue.unshift(...addedRoots, ...addedSearches);
    const firstNewKind = addedRoots.find((root) => !previousKinds.includes(root.kind))?.kind;
    if (firstNewKind) state.nextKind = firstNewKind;
    state.exhaustedAt = null;
  }
}

function initialState(roots, includeSearch) {
  const state = {
    schemaVersion: 1, queue: [], current: null,
    visitedCategories: emptyKindMap(), visitedSearchQueries: emptyKindMap(),
    seenPageIds: emptyKindMap(), exhaustedAt: null, nextKind: roots[0].kind,
  };
  seedRoots(state, roots, includeSearch);
  return state;
}

function validKindMap(map, validate) {
  return map && typeof map === 'object' && !Array.isArray(map) && KIND_IDS.every((kind) =>
    map[kind] === undefined || (Array.isArray(map[kind]) && map[kind].every(validate)));
}

function cloneState(input, roots, includeSearch) {
  if (input === undefined || input === null ||
      (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0)) {
    return initialState(roots, includeSearch);
  }
  if (input.schemaVersion !== 1 || !Array.isArray(input.queue) || !input.queue.every(queueItemIsValid) ||
      (input.exhaustedAt !== undefined && input.exhaustedAt !== null &&
        (typeof input.exhaustedAt !== 'string' || !Number.isFinite(Date.parse(input.exhaustedAt)))) ||
      !validKindMap(input.visitedCategories, categoryIsValid) ||
      !validKindMap(input.seenPageIds, (id) => Number.isSafeInteger(id) && id > 0) ||
      (input.visitedSearchQueries !== undefined && !validKindMap(input.visitedSearchQueries, queryIsValid)) ||
      (input.nextKind !== undefined && !getKind(input.nextKind))) {
    throw new Error('作品収集の再開データが不正です');
  }
  if (input.current !== null && !pageIsValid(input.current)) {
    throw new Error('作品収集のページ位置が不正です');
  }
  const state = {
    schemaVersion: 1,
    queue: input.queue.map((item) => item.type === 'buffer'
      ? { type: 'buffer', kind: item.kind, page: copyPage(item.page) } : copyCursor(item)),
    current: input.current && copyPage(input.current),
    visitedCategories: Object.fromEntries(KIND_IDS.map((kind) =>
      [kind, [...new Set(input.visitedCategories[kind] || [])]])),
    visitedSearchQueries: Object.fromEntries(KIND_IDS.map((kind) =>
      [kind, [...new Set(input.visitedSearchQueries?.[kind] || [])]])),
    seenPageIds: Object.fromEntries(KIND_IDS.map((kind) => [kind, [...new Set(input.seenPageIds[kind] || [])]])),
    exhaustedAt: input.exhaustedAt ?? null,
    nextKind: input.nextKind || input.current?.kind || input.queue[0]?.kind || roots[0].kind,
  };
  // Version 1 previously stored only novel/film. Missing kind arrays are added,
  // and new roots/searches are seeded without resetting any existing cursor.
  seedRoots(state, roots, includeSearch, Object.keys(input.visitedCategories));
  return state;
}

function nextKind(kind) {
  return KIND_IDS[(KIND_IDS.indexOf(kind) + 1) % KIND_IDS.length];
}

function nextQueueIndex(state, buffersOnly) {
  const beginning = KIND_IDS.indexOf(state.nextKind);
  for (let offset = 0; offset < KIND_IDS.length; offset++) {
    const kind = KIND_IDS[(beginning + offset) % KIND_IDS.length];
    // Reuse a fetched page before requesting another page in the same genre.
    // This also keeps a migrated partial page from being buried behind a deep
    // queue containing thousands of that genre's network cursors.
    const buffered = state.queue.findIndex((item) => item.kind === kind && item.type === 'buffer');
    const index = buffered >= 0 ? buffered : (!buffersOnly
      ? state.queue.findIndex((item) => item.kind === kind) : -1);
    if (index >= 0) return index;
  }
  return -1;
}

function retryAfterMilliseconds(response, now) {
  const value = response.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(timestamp - now, 60000)) : null;
}

function requestUrl(cursor, pageSize) {
  const url = new URL(WIKIPEDIA_API);
  url.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', maxlag: '5',
    ...(cursor.type === 'search' ? {
      list: 'search', srsearch: cursor.query, srnamespace: '0', srlimit: String(pageSize), srprop: '',
      ...(cursor.continuation !== null ? { sroffset: String(cursor.continuation) } : {}),
    } : {
      list: 'categorymembers', cmtitle: cursor.category,
      cmnamespace: '0|14', cmtype: 'page|subcat', cmprop: 'ids|title|type', cmlimit: String(pageSize),
      ...(cursor.continuation ? { cmcontinue: cursor.continuation } : {}),
    }),
  }).toString();
  return url.href;
}

function pageFromResponse(cursor, data) {
  if (data?.error) throw new Error(`作品探索APIのエラー (${data.error.code || 'unknown'})`);
  const isSearch = cursor.type === 'search';
  const members = isSearch ? data?.query?.search : data?.query?.categorymembers;
  const continuation = (isSearch ? data?.continue?.sroffset : data?.continue?.cmcontinue) ?? null;
  const page = { ...copyCursor(cursor), members, offset: 0, nextContinuation: continuation };
  delete page.continuation;
  if (!pageIsValid(page) || (continuation !== null && continuation === cursor.continuation) ||
      (isSearch && continuation !== null && continuation <= (cursor.continuation || 0))) {
    throw new Error('作品探索の応答形式が不正です');
  }
  return copyPage(page);
}

/**
 * Discover a bounded batch while retaining an unlimited resumable walk. Saved
 * page buffers yield after one candidate, so small batches remain fair by genre.
 * Consumers must also persist emitted candidates until generation processes
 * them. Every result is only a candidate; the generator verifies work evidence.
 */
async function discoverCandidates({
  state: previousState, limit = 30, maxRequests = 10, fetchImpl = global.fetch,
  roots = DEFAULT_ROOTS, pageSize = 50, throttleMilliseconds = 1200,
  sleep = defaultSleep, now = Date.now, refreshMilliseconds = DEFAULT_REFRESH_MILLISECONDS,
  includeSearch = true,
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
      !Number.isSafeInteger(maxRequests) || maxRequests < 0 || maxRequests > 100 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 ||
      !Number.isFinite(throttleMilliseconds) || throttleMilliseconds < 0 || throttleMilliseconds > 60000 ||
      !Number.isFinite(refreshMilliseconds) || refreshMilliseconds < 0 || typeof includeSearch !== 'boolean' ||
      typeof fetchImpl !== 'function' || typeof sleep !== 'function' || typeof now !== 'function' || !rootsAreValid(roots)) {
    throw new Error('作品収集の実行条件が不正です');
  }
  const state = cloneState(previousState, roots, includeSearch);
  const observedAt = new Date(now());
  if (!Number.isFinite(observedAt.getTime())) throw new Error('作品収集の確認時刻が不正です');
  const observedAtIso = observedAt.toISOString();
  if (!state.current && !state.queue.length) {
    if (!state.exhaustedAt) state.exhaustedAt = observedAtIso;
    else if (observedAt.getTime() - Date.parse(state.exhaustedAt) >= refreshMilliseconds) {
      const fresh = initialState(roots, includeSearch);
      state.queue = fresh.queue;
      state.visitedCategories = fresh.visitedCategories;
      state.visitedSearchQueries = fresh.visitedSearchQueries;
      state.nextKind = fresh.nextKind;
      state.exhaustedAt = null;
    }
  } else state.exhaustedAt = null;
  const visited = Object.fromEntries(KIND_IDS.map((kind) => [kind, new Set(state.visitedCategories[kind])]));
  const seen = Object.fromEntries(KIND_IDS.map((kind) => [kind, new Set(state.seenPageIds[kind])]));
  const candidates = [];
  const errors = [];
  let requests = 0;

  while (candidates.length < limit) {
    if (state.current) {
      const current = state.current;
      let emitted = false;
      while (current.offset < current.members.length && !emitted) {
        const member = current.members[current.offset++];
        if (current.type !== 'search' && member.ns === 14 && categoryIsValid(member.title)) {
          if (!visited[current.kind].has(member.title)) {
            visited[current.kind].add(member.title);
            state.queue.push({ category: member.title, kind: current.kind, continuation: null });
          }
        } else if (member.ns === 0 && !seen[current.kind].has(member.pageid)) {
          seen[current.kind].add(member.pageid);
          candidates.push({
            id: `wiki-ja-${member.pageid}`, provider: 'wikipedia', title: member.title,
            kind: current.kind, aliases: [],
            discovery: {
              pageId: member.pageid,
              ...(current.type === 'search' ? { query: current.query } : { category: current.category }),
            },
          });
          emitted = true;
        }
      }
      if (current.offset < current.members.length) {
        state.queue.push({ type: 'buffer', kind: current.kind, page: current });
      } else if (current.nextContinuation !== null) {
        state.queue.push(copyCursor({ ...current, continuation: current.nextContinuation }));
      }
      state.current = null;
      continue;
    }
    const index = nextQueueIndex(state, requests >= maxRequests);
    if (index < 0) break;
    const cursor = state.queue[index];
    if (cursor.type === 'buffer') {
      state.queue.splice(index, 1);
      state.current = cursor.page;
      state.nextKind = nextKind(cursor.kind);
      continue;
    }
    if (requests && throttleMilliseconds) await sleep(throttleMilliseconds);
    requests++;
    try {
      const response = await fetchImpl(requestUrl(cursor, pageSize), {
        signal: AbortSignal.timeout(20000), redirect: 'error',
        headers: { 'User-Agent': 'TitleKakkoKariQuestionCollector/1.0 (source-backed party-game questions)' },
      });
      if (!response.ok) {
        errors.push({
          ...(cursor.type === 'search' ? { query: cursor.query } : { category: cursor.category }),
          kind: cursor.kind, status: response.status,
          message: `作品候補を取得できませんでした (${response.status})`,
          retryAfterMilliseconds: retryAfterMilliseconds(response, observedAt.getTime()),
        });
        break;
      }
      const page = pageFromResponse(cursor, await response.json());
      state.queue.splice(index, 1);
      state.current = page;
      state.nextKind = nextKind(cursor.kind);
    } catch (error) {
      errors.push({
        ...(cursor.type === 'search' ? { query: cursor.query } : { category: cursor.category }),
        kind: cursor.kind, status: null, message: error.message,
      });
      break;
    }
  }
  state.visitedCategories = Object.fromEntries(KIND_IDS.map((kind) => [kind, [...visited[kind]]]));
  state.seenPageIds = Object.fromEntries(KIND_IDS.map((kind) => [kind, [...seen[kind]]]));
  const exhausted = !state.current && !state.queue.length;
  if (exhausted && !state.exhaustedAt) state.exhaustedAt = observedAtIso;
  return { candidates, state, exhausted, requests, errors };
}

module.exports = { discoverCandidates, DEFAULT_ROOTS, DEFAULT_REFRESH_MILLISECONDS, WIKIPEDIA_API };

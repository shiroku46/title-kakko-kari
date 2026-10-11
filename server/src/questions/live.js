const { createPublicFetch } = require('./web-fetch');
const { discoverLiveCandidates, LIVE_KINDS } = require('./catalogues');
const { generateWebQuestion } = require('./web-source');
const { createSelectionPolicy } = require('./selection-policy');
const { questionIsValid } = require('./validation');
const { randomInt } = require('node:crypto');

function createLiveQuestionSource({ fetchImpl = createPublicFetch(), discoverImpl = discoverLiveCandidates,
  generateImpl = generateWebQuestion, deadlineMilliseconds = 60000, maxRequests = 64,
  now = Date.now, initialKind = 0 } = {}) {
  const selection = createSelectionPolicy(require('./bank.json').questions);
  const active = new Set(), cooldowns = new Map(), delivered = new Map();
  const titleKey = q => `${q.kind}:${q.realTitle.normalize('NFKC').replace(/[\s\p{P}]/gu,'').toLowerCase()}`;
  const mediaKind = kind => ['novel', 'short-story', 'literary-work'].includes(kind) ? 'novel' : kind;
  let sequence = initialKind, stopped = false, completed = 0, succeeded = 0;
  let lastStartedAt = null, lastCompletedAt = null, lastSuccessfulAt = null, failure = null;

  async function selectQuestion(excludedIds = [], { signal } = {}) {
    if (stopped) throw new Error('ネット検索を停止しました。');
    if (active.size >= 8) throw new Error('ネット検索が混み合っています。少し待ってもう一度検索してください。');
    const controller = new AbortController(); active.add(controller);
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const excluded = new Set(excludedIds), attempted = new Set();
    const history = excludedIds.map(id => delivered.get(id)).filter(Boolean);
    const excludedTitles = new Set(history.map(q => q.title));
    const startKind = sequence++ % LIVE_KINDS.length;
    const page = randomInt(20);
    const counts = Object.fromEntries(LIVE_KINDS.map(kind => [kind, 0]));
    for (const q of history) if (Object.hasOwn(counts, q.kind)) counts[q.kind]++;
    const orderedKinds = LIVE_KINDS.map((_, offset) => LIVE_KINDS[(startKind + offset) % LIVE_KINDS.length])
      .sort((a,b) => counts[a] - counts[b]);
    const lowest = counts[orderedKinds[0]];
    const priority = orderedKinds.filter(kind => counts[kind] === lowest);
    const fallback = orderedKinds.filter(kind => counts[kind] !== lowest);
    // Retry underrepresented media using another engine/page before a medium
    // already used by this room. Count delivered works, never failed searches.
    const searches = [
      ...[0,1].flatMap(pass => priority.map(kind => ({ kind, pass, phase: 0 }))),
      ...[0,1].flatMap(pass => fallback.map(kind => ({ kind, pass, phase: 1 }))),
      ...orderedKinds.map(kind => ({ kind, pass: 2, phase: 2 })),
    ];
    lastStartedAt = new Date(now()).toISOString();
    const catalogueFallbacks = [];
    let pendingUnknown = [];
    let deadlineExpired = false;
    const timeout = setTimeout(() => { deadlineExpired = true; controller.abort(); }, deadlineMilliseconds);
    function selectFallback() {
      const candidates = pendingUnknown.length ? pendingUnknown : catalogueFallbacks;
      const leastUsed = Math.min(...candidates.map(q => counts[mediaKind(q.kind)]));
      return selection.select(candidates.filter(q => counts[mediaKind(q.kind)] === leastUsed));
    }
    function deliver(chosen) {
      // Keep exclusion metadata, never an inventory served to other requests.
      delivered.set(chosen.id, { title: titleKey(chosen), kind: mediaKind(chosen.kind) });
      if (delivered.size > 20000) delivered.delete(delivered.keys().next().value);
      succeeded++; lastSuccessfulAt = new Date(now()).toISOString(); failure = null;
      return chosen;
    }
    let requests = 0;
    const fetchPage = async (url, options = {}) => {
      controller.signal.throwIfAborted();
      const host = new URL(url).hostname;
      if ((cooldowns.get(host) || 0) > now()) throw new Error('取得先の待機時間中です');
      if (++requests > maxRequests) throw new Error('今回の検索上限です');
      const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(10000)]);
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new Error('資料取得が中断されました。'));
        if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      });
      let response;
      try { response = await Promise.race([fetchImpl(url, { ...options, signal }), aborted]); }
      finally { signal.removeEventListener('abort', onAbort); }
      signal.throwIfAborted();
      if (response.status === 429 || response.status === 503) {
        const raw = response.headers.get('retry-after');
        const delay = /^\d+$/u.test(raw || '') ? Number(raw) * 1000 : Date.parse(raw) - now();
        const wait = Number.isFinite(delay) && delay > 0 ? delay : 60000;
        const until = now() + wait;
        cooldowns.set(host, Number.isSafeInteger(until) && until <= 8640000000000000 ? until : now()+60000);
      }
      return response;
    };
    try {
      // A fresh discovery is mandatory on every call, even when a prior call
      // succeeded. There is no bank lookup, failed-collection cooldown, global
      // exhausted inventory or shared pending question for concurrent rooms.
      for (let index = 0; index < searches.length; index++) {
        const search = searches[index];
        const { kind, pass, phase } = search;
        if (requests >= maxRequests) break;
        try {
          if (search.queue) {
            if (!search.queue.length && search.remaining) await search.remaining;
          } else {
            const discovery = await discoverImpl({ kind, pass, page: (page+pass)%20, fetchImpl: fetchPage, signal: controller.signal });
            search.queue = [...discovery.candidates];
            if (discovery.remaining) search.remaining = discovery.remaining.then(result => {
              const queued = new Set(search.queue.map(c => c.url));
              search.queue.unshift(...result.candidates.filter(c => !attempted.has(c.url) && !queued.has(c.url)));
              search.remaining = null;
            }, () => { search.remaining = null; });
          }
        } catch { controller.signal.throwIfAborted(); continue; }
        controller.signal.throwIfAborted();
        const queue = search.queue;
        for (let i = queue.length - 1; i >= 0; i--) {
          const c = queue[i];
          if ((c.kind && mediaKind(c.kind) !== kind) || excluded.has(c.id) || attempted.has(c.url)) queue.splice(i, 1);
        }
        // Examine several different work pages concurrently within the shared
        // request/deadline budget. Slow or invalid pages cannot block another.
        if (queue.length && requests < maxRequests) {
          const batch = queue.splice(0, 3);
          const batchController = new AbortController();
          let chosen;
          const unknown = [];
          pendingUnknown = unknown;
          try {
            chosen = await Promise.any(batch.map(async candidate => {
              attempted.add(candidate.url);
              let q;
              try {
                q = await generateImpl(candidate, { fetchImpl: (url, options = {}) => fetchPage(url, {
                  ...options, signal: AbortSignal.any([batchController.signal, ...(options.signal ? [options.signal] : [])]),
                }) });
              } catch (error) {
                if ((candidate.webDepth || 0) < 2 && Array.isArray(error.additionalCandidates)) {
                  for (const linked of error.additionalCandidates.slice(0, 8)) if (!attempted.has(linked.url) && !excluded.has(linked.id)) {
                    queue.push({ ...linked, discoveryRoute: candidate.discoveryRoute, webDepth: (candidate.webDepth || 0) + 1 });
                  }
                }
                throw error;
              }
              if (mediaKind(q.kind) !== kind || !questionIsValid(q) || excluded.has(q.id) || excludedTitles.has(titleKey(q)) || !selection.isEligible(q)) throw new Error('作品条件を満たしません');
              if (selection.tier(q) !== 0) {
                (candidate.discoveryRoute === 'catalogue' ? catalogueFallbacks : unknown).push(q);
                throw new Error('小規模作品の確認を優先します');
              }
              return q;
            }));
          } catch { /* Try the next source batch when every work is invalid. */ }
          finally { batchController.abort(); }
          controller.signal.throwIfAborted();
          if (!chosen && unknown.length) chosen = selection.select(unknown);
          if (chosen) return deliver(chosen);
        }
        if (queue.length || search.remaining) {
          // Rotate batches across media while retaining untried/late links.
          // Two priority discovery passes must leave budget for fallback media.
          const deferredPhase = phase === 0 && fallback.length ? 2 : phase;
          const nextPhase = searches.findIndex((search, i) => i > index && search.phase > deferredPhase);
          search.phase = deferredPhase;
          searches.splice(nextPhase < 0 ? searches.length : nextPhase, 0, search);
        }
      }
      if (catalogueFallbacks.length) return deliver(selectFallback());
      throw new Error('紹介文を確認できる作品が見つかりませんでした。もう一度ネット検索してください。');
    } catch {
      if (deadlineExpired && !stopped && !signal?.aborted && (pendingUnknown.length || catalogueFallbacks.length)) return deliver(selectFallback());
      const message = stopped ? 'ネット検索を停止しました。' : 'ネット検索先から紹介文を取得できませんでした。もう一度検索してください。';
      failure = { code: controller.signal.aborted ? 'search_timeout' : 'search_failed', message, at: new Date(now()).toISOString() };
      throw new Error(message);
    } finally {
      clearTimeout(timeout); active.delete(controller); completed++; lastCompletedAt = new Date(now()).toISOString();
      signal?.removeEventListener('abort', cancel);
      // Cancel losing discovery routes on success as well as on timeout.
      controller.abort();
    }
  }

  function getStatus() {
    return { enabled: true, mode: 'live', running: active.size > 0, scheduled: false,
      activeRequests: active.size, completedRequests: completed, successfulRequests: succeeded,
      lastStartedAt, lastCompletedAt, lastSuccessfulAt, failure: failure ? { ...failure } : null };
  }
  return { selectQuestion, getStatus, start: () => { stopped = false; },
    stop: () => { stopped = true; for (const c of active) c.abort(); },
    collectNow: () => Promise.resolve({ live: true, message: '出題するたびにネット検索します。' }) };
}

module.exports = { createLiveQuestionSource };

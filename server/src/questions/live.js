const { createPublicFetch } = require('./web-fetch');
const { discoverLiveCandidates, LIVE_KINDS } = require('./catalogues');
const { generateWebQuestion } = require('./web-source');
const { createSelectionPolicy } = require('./selection-policy');
const { questionIsValid } = require('./validation');

function createLiveQuestionSource({ fetchImpl = createPublicFetch(), discoverImpl = discoverLiveCandidates,
  generateImpl = generateWebQuestion, deadlineMilliseconds = 60000, maxRequests = 64,
  now = Date.now, initialKind = 0 } = {}) {
  const selection = createSelectionPolicy();
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
    const page = Math.floor(sequence / LIVE_KINDS.length) % 20;
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
      ...[0,1].flatMap(pass => priority.map(kind => ({ kind, pass }))),
      ...[0,1].flatMap(pass => fallback.map(kind => ({ kind, pass }))),
      ...orderedKinds.map(kind => ({ kind, pass: 2 })),
    ];
    lastStartedAt = new Date(now()).toISOString();
    const timeout = setTimeout(() => controller.abort(), deadlineMilliseconds);
    let requests = 0, finished = false;
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
      for (const { kind, pass } of searches) {
        if (requests >= maxRequests) break;
        let candidates;
        try {
          const discovery = await discoverImpl({ kind, pass, page: (page+pass)%20, fetchImpl: fetchPage, signal: controller.signal });
          candidates = discovery.candidates;
        } catch { controller.signal.throwIfAborted(); continue; }
        const queue = candidates.filter(c => (!c.kind || mediaKind(c.kind) === kind) && !excluded.has(c.id) && !attempted.has(c.url));
        let examined = 0;
        // Examine several different work pages concurrently within the shared
        // request/deadline budget. Slow or invalid pages cannot block another.
        while (queue.length && requests < maxRequests) {
          const batch = queue.splice(0, 3);
          examined += batch.length;
          const batchController = new AbortController();
          let chosen;
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
                    queue.push({ ...linked, webDepth: (candidate.webDepth || 0) + 1 });
                  }
                }
                throw error;
              }
              if (mediaKind(q.kind) !== kind || !questionIsValid(q) || excluded.has(q.id) || excludedTitles.has(titleKey(q)) || !selection.isEligible(q)) throw new Error('作品条件を満たしません');
              return q;
            }));
          } catch { /* Try the next source batch when every work is invalid. */ }
          finally { batchController.abort(); }
          controller.signal.throwIfAborted();
          if (chosen) {
            // Only exclusion metadata is remembered; no synopsis inventory
            // is ever served. Alternate URLs cannot reintroduce a used title.
            delivered.set(chosen.id, { title: titleKey(chosen), kind: mediaKind(chosen.kind) });
            if (delivered.size > 20000) delivered.delete(delivered.keys().next().value);
            finished = true; succeeded++; lastSuccessfulAt = new Date(now()).toISOString(); failure = null;
            return chosen;
          }
          // Reserve discovery capacity for other media/domains rather than
          // spending the entire deadline on a single catalogue's first page.
          if (batch.some(c => c.webDepth > 0) || examined >= 12) break;
        }
      }
      throw new Error('紹介文を確認できる作品が見つかりませんでした。もう一度ネット検索してください。');
    } catch {
      const message = stopped ? 'ネット検索を停止しました。' : 'ネット検索先から紹介文を取得できませんでした。もう一度検索してください。';
      failure = { code: controller.signal.aborted ? 'search_timeout' : 'search_failed', message, at: new Date(now()).toISOString() };
      throw new Error(message);
    } finally {
      clearTimeout(timeout); active.delete(controller); completed++; lastCompletedAt = new Date(now()).toISOString();
      signal?.removeEventListener('abort', cancel);
      // A timed-out transport cannot mutate another request or a future round.
      if (!finished) controller.abort();
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

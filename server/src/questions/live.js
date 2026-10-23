const { createPublicFetch } = require('./web-fetch');
const { discoverLiveCandidates, LIVE_KINDS } = require('./catalogues');
const { generateWebQuestion } = require('./web-source');
const { createSelectionPolicy } = require('./selection-policy');
const { questionIsValid } = require('./validation');
const { getKind } = require('./kinds');

function createLiveQuestionSource({ fetchImpl = createPublicFetch(), discoverImpl = discoverLiveCandidates,
  generateImpl = generateWebQuestion, deadlineMilliseconds = 60000, maxRequests = 64,
  now = Date.now, initialKind = 0 } = {}) {
  const selection = createSelectionPolicy();
  const active = new Set(), cooldowns = new Map(), delivered = new Map();
  const titleKey = q => `${mediaKind(q.kind)}:${q.realTitle.normalize('NFKC').replace(/[\s\p{P}]/gu,'').toLowerCase()}`;
  const mediaKind = kind => ['novel', 'short-story', 'literary-work'].includes(kind) ? 'novel' : kind;
  let sequence = initialKind, stopped = false, completed = 0, succeeded = 0;
  let lastStartedAt = null, lastCompletedAt = null, lastSuccessfulAt = null, failure = null;

  async function selectQuestion(excludedIds = [], { signal, kind: requestedKind, excludedWorks = [], acceptQuestion = () => true } = {}) {
    if (requestedKind !== undefined && (typeof requestedKind !== 'string' || !getKind(requestedKind))) throw new Error('作品のジャンルが不正です');
    if (stopped) throw new Error('ネット検索を停止しました。');
    if (active.size >= 8) throw new Error('ネット検索が混み合っています。少し待ってもう一度検索してください。');
    const controller = new AbortController(); active.add(controller);
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const excluded = new Set(excludedIds), attempted = new Set();
    const history = [...new Map([...excludedIds.map(id => delivered.get(id)).filter(Boolean),
      ...excludedWorks.map(q => ({ title: titleKey(q), kind: mediaKind(q.kind) }))].map(q => [q.title, q])).values()];
    const excludedTitles = new Set(history.map(q => q.title));
    const startKind = sequence++ % LIVE_KINDS.length;
    const page = Math.floor(sequence / LIVE_KINDS.length) % 20;
    const counts = Object.fromEntries(LIVE_KINDS.map(kind => [kind, 0]));
    for (const q of history) if (Object.hasOwn(counts, q.kind)) counts[q.kind]++;
    if (requestedKind !== undefined) counts[requestedKind] ??= 0;
    const orderedKinds = (requestedKind === undefined ? LIVE_KINDS.map((_, offset) => LIVE_KINDS[(startKind + offset) % LIVE_KINDS.length]) : [requestedKind])
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
    const timeout = setTimeout(() => controller.abort(), deadlineMilliseconds);
    let requests = 0;
    const details = { responses: 0, httpErrors: 0, fetchErrors: 0, candidates: 0, workErrors: 0, rejectedWorks: 0, unsuitableWorks: 0, networkCode: null };
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
      catch (error) {
        details.fetchErrors++;
        const code = error.code || error.cause?.code;
        details.networkCode = signal.aborted ? 'ABORTED' :
          ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code) ? code : 'FETCH_ERROR';
        throw error;
      }
      finally { signal.removeEventListener('abort', onAbort); }
      signal.throwIfAborted();
      details.responses++; if (!response.ok || response.status === 202) details.httpErrors++;
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
            details.candidates += search.queue.length;
            if (discovery.remaining) search.remaining = discovery.remaining.then(result => {
              const queued = new Set(search.queue.map(c => c.url));
              const late = result.candidates.filter(c => !attempted.has(c.url) && !queued.has(c.url));
              details.candidates += late.length; search.queue.unshift(...late);
              search.remaining = null;
            }, () => { search.remaining = null; });
          }
        } catch { controller.signal.throwIfAborted(); continue; }
        controller.signal.throwIfAborted();
        const queue = search.queue;
        for (let i = queue.length - 1; i >= 0; i--) {
          const c = queue[i];
          if ((c.kind && (requestedKind === undefined || requestedKind === 'novel' ? mediaKind(c.kind) : c.kind) !== kind) || excluded.has(c.id) || attempted.has(c.url)) queue.splice(i, 1);
        }
        // Examine several different work pages concurrently within the shared
        // request/deadline budget. Slow or invalid pages cannot block another.
        // Reserve the remaining budget for an independent slower route instead
        // of spending it all on fast invalid pages from the first engine.
        if (search.remaining && requests >= Math.ceil(maxRequests / 2)) await search.remaining;
        if (queue.length && requests < maxRequests) {
          const batch = queue.splice(0, 3);
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
                details.workErrors++;
                if ((candidate.webDepth || 0) < 2 && Array.isArray(error.additionalCandidates)) {
                  for (const linked of error.additionalCandidates.slice(0, 8)) if (!attempted.has(linked.url) && !excluded.has(linked.id)) {
                    queue.push({ ...linked, webDepth: (candidate.webDepth || 0) + 1 });
                  }
                }
                throw error;
              }
              if ((requestedKind === undefined || requestedKind === 'novel' ? mediaKind(q.kind) : q.kind) !== kind || !questionIsValid(q) || excluded.has(q.id) || excludedTitles.has(titleKey(q)) || !selection.isEligible(q)) {
                details.rejectedWorks++; throw new Error('作品条件を満たしません');
              }
              if (!acceptQuestion(q)) { details.unsuitableWorks++; throw new Error('未使用のCPU案が不足しています'); }
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
            succeeded++; lastSuccessfulAt = new Date(now()).toISOString(); failure = null;
            return chosen;
          }
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
      throw new Error('紹介文を確認できる作品が見つかりませんでした。もう一度ネット検索してください。');
    } catch {
      const message = stopped ? 'ネット検索を停止しました。' : details.unsuitableWorks ?
        '紹介文に合う未使用のCPUタイトル案を用意できませんでした。別の作品やジャンルを選び直してください。' :
        'ネット検索先から紹介文を取得できませんでした。もう一度検索してください。';
      failure = { code: controller.signal.aborted ? 'search_timeout' : details.unsuitableWorks ? 'cpu_titles_exhausted' : 'search_failed', message, at: new Date(now()).toISOString(), details: { requests, ...details } };
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
      lastStartedAt, lastCompletedAt, lastSuccessfulAt, failure: failure ? { ...failure, details: { ...failure.details } } : null };
  }
  return { selectQuestion, getStatus, start: () => { stopped = false; },
    stop: () => { stopped = true; for (const c of active) c.abort(); },
    collectNow: () => Promise.resolve({ live: true, message: '出題するたびにネット検索します。' }) };
}

module.exports = { createLiveQuestionSource };

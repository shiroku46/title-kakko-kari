const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const timers = require('node:timers/promises');
const { generateQuestion, stripDisambiguation } = require('./generator');
const { SEARCH_KINDS } = require('./web-search');

const execute = promisify(execFile);
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_MAX_REQUESTS = 24;
const DEFAULT_PROVIDERS = ['web', 'wikipedia', 'aozora', 'ndl'];
const WIKIPEDIA_HOST = 'ja.wikipedia.org';
const WIKIPEDIA_INTERVAL_MILLISECONDS = 6500;
const DEFAULT_COOLDOWN_MILLISECONDS = 30000;
const MAX_DATE_TIMESTAMP = 8640000000000000;
const CURL_METADATA = '\n__TITLE_QUESTION_HTTP_STATUS__:';
const sourceCacheKey = {};

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} は1〜${maximum}の整数です`);
  }
  return value;
}

function normalizedTitle(value) {
  return stripDisambiguation(value).replace(/[\s_]+/gu, '').toLocaleLowerCase('ja');
}

function sourceIdentity(value) {
  const webUrl = value?.provider === 'web' ? value.url : value?.sources?.find((s) => s.provider === 'web')?.url;
  if (webUrl) {
    try { return `web:${new URL(webUrl).href}`; } catch { return null; }
  }
  const wikipediaPageId = value?.evidence?.sourceId?.match(/^wikipedia-ja-(\d+)-\d+$/u)?.[1];
  if (wikipediaPageId) return `page:${wikipediaPageId}`;
  const aozoraId = value?.workId || value?.id?.match(/^aozora-(\d+)$/u)?.[1]
    || value?.evidence?.sourceId?.match(/^aozora-(\d+)(?:-|$)/u)?.[1];
  if (aozoraId && /^\d+$/u.test(String(aozoraId))) return `aozora:${aozoraId}`;
  const pageId = value?.discovery?.pageId;
  const id = (Number.isSafeInteger(pageId) && pageId > 0 ? String(pageId) : null)
    || value?.id?.match(/^wiki-ja-(\d+)$/u)?.[1];
  if (id) return `page:${id}`;
  const ndlId = value?.ndl?.recordId || value?.evidence?.sourceId?.match(/^ndl-(.+)$/u)?.[1]
    || value?.id?.match(/^ndl-(.+)$/u)?.[1];
  return typeof ndlId === 'string' && ndlId.trim() ? `ndl:${ndlId.toLowerCase()}` : null;
}

function identityKeys(value) {
  const keys = [];
  const source = sourceIdentity(value);
  if (typeof value?.workIdentity === 'string' && value.workIdentity) keys.push(value.workIdentity);
  if (source) keys.push(source);
  if (typeof value?.id === 'string' && value.id) keys.push(`id:${value.id}`);
  // A title can identify unrelated works by different authors or in different
  // media. Use it only for old fixtures without a verifiable source identity.
  if (!source) {
    const title = value?.realTitle || value?.title;
    if (typeof title === 'string' && title.trim()) keys.push(`title:${normalizedTitle(title)}`);
    for (const alias of value?.aliases || []) {
      if (typeof alias === 'string' && alias.trim()) keys.push(`title:${normalizedTitle(alias)}`);
    }
  }
  const sources = [...(value?.sources || []), ...(value?.ndl?.url ? [{ url: value.ndl.url }] : []),
    ...(value?.provider === 'web' && value.url ? [{ url: value.url, provider: 'web' }] : [])];
  for (const item of sources) {
    try {
      const url = new URL(item.url);
      keys.push(`url:${item.provider === 'web' ? url.href : url.origin + url.pathname}`);
      if (url.hostname === 'ndlsearch.ndl.go.jp' && url.pathname.startsWith('/books/')) {
        keys.push(`ndl:${url.pathname.slice('/books/'.length).toLowerCase()}`);
      }
    } catch (_) { /* A generated question is checked before it can be saved. */ }
  }
  return [...new Set(keys)];
}

function attemptIdentity(value) {
  return `attempt:${value?.provider || 'wikipedia'}:${value?.kind}:${sourceIdentity(value) || value?.id}`;
}

function curlResponse(stdout) {
  const separator = stdout.lastIndexOf(Buffer.from(CURL_METADATA));
  if (separator < 0) throw new Error('資料サイトから応答がありません');
  const metadata = stdout.subarray(separator + CURL_METADATA.length).toString('utf8');
  const match = metadata.match(/^(\d{3})\n__TITLE_QUESTION_RETRY_AFTER__:([^\r\n]*)\s*$/u);
  const status = Number(match?.[1]);
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('資料サイトから応答がありません');
  const retryAfter = match[2].trim();
  return new Response(stdout.subarray(0, separator), {
    status, ...(retryAfter && retryAfter.length <= 128 && { headers: { 'Retry-After': retryAfter } }),
  });
}

function createSourceFetch() {
  // Preserve the managed proxy and CA settings. Node versions differ in whether
  // their built-in fetch reads proxy variables, whereas curl already does.
  const useProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const publicFetch = require('./web-fetch').createPublicFetch();
  const transport = async (value, options = {}) => {
    const url = new URL(value);
    const permitted = (url.hostname === 'ja.wikipedia.org' && url.pathname === '/w/api.php')
      || (url.hostname === 'www.aozora.gr.jp' && (url.pathname === '/index_pages/list_person_all_extended_utf8.zip'
        || /^\/cards\/\d+\/(?:card\d+\.html|files\/[a-zA-Z0-9_.-]+\.html?)$/u.test(url.pathname)))
      || (url.hostname === 'ndlsearch.ndl.go.jp' && url.pathname === '/api/opensearch');
    if (!permitted) return publicFetch(value, options);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) {
      throw new Error('作品資料の取得先を確認できません');
    }
    if (!useProxy) return global.fetch(url.href, { ...options, redirect: 'error' });
    const { stdout } = await execute('curl', [
      '--silent', '--show-error', '--max-time', '25', '--proto', '=https', '--max-redirs', '0',
      '--user-agent', options.headers?.['User-Agent'] || 'TitleKakkoKariQuestionGenerator/1.0',
      '--write-out', `${CURL_METADATA}%{http_code}\n__TITLE_QUESTION_RETRY_AFTER__:%header{retry-after}`, url.href,
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, signal: options.signal });
    return curlResponse(stdout);
  };
  transport.sourceCacheKey = sourceCacheKey;
  return transport;
}

function isRetryable(error) {
  return error?.code === 'QUESTION_REQUEST_BUDGET' || error?.code === 'QUESTION_SOURCE_COOLDOWN'
    || error?.code === 'ENOENT' || error?.name === 'AbortError'
    || error?.name === 'TimeoutError' || [5, 6, 7, 18, 28, 35, 52, 56, 92].includes(error?.code)
    || /\((?:429|5\d\d)\)|fetch failed|timed out|failed to connect|could not resolve|recv failure|empty reply|ECONN|ENOTFOUND|EAI_AGAIN/iu.test(error?.message || '');
}

function cooldownMilliseconds(response, observedAt) {
  const value = response.headers?.get('retry-after')?.trim();
  const delay = value && /^\d+(?:\.\d+)?$/u.test(value)
    ? Number(value) * 1000 : Date.parse(value) - observedAt;
  const wait = Math.max(WIKIPEDIA_INTERVAL_MILLISECONDS, Math.ceil(delay));
  const deadline = observedAt + wait;
  // Honor the site's whole waiting period; only an unrepresentable deadline is
  // invalid. A shorter arbitrary cap would retry before a valid Retry-After.
  return Number.isFinite(delay) && delay > 0 && Number.isSafeInteger(deadline) && deadline <= MAX_DATE_TIMESTAMP
    ? wait
    : DEFAULT_COOLDOWN_MILLISECONDS;
}

function sourceCooldown(status) {
  const error = new Error('Wikipediaの取得制限に達しました。保存した位置から次回の収集で続けます');
  error.code = 'QUESTION_SOURCE_COOLDOWN';
  error.status = status;
  return error;
}

/** Discover new works and append only verified questions. No store or game state is mutated here. */
async function collectQuestions({
  questions = [], state = {}, limit = DEFAULT_BATCH_SIZE, maxRequests = DEFAULT_MAX_REQUESTS,
  fetchImpl = createSourceFetch(), localAI = null, now = () => new Date(),
  throttleMilliseconds = 1000, discoverImpl, generateImpl, validateQuestion = () => true,
  providers = discoverImpl ? ['wikipedia'] : DEFAULT_PROVIDERS, signal, webKinds = SEARCH_KINDS,
} = {}) {
  positiveInteger(limit, '追加件数', 100);
  positiveInteger(maxRequests, '資料取得回数', 300);
  if (!Array.isArray(questions) || !state || typeof state !== 'object' || Array.isArray(state)
      || typeof fetchImpl !== 'function' || (generateImpl && typeof generateImpl !== 'function')
      || typeof validateQuestion !== 'function' || !Number.isFinite(throttleMilliseconds) || throttleMilliseconds < 0) {
    throw new Error('自動収集の設定が不正です');
  }
  if (!Array.isArray(providers) || !providers.length || new Set(providers).size !== providers.length
      || providers.some((provider) => !DEFAULT_PROVIDERS.includes(provider))) {
    throw new Error('自動収集の資料サイトを確認してください');
  }
  if (!Array.isArray(webKinds) || !webKinds.length || webKinds.some((kind) => !SEARCH_KINDS.includes(kind)) || new Set(webKinds).size !== webKinds.length) throw new Error('Web収集ジャンルが不正です');
  let workingState = structuredClone(state);
  const previous = workingState.collector || {};
  const previousPacing = previous.requestPacing?.[WIKIPEDIA_HOST];
  const savedDeadline = (value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_DATE_TIMESTAMP ? value : 0;
  const requestPacing = previousPacing ? { [WIKIPEDIA_HOST]: {
    nextAllowedAt: savedDeadline(previousPacing.nextAllowedAt),
    cooldownUntil: savedDeadline(previousPacing.cooldownUntil),
  } } : {};
  const collectorState = {
    pendingCandidates: Array.isArray(previous.pendingCandidates) ? previous.pendingCandidates : [],
    processedKeys: Array.isArray(previous.processedKeys) ? previous.processedKeys : [],
    rejected: Array.isArray(previous.rejected) ? previous.rejected.slice(-100) : [],
    nextProvider: providers.includes(previous.nextProvider) ? previous.nextProvider : providers[0],
    requestPacing,
    nextWebKind: webKinds.includes(previous.nextWebKind) ? previous.nextWebKind : webKinds[0],
    lastWebDomain: previous.lastWebDomain || null,
    webAttemptsSinceDiscovery: { ...previous.webAttemptsSinceDiscovery },
  };
  // Retain URLs from the previous shared Web checkpoint during the migration
  // to per-genre searches; the old backlog must not disappear or dominate.
  const legacyWebPending = workingState.providers?.web?.pending;
  if (Array.isArray(legacyWebPending) && legacyWebPending.length) {
    for (const candidate of legacyWebPending) {
      if (!collectorState.pendingCandidates.some((item) => item.id === candidate.id)) collectorState.pendingCandidates.push(candidate);
    }
    workingState.providers.web.pending = [];
  }
  if (previous.webValidationVersion !== 2) {
    const oldWebUrls = new Set(collectorState.processedKeys.filter((key) => key.startsWith('web:')).map((key) => key.slice(4)));
    collectorState.processedKeys = collectorState.processedKeys.filter((key) =>
      !/^(?:web:|id:web-|attempt:web:|isbn:|work:)/u.test(key) && !(key.startsWith('url:') && oldWebUrls.has(key.slice(4))));
  }
  collectorState.webValidationVersion = 2;
  const merged = [...questions];
  const known = new Set([...collectorState.processedKeys, ...questions.flatMap(identityKeys)]);
  const processed = new Set(collectorState.processedKeys);
  const attempted = new Set();
  const added = [];
  const rejected = [];
  let discovered = 0;
  let requests = 0;
  let exhausted = false;
  const exhaustedProviders = new Set();
  const exhaustedWebKinds = new Set();
  let lastRequestAt = 0;
  const countedFetch = async (url, options) => {
    signal?.throwIfAborted();
    if (requests >= maxRequests) {
      const error = new Error('今回の資料取得上限に達しました。次の収集で続けます');
      error.code = 'QUESTION_REQUEST_BUDGET';
      throw error;
    }
    const upstreamSignal = options?.signal;
    const combined = signal && upstreamSignal ? AbortSignal.any([signal, upstreamSignal]) : signal || upstreamSignal;
    combined?.throwIfAborted();
    const isWikipedia = new URL(url).hostname === WIKIPEDIA_HOST;
    const pacing = isWikipedia ? (requestPacing[WIKIPEDIA_HOST] ||= { nextAllowedAt: 0, cooldownUntil: 0 }) : null;
    if (pacing?.cooldownUntil > Date.now()) throw sourceCooldown();
    // Explicit zero throttle keeps offline fixtures fast; production spaces all
    // Wikipedia uses, including NDL resolution, across persisted batches.
    const wikipediaInterval = throttleMilliseconds === 0 ? 0 : WIKIPEDIA_INTERVAL_MILLISECONDS;
    const delay = Math.max(0, lastRequestAt + throttleMilliseconds - Date.now(),
      pacing && wikipediaInterval ? pacing.nextAllowedAt - Date.now() : 0);
    if (delay) await timers.setTimeout(delay, undefined, { signal: combined });
    combined?.throwIfAborted();
    requests++;
    lastRequestAt = Date.now();
    if (pacing) pacing.nextAllowedAt = lastRequestAt + wikipediaInterval;
    const response = await fetchImpl(url, { ...options, signal: combined });
    if (pacing && response.status === 429) {
      const receivedAt = Date.now();
      pacing.cooldownUntil = receivedAt + cooldownMilliseconds(response, receivedAt);
      pacing.nextAllowedAt = Math.max(pacing.nextAllowedAt, pacing.cooldownUntil);
      // Do not spend this batch's budget retrying the same throttled origin.
      throw sourceCooldown(429);
    }
    if (pacing) pacing.cooldownUntil = 0;
    return response;
  };
  countedFetch.sourceCacheKey = fetchImpl.sourceCacheKey || fetchImpl;
  const remember = (keys) => {
    for (const key of keys) { known.add(key); processed.add(key); }
  };
  const reject = (candidate, error) => {
    const record = {
      id: candidate?.id || '', title: candidate?.title || '',
      error: String(error?.message || error).slice(0, 250), at: now().toISOString(),
    };
    rejected.push(record);
    collectorState.rejected.push(record);
    collectorState.rejected = collectorState.rejected.slice(-100);
  };
  while (added.length < limit && requests < maxRequests && !signal?.aborted) {
    const providerIndex = providers.indexOf(collectorState.nextProvider);
    const hasPending = (provider) => collectorState.pendingCandidates.some((item) =>
      (item?.provider || 'wikipedia') === provider && !attempted.has(attemptIdentity(item)));
    const provider = providers.slice(providerIndex).concat(providers.slice(0, providerIndex))
      .find((name) => !(name === 'wikipedia' && requestPacing[WIKIPEDIA_HOST]?.cooldownUntil > Date.now())
        && (hasPending(name) || !exhaustedProviders.has(name)));
    if (!provider) break;
    const advanceProvider = () => {
      collectorState.nextProvider = providers[(providers.indexOf(provider) + 1) % providers.length];
    };
    const webByGenre = provider === 'web' && !discoverImpl;
    const webKind = collectorState.nextWebKind;
    const webState = workingState.providers?.web || {};
    const genreState = webState.byKind?.[webKind] || {};
    const domainOf = (item) => { try { return new URL(item.url).hostname; } catch { return null; } };
    const advanceWebKind = () => {
      collectorState.nextWebKind = webKinds[(webKinds.indexOf(webKind) + 1) % webKinds.length];
    };
    const eligible = (item) => (item?.provider || 'wikipedia') === provider && !attempted.has(attemptIdentity(item));
    let pendingIndex = collectorState.pendingCandidates.findIndex((item) => eligible(item) && (!webByGenre || item.kind === webKind));
    if (webByGenre && pendingIndex >= 0 && collectorState.webAttemptsSinceDiscovery[webKind] >= 6 && maxRequests - requests > 1) pendingIndex = -1;
    if (webByGenre && pendingIndex >= 0) {
      const diverse = collectorState.pendingCandidates.findIndex((item) => eligible(item) && item.kind === webKind &&
        domainOf(item) !== collectorState.lastWebDomain);
      if (diverse >= 0) pendingIndex = diverse;
    }
    // With one request left, inspect a queued page rather than discovering a
    // candidate that cannot be checked. Normal turns reserve a fresh genre.
    if (webByGenre && pendingIndex < 0 && maxRequests - requests === 1) pendingIndex = collectorState.pendingCandidates.findIndex(eligible);
    if (pendingIndex < 0) {
      // Reserve a request for checking a plot when the remaining budget allows it.
      const discoveryBudget = Math.min(Math.max(1, Math.ceil((limit - added.length) / 2)), Math.max(1, maxRequests - requests - 1));
      if (discoveryBudget < 1) break;
      let result;
      try {
        const discover = discoverImpl || (provider === 'web' ? require('./web-search').discoverWebCandidates : provider === 'aozora'
          ? require('./aozora').discoverAozoraCandidates : provider === 'ndl'
            ? require('./ndl-discovery').discoverNDLCandidates : require('./discovery').discoverCandidates);
        result = await discover({
          state: webByGenre ? { ...genreState, cooldowns: { ...genreState.cooldowns, ...webState.cooldowns } } : workingState.providers?.[provider] || {},
          limit: webByGenre ? 4 : Math.min(100, Math.max(1, Math.ceil((limit - added.length) / providers.length))),
          maxRequests: webByGenre ? 1 : discoveryBudget, fetchImpl: countedFetch, throttleMilliseconds: 0, provider,
          ...(webByGenre && { kinds: [webKind] }),
        });
      } catch (error) {
        reject(null, error);
        exhaustedProviders.add(provider);
        advanceProvider();
        if (signal?.aborted || error?.code === 'QUESTION_REQUEST_BUDGET') break;
        continue;
      }
      if (!result || !Array.isArray(result.candidates) || !result.state) {
        throw new Error('作品の自動探索結果が不正です');
      }
      workingState.providers = { ...workingState.providers, [provider]: webByGenre
        ? { ...workingState.providers?.web, cooldowns: result.state.cooldowns, byKind: { ...workingState.providers?.web?.byKind, [webKind]: result.state } } : result.state };
      const newlyDiscovered = result.candidates.map((candidate) => ({ ...candidate, provider }));
      if (webByGenre) { collectorState.pendingCandidates.unshift(...newlyDiscovered); collectorState.webAttemptsSinceDiscovery[webKind] = 0; }
      else collectorState.pendingCandidates.push(...newlyDiscovered);
      // Discovery and one candidate generation form a provider's turn. Keep the
      // turn until that first candidate is handled, so an existing backlog in a
      // faster provider cannot fill the batch before newly discovered sources.
      if (!result.candidates.length) { advanceProvider(); if (webByGenre) advanceWebKind(); }
      discovered += result.candidates.length;
      if (result.exhausted && !webByGenre) exhaustedProviders.add(provider);
      exhausted = exhaustedProviders.size === providers.length;
      for (const error of result.errors || []) reject(null, typeof error === 'string' ? new Error(error) : new Error(error.message || error.error || '作品を探索できませんでした'));
      if (!result.candidates.length && (result.errors?.length || !result.requests || result.exhausted)) {
        if (webByGenre) { exhaustedWebKinds.add(webKind); if (exhaustedWebKinds.size === webKinds.length) exhaustedProviders.add(provider); }
        else exhaustedProviders.add(provider);
      }
      continue;
    }
    const [candidate] = collectorState.pendingCandidates.splice(pendingIndex, 1);
    advanceProvider();
    if (webByGenre) { collectorState.webAttemptsSinceDiscovery[webKind] = (collectorState.webAttemptsSinceDiscovery[webKind] || 0) + 1; advanceWebKind(); try { collectorState.lastWebDomain = new URL(candidate.url).hostname; } catch { /* Rejected below. */ } }
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.title !== 'string') {
      reject(candidate, new Error('探索した作品の形式が不正です'));
      continue;
    }
    const keys = identityKeys(candidate);
    const attemptKey = attemptIdentity(candidate);
    if (processed.has(attemptKey)) continue;
    if (keys.some((key) => known.has(key))) { remember(keys); continue; }
    attempted.add(attemptKey);
    try {
      const generate = generateImpl || (candidate.provider === 'web' ? require('./web-source').generateWebQuestion : candidate.provider === 'aozora'
        ? require('./aozora').generateAozoraQuestion : candidate.provider === 'ndl'
          ? require('./ndl-discovery').generateNDLQuestion : generateQuestion);
      const question = await generate(candidate, { fetchImpl: countedFetch, localAI, now });
      if (!question || !validateQuestion(question)) throw new Error('生成した問題の検査に合格しませんでした');
      const generatedKeys = identityKeys(question);
      if (generatedKeys.some((key) => known.has(key))) { remember([...keys, ...generatedKeys]); continue; }
      merged.push(question);
      added.push(question);
      remember([...keys, ...generatedKeys]);
    } catch (error) {
      if (error?.code === 'QUESTION_REQUEST_BUDGET' || signal?.aborted) {
        collectorState.pendingCandidates.unshift(candidate);
        break;
      }
      if (error?.code === 'QUESTION_SOURCE_COOLDOWN') {
        collectorState.pendingCandidates.push(candidate);
        if (error.status === 429) reject(candidate, error);
        continue;
      }
      reject(candidate, error);
      if (candidate.provider === 'web' && Array.isArray(error.additionalCandidates)) {
        for (const next of error.additionalCandidates) {
          if (!identityKeys(next).some((key) => known.has(key)) &&
            !collectorState.pendingCandidates.some((item) => item.id === next.id)) {
            collectorState.pendingCandidates.push({ ...next, webDepth: 1 });
          }
        }
      }
      const retries = (candidate.collectionRetries || 0) + 1;
      if (isRetryable(error)) {
        // Bound repeated Web failures without permanently excluding a site that
        // can be rediscovered in the next search cycle. Other providers retain
        // their existing retry/checkpoint contract.
        if (candidate.provider !== 'web' || retries <= 2) collectorState.pendingCandidates.push({ ...candidate, collectionRetries: retries });
      } else remember([attemptKey]);
    }
  }
  collectorState.processedKeys = [...processed];
  collectorState.lastCollectedAt = now().toISOString();
  workingState.collector = collectorState;
  return { questions: merged, state: workingState, added, rejected, discovered, requests,
    exhausted: exhausted && collectorState.pendingCandidates.length === 0 };
}

module.exports = {
  collectQuestions, createSourceFetch, identityKeys, sourceIdentity, positiveInteger,
  DEFAULT_BATCH_SIZE, DEFAULT_MAX_REQUESTS,
  DEFAULT_PROVIDERS,
  curlResponse,
};

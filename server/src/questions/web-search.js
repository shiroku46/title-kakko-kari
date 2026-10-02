const { KIND_IDS, getKind } = require('./kinds');
const { publicUrl } = require('./web-fetch');
const { decode, text, attributes, hash } = require('./web-source');
const ENGINES = ['duckduckgo', 'bing'];
const ANGLES = ['作品紹介', '新作', '話題', 'インディー'];
const REVISIT_MS = 6 * 60 * 60 * 1000;

function searchQuery(kind, angle, now = new Date()) {
  const label = getKind(kind).label.replace(/・/gu, ' ');
  const content = getKind(kind).contentMode === 'description' ? '作品紹介' : 'あらすじ 内容紹介';
  const prefix = angle === '新作' ? `${now.getFullYear()} 新作 新刊` : angle === '話題' ? `${now.getFullYear()} 話題` : angle === 'インディー' ? '自主制作 インディー 同人' : '';
  return `${prefix} ${label} ${content}`.trim();
}
function searchUrl(engine, query, page) {
  const url = new URL(engine === 'duckduckgo' ? 'https://html.duckduckgo.com/html/' : 'https://www.bing.com/search');
  url.searchParams.set('q', query);
  if (engine === 'duckduckgo') { if (page) url.searchParams.set('s', String(page * 30)); }
  else { url.searchParams.set('format', 'rss'); url.searchParams.set('first', String(page * 10 + 1)); }
  return url.href;
}
function resultUrl(value, base) {
  let url = new URL(decode(value), base);
  if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') {
    url = new URL(url.searchParams.get('uddg'));
  }
  if (/^(?:[^.]+\.)?(?:duckduckgo.com|bing.com|google.com)$/u.test(url.hostname)) throw new Error('検索ページです');
  const result = publicUrl(url.href);
  for (const param of [...result.searchParams.keys()]) {
    if (/^utm_|^(?:ref|ref_|tag|fbclid|gclid)$/iu.test(param)) result.searchParams.delete(param);
  }
  return result.href;
}
function parseResults(html, engine, kind) {
  const raw = [];
  if (engine === 'bing') {
    for (const item of html.matchAll(/<item>([\s\S]*?)<\/item>/gu)) {
      const title = text(item[1].match(/<title>([\s\S]*?)<\/title>/u)?.[1]);
      const link = decode(item[1].match(/<link>([\s\S]*?)<\/link>/u)?.[1]);
      raw.push({ title, link });
    }
  } else {
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
      const a = attributes(match[1]);
      if (a.class?.split(/\s/u).includes('result__a')) raw.push({ title: text(match[2]), link: a.href });
    }
  }
  const seen = new Set();
  const groups = new Map();
  for (const item of raw) {
    try {
      const url = resultUrl(item.link, searchUrl(engine, '', 0));
      if (!item.title || seen.has(url)) continue;
      seen.add(url);
      const domain = new URL(url).hostname;
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain).push({ id: `web-${hash(url)}`, provider: 'web', title: item.title, url, kind });
    } catch { /* Unsupported/nonpublic destinations are not queued. */ }
  }
  // Interleave domains so one shop or popular result does not own the backlog.
  const candidates = [];
  while ([...groups.values()].some((g) => g.length)) {
    for (const group of groups.values()) if (group.length) candidates.push(group.shift());
  }
  return candidates;
}

async function discoverWebCandidates({ state = {}, limit = 4, maxRequests = 2, fetchImpl,
  now = () => new Date() } = {}) {
  const plan = ANGLES.flatMap((_angle, angleIndex) => KIND_IDS.map((kind, kindIndex) => ({ kind, angle: ANGLES[(angleIndex + kindIndex) % ANGLES.length] })));
  let cursor = Number.isSafeInteger(state.cursor) && state.cursor >= 0 ? state.cursor % plan.length : 0;
  let engineIndex = Number.isSafeInteger(state.engineIndex) ? Math.abs(state.engineIndex) % ENGINES.length : 0;
  let page = Number.isSafeInteger(state.page) && state.page >= 0 && state.page <= 2 ? state.page : 0;
  const queued = Array.isArray(state.pending) ? [...state.pending] : [];
  const errors = [];
  let requests = 0;
  const cooldowns = { ...(state.cooldowns || {}) };
  const visited = new Set(Array.isArray(state.visited) ? state.visited : []);
  let completedCycle = Boolean(state.completedCycle);
  const revisitAt = Date.parse(state.revisitAt);
  if (revisitAt > now().getTime() && !queued.length) return { candidates: [], state, requests: 0, exhausted: true };
  if (Number.isFinite(revisitAt) && revisitAt <= now().getTime()) { visited.clear(); completedCycle = false; }
  while (queued.length < limit && requests < maxRequests) {
    const index = ENGINES.findIndex((_engine, offset) => {
      const selected = (engineIndex + offset) % ENGINES.length;
      return !(cooldowns[ENGINES[selected]] > now().getTime());
    });
    if (index < 0) break;
    engineIndex = (engineIndex + index) % ENGINES.length;
    const engine = ENGINES[engineIndex];
    const { kind, angle } = plan[cursor];
    const query = searchQuery(kind, angle, now());
    try {
      requests++;
      const response = await fetchImpl(searchUrl(engine, query, page), { signal: AbortSignal.timeout(15000) });
      if (!response.ok || response.status === 202) {
        const wait = Number(response.headers.get('retry-after')) * 1000;
        cooldowns[engine] = now().getTime() + (Number.isFinite(wait) && wait > 0 ? wait : 30 * 60 * 1000);
        throw new Error(`Web検索が応答しません (${response.status})`);
      }
      const html = await response.text();
      if (/anomaly-modal|captcha|verify you are human|robot check/iu.test(html)) {
        cooldowns[engine] = now().getTime() + 30 * 60 * 1000;
        throw new Error('Web検索サイトが自動取得を制限しています');
      }
      const found = parseResults(html, engine, kind);
      for (const candidate of found) if (!visited.has(candidate.url)) { visited.add(candidate.url); queued.push(candidate); }
      page = found.length >= 10 && page < 2 ? page + 1 : 0;
      if (!page) { cursor = (cursor + 1) % plan.length; if (!cursor) completedCycle = true; }
    } catch (error) {
      if (error.code === 'QUESTION_REQUEST_BUDGET' || error.name === 'AbortError') throw error;
      errors.push({ message: String(error.message).slice(0,200), engine });
      // Retry the same genre with the next engine rather than silently skipping it.
    }
    engineIndex = (engineIndex + 1) % ENGINES.length;
  }
  const candidates = queued.splice(0,limit);
  return { candidates, requests, errors, exhausted: false,
    state: { cursor, engineIndex, page, pending: queued, cooldowns, visited: [...visited].slice(-5000), completedCycle,
      ...(completedCycle && !queued.length && { revisitAt: new Date(now().getTime() + REVISIT_MS).toISOString() }) } };
}
module.exports = { discoverWebCandidates, parseResults, searchQuery, searchUrl, resultUrl, ENGINES };

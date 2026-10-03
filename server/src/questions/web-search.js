const { KIND_IDS, getKind } = require('./kinds');
const { publicUrl } = require('./web-fetch');
const { decode, text, attributes, hash } = require('./web-source');
const ENGINES = ['duckduckgo', 'bing'];
const QUERY_VERSION = 4;
const ANGLES = ['個人制作', '小規模', 'インディー', '埋もれた作品'];
const SEARCH_KINDS = ['novel', 'film', 'game', 'manga', ...KIND_IDS.filter((k) => !['novel','film','game','manga'].includes(k))];
const REVISIT_MS = 6 * 60 * 60 * 1000;

function searchQuery(kind, angle, now = new Date()) {
  const label = getKind(kind).label.replace(/・/gu, ' ');
  const story = getKind(kind).contentMode === 'story';
  const book = ['novel','short-story','literary-work','manga','nonfiction','poem'].includes(kind);
  if (angle === '個人制作') {
    if (kind === 'game') return 'インディー ゲーム ストーリー パブリッシャー 販売 -フリーゲーム -個人制作';
    if (kind === 'film') return '単館公開 映画 あらすじ 配給';
    if (kind === 'manga') return '漫画 短編集 単行本 内容紹介';
    if (book) return `小出版社 ${label} 内容紹介`;
    return `個人制作 ${label} 作品紹介`;
  }
  if (angle === 'インディー' || angle === '小規模') {
    const small = angle === '小規模';
    if (kind === 'game') return `インディー ゲーム ストーリー パブリッシャー 販売 -フリーゲーム -個人制作 -攻略`;
    if (kind === 'film') return `単館公開 映画 あらすじ 配給 -作り方 -制作ガイド`;
    if (kind === 'manga') return `漫画 短編集 単行本 内容紹介 -同人誌 -描き方`;
    if (book) return `小出版社 ${label} 内容紹介 -同人誌 -自費出版`;
    return `${small ? '小規模' : '自主制作'} ${label} ${story ? 'あらすじ' : '作品紹介'}`;
  }
  if (angle === '埋もれた作品') return `隠れた ${label} ${story ? 'あらすじ' : '作品紹介'}`;
  if (angle === '作品紹介') {
    if (kind === 'game') return 'アドベンチャーゲーム ストーリー 公式サイト';
    if (['film','anime','drama'].includes(kind)) return `${label} ストーリー 公式サイト`;
    if (kind === 'manga') return '漫画 電子書籍 1巻';
    return `${label} ${story ? '内容紹介' : '作品紹介'}`;
  }
  if (angle === '新作') return `${now.getFullYear()} ${book ? '新刊' : '新作'} ${label} ${story ? 'あらすじ' : '作品紹介'}`;
  if (angle === '話題') return `${now.getFullYear()} ${label} ${story ? 'あらすじ' : '作品紹介'}`;
  return `${kind === 'game' ? 'インディー' : book ? '同人' : '自主制作'} ${label} ${story ? 'ストーリー' : '作品紹介'}`;
}
function searchUrl(engine, query, page) {
  if (engine === 'yahoo') {
    const url = new URL('https://search.yahoo.co.jp/search');
    url.searchParams.set('p', query); url.searchParams.set('b', String(page * 10 + 1));
    return url.href;
  }
  const url = new URL(engine === 'duckduckgo' ? 'https://html.duckduckgo.com/html/' : 'https://www.bing.com/search');
  url.searchParams.set('q', query);
  if (engine === 'duckduckgo') { url.searchParams.set('kl', 'jp-jp'); if (page) url.searchParams.set('s', String(page * 30)); }
  else { url.searchParams.set('format', 'rss'); url.searchParams.set('first', String(page * 10 + 1));
    url.searchParams.set('setlang', 'ja'); url.searchParams.set('cc', 'JP'); url.searchParams.set('mkt', 'ja-JP'); }
  return url.href;
}
function resultUrl(value, base) {
  let url = new URL(decode(value), base);
  if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') {
    url = new URL(url.searchParams.get('uddg'));
  }
  if (/^(?:[^.]+\.)?(?:duckduckgo.com|bing.com|google.com)$/u.test(url.hostname)) throw new Error('検索ページです');
  if (/^(?:search|support)\.yahoo(?:\.co)?\.jp$|^www\.yahoo\.co\.jp$/u.test(url.hostname)) throw new Error('検索ページです');
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
      if (a.class?.split(/\s/u).includes('result__a') || engine === 'yahoo' && a.ping?.startsWith('/xts/')) {
        raw.push({ title: text(match[2]), link: a.href });
      }
    }
  }
  const seen = new Set();
  const groups = new Map();
  for (const item of raw) {
    try {
      const url = resultUrl(item.link, searchUrl(engine, '', 0));
      if (!item.title || seen.has(url) || (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.title) &&
        !/game|steam|xbox|playstation|movie|film|comic|manga|novel|book/iu.test(item.title))) continue;
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
  now = () => new Date(), kinds = SEARCH_KINDS } = {}) {
  if (!Array.isArray(kinds) || !kinds.length || kinds.some((kind) => !KIND_IDS.includes(kind))) throw new Error('検索ジャンルが不正です');
  const plan = ANGLES.flatMap((angle) => [...new Set(kinds)].map((kind) => ({ kind, angle })));
  const migrated = state.queryVersion !== QUERY_VERSION;
  let cursor = !migrated && Number.isSafeInteger(state.cursor) && state.cursor >= 0 ? state.cursor % plan.length : 0;
  let engineIndex = Number.isSafeInteger(state.engineIndex) ? Math.abs(state.engineIndex) % ENGINES.length : 0;
  let page = !migrated && Number.isSafeInteger(state.page) && state.page >= 0 && state.page <= 2 ? state.page : 0;
  const queued = !migrated && Array.isArray(state.pending) ? [...state.pending] : [];
  // Relegate old broad-search URLs after the new search without deleting them.
  const legacyPending = migrated && Array.isArray(state.pending) ? [...state.pending] : [];
  const errors = [];
  let requests = 0;
  const cooldowns = { ...(state.cooldowns || {}) };
  const visited = new Set(Array.isArray(state.visited) ? state.visited : []);
  let completedCycle = !migrated && Boolean(state.completedCycle);
  const revisitAt = migrated ? NaN : Date.parse(state.revisitAt);
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
      // Change the query after one result page; the pending results are kept.
      // Deep pagination of a broad query otherwise entrenches one result type.
      page = 0;
      if (!page) { cursor = (cursor + 1) % plan.length; if (!cursor) completedCycle = true; }
      engineIndex = 0;
    } catch (error) {
      if (error.code === 'QUESTION_REQUEST_BUDGET' || error.name === 'AbortError') throw error;
      errors.push({ message: String(error.message).slice(0,200), engine });
      // Retry the same genre with the next engine rather than silently skipping it.
      engineIndex = (engineIndex + 1) % ENGINES.length;
    }
  }
  queued.push(...legacyPending);
  const candidates = queued.splice(0,limit);
  return { candidates, requests, errors, exhausted: false,
    state: { queryVersion: QUERY_VERSION, cursor, engineIndex, page, pending: queued, cooldowns, visited: [...visited].slice(-5000), completedCycle,
      ...(completedCycle && !queued.length && { revisitAt: new Date(now().getTime() + REVISIT_MS).toISOString() }) } };
}
module.exports = { discoverWebCandidates, parseResults, searchQuery, searchUrl, resultUrl, ENGINES, SEARCH_KINDS, QUERY_VERSION };

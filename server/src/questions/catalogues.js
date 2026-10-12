const { searchQuery, searchUrl, parseResults } = require('./web-search');
const { text, attributes, hash } = require('./web-source');
const { publicUrl } = require('./web-fetch');
const { isbnIsValid } = require('./distribution-policy');
const { shuffle } = require('../utils/shuffle');

const LIVE_KINDS = ['novel', 'film', 'game', 'manga'];
const LIVE_ENGINES = ['yahoo', 'bing', 'duckduckgo'];
const SEARCH_ANGLES = { novel: ['短編集', '中編', '文芸', '翻訳'], film: ['ミニシアター', '少数館', '独立系', '地方上映'],
  game: ['アドベンチャー', 'ノベルゲーム', '探索', '物語重視'], manga: ['読み切り', '作品集', '短編', '文芸'] };

// Discovery entry points, not a stock of works. Every response is searched for
// current links, and every chosen work is independently fetched and verified.
function catalogueUrl(kind, page) {
  if (['short-story', 'literary-work'].includes(kind)) kind = 'novel';
  if (kind === 'novel' || kind === 'manga') return `https://books.rakuten.co.jp/search?sitem=${encodeURIComponent(kind==='manga'?'漫画 短編集':'小説')}&g=${kind==='manga'?'001001':'001004'}&s=4&e=1&o=${page*30}`;
  if (kind === 'film') return `https://www.cinematoday.jp/movie/?page=${page+1}`;
  return `https://store.steampowered.com/search/?tags=492,21&category1=998&supportedlang=japanese&sort_by=Released_DESC&l=japanese&page=${page+1}`;
}

function catalogueLinks(html, base, kind) {
  const host = new URL(base).hostname;
  const patterns = { 'books.rakuten.co.jp': /^\/rb\/\d+\/$/u, 'www.cinematoday.jp': /^\/movie\/T\d+$/u,
    'store.steampowered.com': /^\/app\/\d+(?:\/[^/]*)?\/?$/u };
  const links = new Map();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const a = attributes(m[1]);
    if (!a.href) continue;
    try {
      const url = publicUrl(new URL(a.href, base).href);
      if (url.hostname !== host || !patterns[host]?.test(url.pathname)) continue;
      url.search = host === 'store.steampowered.com' ? '?l=japanese' : '';
      const title = text(a.title || m[2].match(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/iu)?.[1] || m[2]);
      if (!title || title.length < 2 || title.length > 300 || links.has(url.href)) continue;
      links.set(url.href, { id: `web-${hash(url.href)}`, provider: 'web', kind, title, url: url.href });
    } catch { /* Only exact public work links from this catalogue. */ }
  }
  return [...links.values()].slice(0, 60);
}

async function discoverLiveCandidates({ kind, pass = 0, page = 0, fetchImpl, signal }) {
  const engine = LIVE_ENGINES[pass % LIVE_ENGINES.length];
  const angle = pass < 2 ? '小規模' : 'インディー';
  const angles = SEARCH_ANGLES[['short-story', 'literary-work'].includes(kind) ? 'novel' : kind];
  const query = `${searchQuery(kind, angle)} ${angles[(page + pass) % angles.length]}`;
  const catalogue = catalogueUrl(kind, page);
  const routes = [
    { url: searchUrl(engine, query, page % 4), parse: html => parseResults(html, engine, kind) },
    { url: catalogue, parse: html => catalogueLinks(html, catalogue, kind) },
  ];
  if (['novel', 'short-story', 'literary-work', 'manga'].includes(kind)) {
    // Use the publisher's current public search protocol, independent of the
    // engine/store. The ISBN page still supplies all work and story evidence.
    const year = new Date().getUTCFullYear() - 1 - Math.floor(page / 3) % 3;
    routes.push({ url: 'https://www.hanmoto.com/bd/search/query.json', request: { method: 'POST', body: JSON.stringify({
      categoryname: 'search/top', part: year, offset: page % 3 * 20, rowmax: 20,
      conds: { keyword: { search: ['manga', 'short-story'].includes(kind) ? '短編' : '物語' },
        genre: { checked: [kind === 'manga' ? '43' : '01'] }, salesdate: { from: `${year}-01-01`, to: `${year}-12-31` } },
    }) }, parse: json => {
      const result = JSON.parse(json);
      if (result.result !== true || !Array.isArray(result.data?.list)) throw new Error('書籍検索の応答が不正です');
      const seen = new Set(), candidates = [];
      for (const item of result.data.list.slice(0, 60)) {
        if (typeof item?.isbn !== 'string' || !/^(978|979)\d{10}$/u.test(item.isbn) || !isbnIsValid(item.isbn) || seen.has(item.isbn) ||
          !/^[A-Za-z0-9_-]{8}$/u.test(item.uniq || '') || !/^\d{8,14}$/u.test(item.lastupdated || '')) continue;
        seen.add(item.isbn);
        const reversed = [...item.uniq].reverse().join('');
        const url = `https://www.hanmoto.com/bd/book/uniqs/${reversed.slice(0,2)}/${reversed.slice(2,4)}/${reversed.slice(4,6)}/book.${item.uniq}.${item.lastupdated}.json`;
        candidates.push({ id: `web-${hash(url)}`, provider: 'web', kind, isbn: item.isbn, url });
      }
      return candidates;
    } });
  }
  const results = Array(routes.length);
  const tasks = routes.map(async (route, index) => {
    try {
      const response = await fetchImpl(route.url, { ...route.request, signal });
      if (!response.ok || response.status === 202) throw new Error('作品検索先が応答しません');
      const html = await response.text();
      if (/anomaly-modal|verify you are human|<title[^>]*>[^<]*(?:captcha|access denied)/iu.test(html)) throw new Error('検索先が自動取得を制限しています');
      const candidates = route.parse(html);
      results[index] = { status: 'fulfilled', value: candidates };
      return candidates;
    } catch (reason) {
      results[index] = { status: 'rejected', reason };
      throw reason;
    }
  });
  const complete = Promise.allSettled(tasks);
  await Promise.race([complete, Promise.any(tasks.map(async task => {
    const candidates = await task;
    if (!candidates.length) throw Error('作品リンクがありません');
    return candidates;
  })).catch(() => {})]);
  function collect() {
    const candidates = [], seen = new Set();
    // Interleave the whole-web results and the work catalogue, so neither route
    // monopolizes source attempts. Site errors never prevent the other route.
    const groups = results.filter(r => r.status === 'fulfilled').map(r => shuffle(r.value));
    while (groups.some(g => g.length)) for (const group of groups) {
      const candidate = group.shift();
      if (candidate && !seen.has(candidate.url)) { seen.add(candidate.url); candidates.push(candidate); }
    }
    return { candidates, errors: results.filter(r => r.status === 'rejected').length };
  }
  const ready = collect();
  // Keep the other route for later instead of discarding slower valid works.
  return { ...ready, ...(results.filter(Boolean).length < routes.length && { remaining: complete.then(collect) }) };
}

module.exports = { discoverLiveCandidates, catalogueUrl, catalogueLinks, LIVE_KINDS, LIVE_ENGINES };

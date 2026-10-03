const { searchQuery, searchUrl, parseResults } = require('./web-search');
const { text, attributes, hash } = require('./web-source');
const { publicUrl } = require('./web-fetch');

const LIVE_KINDS = ['novel', 'film', 'game', 'manga'];
const LIVE_ENGINES = ['yahoo', 'bing', 'duckduckgo'];

// Discovery entry points, not a stock of works. Every response is searched for
// current links, and every chosen work is independently fetched and verified.
function catalogueUrl(kind, page) {
  if (kind === 'novel') return `https://kakuyomu.jp/search?q=${encodeURIComponent('短編')}&order=published_at&page=${page+1}`;
  if (kind === 'film') return `https://motion-gallery.net/categories/Film?page=${page+1}`;
  if (kind === 'game') return `https://store.steampowered.com/search/?tags=492,21&category1=998&supportedlang=japanese&sort_by=Released_DESC&l=japanese&page=${page+1}`;
  return `https://booth.pm/ja/browse/${encodeURIComponent('漫画')}?tags%5B%5D=${encodeURIComponent('創作漫画')}&sort=new&page=${page+1}`;
}

function catalogueLinks(html, base, kind) {
  const host = new URL(base).hostname;
  const patterns = { 'kakuyomu.jp': /^\/works\/\d+$/u, 'motion-gallery.net': /^\/projects\/[\w-]+$/u,
    'store.steampowered.com': /^\/app\/\d+(?:\/[^/]*)?\/?$/u, 'booth.pm': /^\/ja\/items\/\d+$/u };
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
  const angle = pass < 2 ? '個人制作' : 'インディー';
  const query = searchQuery(kind, angle).replace(/(映画 あらすじ)$/u, '$1 -作り方 -方法 -募集');
  const catalogue = catalogueUrl(kind, page);
  const routes = [
    { url: searchUrl(engine, query, page % 4), parse: html => parseResults(html, engine, kind) },
    { url: catalogue, parse: html => catalogueLinks(html, catalogue, kind) },
  ];
  const results = await Promise.allSettled(routes.map(async route => {
    const response = await fetchImpl(route.url, { signal });
    if (!response.ok || response.status === 202) throw new Error('作品検索先が応答しません');
    const html = await response.text();
    if (/anomaly-modal|verify you are human|<title[^>]*>[^<]*(?:captcha|access denied)/iu.test(html)) throw new Error('検索先が自動取得を制限しています');
    return route.parse(html);
  }));
  const candidates = [], seen = new Set();
  // Interleave the whole-web results and the work catalogue, so neither route
  // monopolizes source attempts. Site errors never prevent the other route.
  const groups = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  while (groups.some(g => g.length)) for (const group of groups) {
    const candidate = group.shift();
    if (candidate && !seen.has(candidate.url)) { seen.add(candidate.url); candidates.push(candidate); }
  }
  return { candidates, errors: results.filter(r => r.status === 'rejected').length };
}

module.exports = { discoverLiveCandidates, catalogueUrl, catalogueLinks, LIVE_KINDS, LIVE_ENGINES };

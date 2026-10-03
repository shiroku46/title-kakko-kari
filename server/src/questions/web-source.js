const { createHash } = require('node:crypto');
const { redactTitle, summarizeExtractively } = require('./generator');
const { getKind } = require('./kinds');
const { publicUrl } = require('./web-fetch');
const { MIN_LENGTH, MAX_LENGTH, EXCLUDED_SECTION } = require('./quality');
const { requirePlayableTitle } = require('./title-policy');

function decode(value) {
  return String(value || '').replace(/&#(x[\da-f]+|\d+);/giu, (_m, number) => {
    const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/gu, (_m, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[name]));
}
function text(value) {
  return decode(String(value || '').replace(/<!--[\s\S]*?-->/gu, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
    .replace(/<br\s*\/?\s*>|<\/p\s*>|<\/div\s*>/giu, '\n').replace(/<[^>]*>/gu, ' '))
    .normalize('NFKC').replace(/[\u200B-\u200F\uFEFF]/gu, '').replace(/[ \t]+/gu, ' ').trim();
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)]
    .map((m) => [m[1].toLowerCase(), decode(m[2] ?? m[3])]));
}
function headingText(markup) {
  return text(markup) || [...markup.matchAll(/<img\b[^>]*>/giu)].map((m) => attributes(m[0]).alt || '').join(' ').trim();
}
function metadata(html) {
  const result = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const a = attributes(match[0]);
    if (a.property || a.name) result[(a.property || a.name).toLowerCase()] = a.content || '';
  }
  return result;
}
const TYPE_KIND = { Book: 'literary-work', Movie: 'film', TVSeries: 'drama', VideoGame: 'game',
  MusicAlbum: 'album', MusicRecording: 'song', MusicComposition: 'music-work', Painting: 'artwork', Sculpture: 'artwork' };
const GENRE = { novel: /小説|ノベル|novel/iu, 'short-story': /短編|短篇/iu,
  'literary-work': /文学|童話|児童書|小説/iu, film: /映画|劇場|movie|film/iu,
  manga: /漫画|マンガ|コミック|manga/iu, anime: /アニメ|animation/iu,
  game: /ゲーム|game/iu, play: /舞台|戯曲|演劇/iu, drama: /ドラマ|tv series/iu,
  song: /楽曲|歌曲|シングル/iu, album: /アルバム/iu, 'music-work': /音楽|作曲|交響曲/iu,
  poem: /詩集|詩作品/iu, artwork: /絵画|美術|彫刻/iu, nonfiction: /書籍|ノンフィクション|エッセイ|随筆/iu };
const CONTENT_HEADING = /^(?:あらすじ(?:・(?:概要|内容紹介))?|作品内容|内容紹介|作品紹介|商品説明|書籍紹介|ストーリー|物語|introduction|story|synopsis|description|about)(?:[\s：:].*)?$/iu;
const ARTICLE_TITLE = /ネタバレ|考察|徹底解説|レビュー|感想|死亡説|インタビュー|攻略(?:法|情報|のコツ)|今月の第|特集|紹介された作品|プロフィール|記事一覧|クーポン|今だけ|[0-9]+巻無料|キャンペーン|[0-9]{4}年[0-9]{1,2}月号/iu;
const NON_WORK_PATH = /\/(?:author|authors|profile|profiles|category|categories|tag|tags|search|ranking|gameguide)(?:\/|$)/iu;
const GENERIC_HEADING = /^(?:予告編|ニュース|お知らせ|作品紹介|ストーリー|あらすじ|キャスト|スタッフ|トップ|ホーム|NEWS|STORY|TRAILER|INTRODUCTION)$/iu;
const LIST_TITLE = /おすすめ(?:の)?\d*|ランキング|一覧|まとめ|新刊情報|発売予定|作品検索|検索結果|総合サイト|キャンペーン|クーポン|今だけ|[0-9]+巻無料|編集者が推す|第1巻はスゴイ|best\s*\d+|top\s*\d+/iu;
function canonicalTitle(value) {
  return text(text(value).replace(/【[^】]*(?:限定特典|電子限定|デジタル版限定|無料お試し|期間限定無料)[^】]*】/gu, '')
    .replace(/^[『「](.+)[』」]$/u, '$1'));
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const key = (value) => text(value).replace(/[\s\p{P}]/gu, '').toLowerCase();
function named(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map(named).filter(Boolean).join('、');
  return value && typeof value.name === 'string' ? text(value.name) : '';
}
function structuredWorks(html) {
  const works = [];
  let visited = 0;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 25 || ++visited > 5000) return;
    if (Array.isArray(value)) return value.slice(0,5000).forEach((item) => visit(item, depth+1));
    const types = [value['@type']].flat().filter((t) => typeof t === 'string').map((t) => t.replace(/^https?:\/\/schema.org\//u, ''));
    const type = types.find((t) => TYPE_KIND[t] || (t === 'Product' && (value.isbn || /book/i.test(named(value.category)))));
    if (type && typeof value.name === 'string') works.push({ ...value, workType: type });
    if (value['@graph']) visit(value['@graph'],depth+1);
    if (value.mainEntity) visit(value.mainEntity,depth+1);
  }
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (++scripts > 100) break;
    if (attributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try { visit(JSON.parse(match[2].trim())); } catch { /* Invalid structured data is not work evidence. */ }
  }
  return works;
}

function introductionMarkup(html) {
  const source = html.replace(/<!--[\s\S]*?-->/gu, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, '');
  const stack = [];
  const output = [];
  let cursor = 0;
  let suppressed = 0;
  let tokens = 0;
  for (const token of source.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/giu)) {
    if (++tokens > 20000 || stack.length > 128) throw new Error('作品紹介のHTML構造が複雑すぎます');
    if (!suppressed) output.push(source.slice(cursor, token.index));
    const name = token[1].toLowerCase();
    if (token[0].startsWith('</')) {
      const hiddenBefore = suppressed > 0;
      const index = stack.findLastIndex((item) => item.name === name);
      if (index >= 0) for (const frame of stack.splice(index)) if (frame.excluded) suppressed--;
      if (!hiddenBefore && !suppressed) output.push(token[0]);
    } else {
      const a = attributes(token[0]);
      const excluded = /^(?:nav|footer|aside|form|button|table|ul|ol)$/u.test(name) ||
        /\shidden(?:\s|=|>)/iu.test(token[0]) || a['aria-hidden'] === 'true' || /^(?:navigation|complementary|contentinfo)$/u.test(a.role || '') ||
        /(?:^|[-_\s])(?:reviews?|ratings?|badges?|recommend(?:ations)?|related|ranking|cart|purchase|price|profile|breadcrumb|navigation|toc|copyright|social|share|advert(?:isement)?|banner|metadata|specifications?|bibliograph\w*|staff|cast|credits|lyrics)(?:$|[-_\s])|author[-_]?(?:bio|profile)|track[-_]list/iu.test(`${a.id || ''} ${a.class || ''}`);
      const empty = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/u.test(name) || token[0].endsWith('/>');
      if (!suppressed && !excluded) output.push(token[0]);
      if (!empty) { stack.push({ name, excluded }); if (excluded) suppressed++; }
    }
    cursor = token.index + token[0].length;
  }
  if (!suppressed) output.push(source.slice(cursor));
  return output.join('');
}

function sectionContent(markup) {
  const headings = [...markup.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu)].slice(0,250);
  const pieces = [];
  let cursor = 0;
  let excludedDepth = null;
  for (const heading of headings) {
    if (excludedDepth === null) pieces.push(markup.slice(cursor, heading.index));
    const depth = Number(heading[1]);
    if (excludedDepth !== null && depth <= excludedDepth) excludedDepth = null;
    if (excludedDepth === null && EXCLUDED_SECTION.test(headingText(heading[2]))) excludedDepth = depth;
    cursor = heading.index + heading[0].length;
  }
  if (excludedDepth === null) pieces.push(markup.slice(cursor));
  return text(pieces.join('\n'));
}

function introductionSections(html) {
  const cleaned = introductionMarkup(html);
  const headings = [...cleaned.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu)].slice(0,250);
  const sections = [];
  const ancestors = [];
  const excludedRanges = headings.filter((h) => EXCLUDED_SECTION.test(headingText(h[2]))).map((h) => ({
    start: h.index, end: headings.find((next) => next.index > h.index && Number(next[1]) <= Number(h[1]))?.index ?? cleaned.length,
  }));
  for (let i = 0; i < headings.length; i++) {
    const heading = headingText(headings[i][2]);
    const depth = Number(headings[i][1]);
    while (ancestors.length && ancestors.at(-1).depth >= depth) ancestors.pop();
    const excluded = EXCLUDED_SECTION.test(heading) || ancestors.some((parent) => parent.excluded);
    ancestors.push({ depth, excluded });
    if (excluded || !CONTENT_HEADING.test(heading)) continue;
    const start = headings[i].index + headings[i][0].length;
    const next = headings.slice(i + 1).find((h) => Number(h[1]) <= Number(headings[i][1]));
    const content = sectionContent(cleaned.slice(start, Math.min(next?.index ?? cleaned.length, start+40000)));
    if (content) sections.push({ section: heading, content });
  }
  for (const match of cleaned.matchAll(/<(div|section|p)\b([^>]*)>/giu)) {
    if (sections.length >= 30) break;
    if (excludedRanges.some((range) => match.index >= range.start && match.index < range.end)) continue;
    const a = attributes(match[2]);
    if (/(?:^|[-_\s])(?:synopsis|story|introduction|description|summary|outline)(?:$|[-_\s])|productDescription/iu.test(`${a.id || ''} ${a.class || ''}`)) {
      const start = match.index + match[0].length;
      const tags = new RegExp(`<\\/?${match[1]}\\b[^>]*>`, 'giu');
      tags.lastIndex = start;
      let depth = 1;
      let end;
      while ((end = tags.exec(cleaned))) {
        depth += end[0].startsWith('</') ? -1 : 1;
        if (!depth) break;
      }
      const content = end ? sectionContent(cleaned.slice(start, Math.min(end.index,start+40000))) : '';
      if (content) sections.push({ section: /story|synopsis/iu.test(`${a.id || ''} ${a.class || ''}`) ? 'ストーリー' : '作品紹介', content });
    }
  }
  return sections.sort((a,b) => (/(?:あらすじ|ストーリー|物語|story|synopsis)/iu.test(b.section) ? 1 : 0) -
    (/(?:あらすじ|ストーリー|物語|story|synopsis)/iu.test(a.section) ? 1 : 0));
}

function linkedCandidates(html, baseUrl, kind, { onlyStory = false } = {}) {
  const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1] || html)
    .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/giu, '');
  const candidates = new Map();
  for (const match of main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const a = attributes(match[1]);
    const imageAlt = match[2].match(/<img\b[^>]*>/iu)?.[0];
    const title = text(match[2]) || (imageAlt && attributes(imageAlt).alt);
    if (!a.href || a.hreflang || /interlanguage|social|share/iu.test(a.class || '') || !title || title.length < 2 || title.length > 150 ||
      /小売希望価格|\d+円|^(?:SHARE|RSS|Facebook|English|Deutsch|日本語|広告)$/iu.test(title) ||
      /^(?:トップ|ホーム|検索|詳しく|詳細|続きを読む|もっと見る|次|前|購入|カート|ログイン)/u.test(title)) continue;
    try {
      const url = publicUrl(new URL(a.href, baseUrl).href);
      if (/で(?:見る|探す|購入)/u.test(title) && !/\/(?:books|book|comic|product|item|dp)\//iu.test(url.pathname)) continue;
      if (onlyStory && !/\/(?:story|synopsis|introduction|about)(?:[/.]|$)/iu.test(url.pathname)) continue;
      if (url.href === baseUrl || url.pathname === '/' || NON_WORK_PATH.test(url.pathname) ||
        /\.(?:jpg|png|pdf|zip)$/iu.test(url.pathname) || /rss|feed|bookmark/iu.test(url.pathname) ||
        /^(?:.*こちら|.*サービス|.*書影)$/u.test(title)) continue;
      const score = /story|synopsis|introduction|about|comic|manga|books|product|works|shinkan|\/dp\//iu.test(url.pathname) ? 3
        : /<img|<h[2-6]/iu.test(match[2]) ? 2 : /book|item/iu.test(url.pathname) ? 1 : 0;
      if (!score) continue;
      for (const param of [...url.searchParams.keys()]) if (/^utm_|^(?:ref|ref_|tag|fbclid|gclid)$/iu.test(param)) url.searchParams.delete(param);
      candidates.set(url.href, { id: `web-${hash(url.href)}`, provider: 'web', title, url: url.href, kind, score });
    } catch { /* Only public HTTPS links can become candidates. */ }
  }
  return [...candidates.values()].sort((a,b) => b.score-a.score).slice(0,8).map(({ score, ...candidate }) => candidate);
}

function extractWebWork(html, url, hintKind) {
  const meta = metadata(html);
  if (/nosnippet|noarchive|noai|none|max-snippet\s*:\s*0/iu.test(meta.robots || '') ||
    /captcha|verify you are human|アクセスが集中|ログインが必要|robot check/iu.test(text(html).slice(0,1000))) {
    throw new Error('公開の作品紹介を取得できません');
  }
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu)].map((m) => headingText(m[1])).filter(Boolean);
  const pageTitle = text(meta['og:title'] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]);
  if (NON_WORK_PATH.test(new URL(url).pathname) || /^(?:profile|article)$/iu.test(meta['og:type'] || '') && /プロフィール|ライター|著者一覧/u.test(pageTitle) ||
      LIST_TITLE.test(pageTitle) || ARTICLE_TITLE.test(pageTitle)) throw new Error('記事・一覧・人物ページは作品として採用しません');
  const works = structuredWorks(html);
  if (works.length > 1) throw new Error('複数作品の一覧はお題に使用しません');
  const structured = works[0];
  const cleanTitle = (value) => {
    const raw = value.split(/\s*[|｜]\s*/u)[0].trim();
    const quoted = raw.match(/^(?:(?:映画|劇場版|TVアニメ|アニメ|ゲーム|想定科学ADV|アドベンチャーゲーム)\s*)?[『「](.+)[』」](?:\s*(?:公式.*|official\s*(?:web\s*site|site).*)?)$/iu);
    return (quoted?.[1] || raw.replace(/\s*(?:[-–—]\s*)?(?:公式サイト|公式ホームページ|オフィシャルサイト).*$/u, '')).trim();
  };
  const titleFromPage = cleanTitle(pageTitle);
  const heading = headings.find((h) => !GENERIC_HEADING.test(h) && key(titleFromPage).includes(key(cleanTitle(h)))) || '';
  let realTitle = structured ? text(structured.name) : /[『「].+[』」].*(?:公式|official)/iu.test(pageTitle) ? titleFromPage : heading ? cleanTitle(heading) : titleFromPage;
  if (structured && heading && key(realTitle).includes(key(cleanTitle(heading)))) realTitle = cleanTitle(heading);
  const sourceTitle = realTitle;
  realTitle = canonicalTitle(realTitle);
  if (!realTitle || realTitle.length > 150 || LIST_TITLE.test(realTitle) || ARTICLE_TITLE.test(realTitle) || GENERIC_HEADING.test(realTitle) ||
    (!key(canonicalTitle(heading)).includes(key(realTitle)) && !key(canonicalTitle(pageTitle)).includes(key(realTitle)))) {
    throw new Error('ページの作品名を照合できません');
  }
  const genre = named(structured?.genre);
  // Navigation and unrelated links cannot supply a medium for a person/page.
  const primary = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1]
    || html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1] || html;
  const titleContext = pageTitle.replaceAll(realTitle, '');
  const explicitKind = /映画|劇場版/u.test(titleContext) ? 'film' : /TVアニメ|テレビアニメ/u.test(titleContext) ? 'anime' :
    /漫画|マンガ|コミック/u.test(titleContext) ? 'manga' : /(?:ゲーム|RPG|ADV|アドベンチャー)/iu.test(titleContext) ? 'game' : null;
  const context = [genre, text(meta['og:type']), titleContext, text(introductionMarkup(primary)).slice(0,8000)].join(' ');
  let kind = TYPE_KIND[structured?.workType] || (structured?.workType === 'Product' ? 'literary-work' : null);
  const bookKinds = ['novel','short-story','literary-work','manga','poem','nonfiction'];
  const compatibleHint = !structured || (['Book','Product'].includes(structured.workType) && bookKinds.includes(hintKind)) ||
    (structured.workType === 'Movie' && ['film','anime'].includes(hintKind)) ||
    (structured.workType === 'TVSeries' && ['drama','anime'].includes(hintKind)) || kind === hintKind;
  if (!structured && explicitKind) kind = explicitKind;
  if (compatibleHint && (!explicitKind || explicitKind === hintKind) && hintKind && GENRE[hintKind]?.test(genre || context)) kind = hintKind;
  if (!kind) kind = Object.keys(GENRE).find((k) => GENRE[k].test(genre || context));
  if (!kind || !getKind(kind)) throw new Error('資料から作品の種類を確認できません');
  // A generic series heading must not hide the sequel number in typed data.
  if (structured) requirePlayableTitle(canonicalTitle(structured.name), kind);
  realTitle = requirePlayableTitle(realTitle, kind);
  // A plain heading alone is not enough: require an explicit introduction section
  // or typed work data. Search snippets and generic SEO descriptions never qualify.
  const sections = introductionSections(html);
  // Prefer the explicitly bounded visible introduction. Retail structured
  // descriptions often concatenate price, reviews and unrelated product data.
  if (structured?.description) sections.push({ section: '作品紹介（構造化データ）', content: text(structured.description) });
  if (!sections.length) throw new Error('作品の紹介文が見つかりません');
  let summary;
  let chosen;
  for (const section of sections) {
    if (/歌詞|lyric|目次|収録曲/iu.test(section.content.slice(0,60))) continue;
    try { summary = summarizeExtractively(section.content); chosen = section; break; } catch { /* Try the next explicit introduction. */ }
  }
  if (!summary) throw new Error('完全な文による十分な作品紹介がありません');
  const translatedTitle = realTitle.match(/[A-Za-z].*[(（]([\p{Script=Katakana}ー・\s]+)[)）]$/u);
  const aliases = [...new Set([translatedTitle ? realTitle.replace(/[(（][^()（）]+[)）]$/u, '').trim() : null, translatedTitle?.[1], sourceTitle !== realTitle ? sourceTitle : null, structured?.alternateName].flat().filter((a) => typeof a === 'string' && text(a)).map(text))];
  const synopsis = redactTitle(summary.synopsis, [realTitle, ...aliases]);
  if (synopsis.length < MIN_LENGTH || synopsis.length > MAX_LENGTH || synopsis.replace(/■■■/gu, '').length < MIN_LENGTH) throw new Error('題名を伏せた紹介文の長さが不十分です');
  const author = named(structured?.author || structured?.creator || structured?.director) || meta['book:author'] || '';
  const isbn = String(structured?.isbn || meta['books:isbn'] || meta['book:isbn'] || '').replace(/[^\dX]/giu,'');
  const workIdentity = isbn.length === 13 || isbn.length === 10 ? `isbn:${isbn}` :
    author ? `work:${hash(`${key(realTitle)}:${key(author)}:${kind}`)}` : `web:${hash(url)}`;
  return { realTitle, aliases, kind, synopsis, workIdentity, author,
    contentType: getKind(kind).contentMode === 'description' ? 'description' : 'synopsis',
    evidence: { sourceId: `web-${hash(url)}`, section: chosen.section,
      work: { version: 2, title: realTitle, kind, pageTitle, method: structured ? 'typed-work' : 'page-title' },
      sourceTextSha256: hash(chosen.content), excerpts: summary.excerpts } };
}

async function generateWebQuestion(candidate, { fetchImpl, now = () => new Date() }) {
  const requested = publicUrl(candidate.url);
  const response = await fetchImpl(requested.href, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.status === 202) throw new Error(`Web作品資料を取得できません (${response.status})`);
  const type = response.headers.get('content-type') || '';
  if (type && !/text\/html|application\/xhtml\+xml/iu.test(type)) throw new Error('作品資料がHTMLではありません');
  const url = publicUrl(response.url || requested.href).href;
  const html = await response.text();
  let work;
  try { work = extractWebWork(html, url, candidate.kind); }
  catch (error) {
    if (!candidate.webDepth && !/再利用|取得できません/u.test(error.message)) error.additionalCandidates = linkedCandidates(html, url, candidate.kind, { onlyStory: new URL(url).pathname !== '/' &&
      !LIST_TITLE.test(text(metadata(html)['og:title'] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1])) });
    throw error;
  }
  return { id: `web-${hash(url)}`, ...work, generationMethod: 'extractive-v1',
    sources: [{ provider: 'web', label: `${new URL(url).hostname}：${work.realTitle}`, url,
      retrievedAt: now().toISOString() }] };
}

module.exports = { generateWebQuestion, extractWebWork, introductionSections, structuredWorks, linkedCandidates, metadata, attributes, text, decode, hash, canonicalTitle };

const { MIN_LENGTH, MAX_LENGTH, MAX_SENTENCES, introductionSentenceIsUsable } = require('./quality');
const { createHash } = require('node:crypto');
const { NDL_API, tags, decodeXml, personName, approvedNDLUrl, readNDLResponse } = require('./ndl');
const { generateQuestion, stripDisambiguation, sourceSentences, summarizeExtractively,
  redactTitle, containsTitle, descriptionSentences, extractPlotSection } = require('./generator');
const { getKind } = require('./kinds');

const WIKI_API = 'https://ja.wikipedia.org/w/api.php';
const STATE_VERSION = 1;
const REFRESH_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
// These are material/genre searches, not a list of particular works.
const NDL_SEARCHES = Object.freeze([
  { id: 'manga', kind: 'manga', params: { ndc: '726.1' } },
  { id: 'music', kind: 'music-work', params: { any: '音楽' } },
  { id: 'film', kind: 'film', params: { any: '映画' } },
  { id: 'anime', kind: 'anime', params: { any: 'アニメ' } },
  { id: 'novel', kind: 'novel', params: { ndc: '913' } },
  { id: 'album', kind: 'album', params: { any: 'アルバム' } },
  { id: 'song', kind: 'song', params: { any: 'シングル' } },
  { id: 'drama', kind: 'drama', params: { any: 'テレビドラマ' } },
  { id: 'play', kind: 'play', params: { ndc: '912' } },
  { id: 'poem', kind: 'poem', params: { ndc: '911' } },
  { id: 'nonfiction', kind: 'nonfiction', params: { any: 'ノンフィクション' } },
  { id: 'game', kind: 'game', params: { any: 'ゲーム' } },
  { id: 'artwork', kind: 'artwork', params: { any: '美術作品' } },
  { id: 'other-work', kind: 'other-work', params: { any: '創作作品' } },
]);

function normalize(text) {
  return String(text || '').normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

function sameTitle(left, right) {
  return normalize(stripDisambiguation(left)).replace(/[\s_]/gu, '').toLowerCase() ===
    normalize(right).replace(/[\s_]/gu, '').toLowerCase();
}

function plainText(value) {
  return normalize(decodeXml(value).replace(/<br\s*\/?\s*>|<\/(?:p|li)>/giu, '\n').replace(/<[^>]*>/gu, ''));
}

function inferKind(record, search) {
  const material = record.categories.join(' ');
  const genres = record.genres.join(' ');
  if (/記事|雑誌|新聞|参考資料|地図|博士論文/u.test(material)) return null;
  if (/図書/u.test(material)) {
    if (record.classifications.some((code) => /^726\.1(?:\d*)$/u.test(code)) || /漫画/u.test(genres)) return 'manga';
    if (record.classifications.some((code) => /^913(?:\.|$)/u.test(code))) return 'novel';
    if (record.classifications.some((code) => /^912(?:\.|$)/u.test(code))) return 'play';
    if (record.classifications.some((code) => /^911(?:\.|$)/u.test(code))) return 'poem';
    if (search.kind === 'nonfiction') return 'nonfiction';
    // A book about films/games is not a film/game. Only appropriate material
    // types are handed to those article validators.
    return null;
  }
  if (/録音資料/u.test(material)) {
    if (search.kind === 'song' || search.kind === 'album') return search.kind;
    return 'music-work';
  }
  if (/映像資料|録画資料/u.test(material)) {
    if (/アニメ/u.test(genres) || search.kind === 'anime') return 'anime';
    if (/テレビドラマ/u.test(genres) || search.kind === 'drama') return 'drama';
    return 'film';
  }
  if (/電子資料|電子ゲーム/u.test(material) && search.kind === 'game') return 'game';
  if (/絵画|彫刻|美術作品/u.test(material) && search.kind === 'artwork') return 'artwork';
  return null;
}

function splitExplicitVolume(title, volume, kind) {
  if (!volume || !['manga', 'novel', 'play', 'poem', 'nonfiction'].includes(kind)) return { title, separated: false };
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const normalized = normalize(volume);
  const suffix = new RegExp(`(?:[.．。:：]\\s*|\\s+)${escape(normalized)}$`, 'u');
  const match = normalize(title).match(suffix);
  if (!match || match.index === 0) return { title, separated: false };
  return { title: normalize(title).slice(0, match.index).trim(), separated: true };
}

function parseRecord(item, search) {
  const originalTitle = normalize(tags(item, 'dc:title')[0] || tags(item, 'title')[0]);
  const url = [...tags(item, 'link'), ...tags(item, 'guid')].map((value) => approvedNDLUrl(value)).find(Boolean);
  if (!originalTitle || !url) return null;
  const recordId = new URL(url).pathname.slice('/books/'.length);
  const primaryAuthors = tags(item, 'dc:creator');
  const authors = (primaryAuthors.length ? primaryAuthors : tags(item, 'author'))
    .map((value) => personName(value, { aggregate: !primaryAuthors.length })).filter((value) => value?.name);
  const authorMap = new Map();
  for (const author of authors) authorMap.set(author.name, author);
  const subjectFields = [...item.matchAll(/<dc:subject\b([^>]*)>([\s\S]*?)<\/dc:subject>/giu)];
  const classifications = subjectFields.filter((match) => /NDC/u.test(match[1]))
    .map((match) => plainText(match[2])).filter((code) => /^\d{3}(?:\.\d+)?$/u.test(code));
  const categories = tags(item, 'category').map(plainText);
  const genres = tags(item, 'dcndl:genre').map(plainText);
  const volume = normalize(tags(item, 'dcndl:volume')[0]);
  const issued = normalize(tags(item, 'dcterms:issued')[0] || tags(item, 'dc:date')[0]);
  const year = issued.match(/\b(\d{4})\b/u);
  const archiveUrl = [...item.matchAll(/<rdfs:seeAlso\b[^>]*rdf:resource\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/giu)]
    .map((match) => approvedNDLUrl(decodeXml(match[1]), 'archive')).find(Boolean) || null;
  const record = { recordId, originalTitle, volume: volume || null, authors: [...authorMap.values()],
    publishedYear: year ? Number(year[1]) : null, issued: issued || null, categories, genres,
    classifications, url, archiveUrl, descriptions: tags(item, 'dc:description').map(plainText) };
  const kind = inferKind(record, search);
  if (!kind || !getKind(kind)) return null;
  const separated = splitExplicitVolume(originalTitle, record.volume, kind);
  return { id: `ndl-${recordId.toLowerCase()}`, provider: 'ndl', title: separated.title,
    realTitle: separated.title, aliases: [], kind, ndl: { ...record, volumeSeparated: separated.separated } };
}

function parseSearchPage(xml, search) {
  if (typeof xml !== 'string' || !/<rss\b/iu.test(xml) || !/<channel\b/iu.test(xml)) throw new Error('国立国会図書館の検索応答が不正です');
  const totalResults = Number(tags(xml, 'openSearch:totalResults')[0]);
  if (!Number.isSafeInteger(totalResults) || totalResults < 0) throw new Error('国立国会図書館の検索件数がありません');
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)];
  return { totalResults, itemCount: items.length, candidates: items.map((item) => parseRecord(item[1], search)).filter(Boolean) };
}

async function discoverNDLCandidates({ state = {}, limit = 10, maxRequests = 4,
  fetchImpl = global.fetch, now = () => new Date(), pageSize = 20 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 300
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('国立国会図書館の探索設定が不正です');
  const prior = state.version === STATE_VERSION ? structuredClone(state) : {};
  const seen = new Set(Array.isArray(prior.seenRecordIds) ? prior.seenRecordIds : []);
  const cursors = prior.cursors && typeof prior.cursors === 'object' ? prior.cursors : {};
  const ended = new Set(Array.isArray(prior.exhaustedQueries) ? prior.exhaustedQueries : []);
  const pending = Array.isArray(prior.pendingCandidates) ? prior.pendingCandidates : [];
  const candidates = [];
  const errors = [];
  let requests = 0;
  let nextQueryIndex = Number.isSafeInteger(prior.nextQueryIndex) ? prior.nextQueryIndex % NDL_SEARCHES.length : 0;
  let lastFullScanAt = prior.lastFullScanAt || null;
  if (ended.size === NDL_SEARCHES.length && lastFullScanAt &&
      now().getTime() - Date.parse(lastFullScanAt) >= REFRESH_MILLISECONDS) {
    ended.clear();
    for (const key of Object.keys(cursors)) delete cursors[key];
    nextQueryIndex = 0;
    lastFullScanAt = null;
  }
  while (pending.length && candidates.length < limit) candidates.push(pending.shift());
  while (candidates.length < limit && requests < maxRequests && ended.size < NDL_SEARCHES.length) {
    let search;
    for (let offset = 0; offset < NDL_SEARCHES.length; offset++) {
      const index = (nextQueryIndex + offset) % NDL_SEARCHES.length;
      if (!ended.has(NDL_SEARCHES[index].id)) {
        search = NDL_SEARCHES[index]; nextQueryIndex = (index + 1) % NDL_SEARCHES.length; break;
      }
    }
    if (!search) break;
    const start = Number.isSafeInteger(cursors[search.id]) && cursors[search.id] >= 1 ? cursors[search.id] : 1;
    const url = new URL(NDL_API);
    url.search = new URLSearchParams({ ...search.params, sidx: String(start),
      cnt: String(Math.min(pageSize, limit - candidates.length)) }).toString();
    requests++;
    try {
      const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(20000), redirect: 'error',
        headers: { 'User-Agent': 'TitleKakkoKariQuestionCollector/1.0 (multi-media bibliography discovery)' } });
      const page = parseSearchPage(await readNDLResponse(response), search);
      cursors[search.id] = start + page.itemCount;
      if (!page.itemCount || start + page.itemCount > page.totalResults) ended.add(search.id);
      for (const entry of page.candidates) {
        if (seen.has(entry.ndl.recordId)) continue;
        seen.add(entry.ndl.recordId);
        if (candidates.length < limit) candidates.push(entry); else pending.push(entry);
      }
    } catch (error) {
      errors.push(error.message);
      if (error.code === 'QUESTION_REQUEST_BUDGET') break;
      // The failed page's cursor stays put; next collection retries it.
    }
  }
  if (ended.size === NDL_SEARCHES.length && !lastFullScanAt) lastFullScanAt = now().toISOString();
  const nextState = { version: STATE_VERSION, cursors, nextQueryIndex, seenRecordIds: [...seen],
    exhaustedQueries: [...ended], pendingCandidates: pending, lastFullScanAt };
  return { candidates, state: nextState, exhausted: ended.size === NDL_SEARCHES.length && !pending.length,
    requests, errors };
}

function bibliographySource(entry, retrievedAt) {
  const record = entry.ndl;
  return { provider: 'ndl', role: 'bibliography', label: `国立国会図書館サーチ「${record.originalTitle}」`,
    url: record.url, retrievedAt, recordId: record.recordId, originalTitle: record.originalTitle,
    ...(record.volume ? { volume: record.volume } : {}),
    ...(record.publishedYear ? { publishedYear: record.publishedYear } : {}) };
}

function explicitIntroduction(entry) {
  // A catalog's date, extent, contents list or edition note is not an introduction.
  // Require an explicit introduction/plot label and complete source sentences.
  if (entry.ndl.volumeSeparated) return null;
  const definitions = {
    manga: { ndc: /^726\.1(?:\d*)$/u, genre: /漫画/u },
    novel: { ndc: /^913(?:\.|$)/u, genre: /小説/u },
    play: { ndc: /^912(?:\.|$)/u, genre: /戯曲/u },
    poem: { ndc: /^911(?:\.|$)/u, genre: /詩/u },
    film: { genre: /映画/u }, anime: { genre: /アニメ/u }, drama: { genre: /テレビドラマ/u },
    song: { genre: /楽曲|歌曲|シングル/u }, album: { genre: /アルバム/u },
    'music-work': { genre: /音楽/u }, game: { genre: /ゲーム/u },
    nonfiction: { genre: /ノンフィクション/u }, artwork: { genre: /絵画|彫刻|美術作品/u },
  };
  const proof = definitions[entry.kind];
  const isCertainMaterial = proof && ((proof.ndc && entry.ndl.classifications.some((code) => proof.ndc.test(code)))
    || entry.ndl.genres.some((genre) => proof.genre.test(genre)));
  if (!isCertainMaterial) return null;
  for (const description of entry.ndl.descriptions) {
    const match = description.match(/^(あらすじ|内容紹介)\s*[:：]\s*([\s\S]+)$/u);
    if (!match || /目次|内容細目|第[一二三四五六七八九十\d]+章|初版|改訂版|所蔵|ISBN|^[\d\s.,・]+$/u.test(match[2])) continue;
    if (entry.kind !== 'nonfiction' && /研究書|研究論文|評論集|批評|解説書|入門書|歴史研究|資料集|作家論|研究者による/u.test(match[2])) continue;
    let excerpts;
    if (getKind(entry.kind).contentMode === 'story') {
      // A real catalog introduction may be a plain plot narration. It still
      // cannot be a quoted primary text, contents list, lyrics or edition notes.
      if (match[1] === 'あらすじ') {
        try { extractPlotSection(`== あらすじ ==\n${match[2]}`); } catch { continue; }
      }
      excerpts = sourceSentences(match[2]).filter((sentence) =>
        !/^[「『“"].*[」』”"](?:。)?$/u.test(sentence) &&
        !/^(?:歌詞|全詩|詩の(?:本文|全文|原文)|全文|原文|収録曲|トラックリスト|曲目|目次)[：:]/u.test(sentence));
    } else {
      excerpts = descriptionSentences(match[2], [entry.title, entry.ndl.originalTitle, ...(entry.aliases || [])], entry.kind);
    }
    if (excerpts.join('').length >= 120) return { section: match[1], text: excerpts.join(''), sourceText: match[2] };
  }
  return null;
}

async function generateFromIntroduction(entry, introduction, { localAI, now }) {
  let generated = localAI ? await localAI({ sourceId: `ndl-${entry.ndl.recordId}`, text: introduction.text,
    minLength: MIN_LENGTH, maxLength: MAX_LENGTH }) : summarizeExtractively(introduction.text);
  if (localAI) {
    const source = sourceSentences(introduction.text);
    if (!generated || typeof generated.synopsis !== 'string' || !Array.isArray(generated.excerpts)) throw new Error('AIの資料抽出が不正です');
    const excerpts = generated.excerpts.map(normalize);
    const positions = excerpts.map((excerpt) => source.indexOf(excerpt));
    if (!excerpts.length || normalize(generated.synopsis) !== excerpts.join('') ||
      positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1]))) {
      throw new Error('AIの紹介文が国立国会図書館の資料と一致しません');
    }
    generated = { synopsis: excerpts.join(''), excerpts };
  }
  const aliases = [...new Set([entry.title, entry.ndl.originalTitle, ...(entry.aliases || [])])];
  const synopsis = redactTitle(generated.synopsis, aliases);
  if (synopsis.length < MIN_LENGTH || synopsis.length > MAX_LENGTH || synopsis.replace(/■■■/gu, '').length < MIN_LENGTH ||
      sourceSentences(generated.synopsis).length > MAX_SENTENCES ||
      !sourceSentences(generated.synopsis).every(introductionSentenceIsUsable) || containsTitle(synopsis, aliases)) {
    throw new Error('題名を伏せた作品紹介の検査に合格しませんでした');
  }
  const source = bibliographySource(entry, now().toISOString());
  return { id: entry.id, realTitle: entry.title, aliases, kind: entry.kind,
    contentType: introduction.section === 'あらすじ' && getKind(entry.kind).contentMode === 'story' ? 'synopsis' : 'description',
    synopsis, sources: [source], generationMethod: localAI ? 'local-ai-v1' : 'extractive-v1',
    evidence: { sourceId: `ndl-${entry.ndl.recordId}`, section: introduction.section,
      sourceTextSha256: createHash('sha256').update(introduction.sourceText || introduction.text).digest('hex'), excerpts: generated.excerpts } };
}

function validateCandidate(entry) {
  const record = entry?.ndl;
  if (entry?.provider !== 'ndl' || !getKind(entry.kind) || !record || !record.originalTitle ||
    typeof entry.title !== 'string' || !entry.title.trim() || !approvedNDLUrl(record.url) ||
    new URL(record.url).pathname.slice('/books/'.length) !== record.recordId ||
    !Array.isArray(record.authors) || !Array.isArray(record.categories) || !Array.isArray(record.genres) ||
    !Array.isArray(record.classifications) || !Array.isArray(record.descriptions)) throw new Error('国立国会図書館の作品候補が不正です');
  if (entry.id !== `ndl-${record.recordId.toLowerCase()}` || inferKind(record, { kind: entry.kind }) !== entry.kind) {
    throw new Error('国立国会図書館の資料種別と作品候補が一致しません');
  }
  const split = splitExplicitVolume(record.originalTitle, record.volume, entry.kind);
  if (entry.title !== split.title || Boolean(record.volumeSeparated) !== split.separated) throw new Error('書誌の題名・巻表示が一致しません');
  if (split.separated && !record.authors.length) throw new Error('シリーズの巻から作品を照合する著者がありません');
}

async function generateNDLQuestion(entry, { fetchImpl = global.fetch, localAI = null, now = () => new Date() } = {}) {
  validateCandidate(entry);
  const introduction = explicitIntroduction(entry);
  if (introduction) return generateFromIntroduction(entry, introduction, { localAI, now });
  if (!entry.ndl.authors.length) throw new Error('書誌と解説を照合できる作者・アーティストがありません');
  const url = new URL(WIKI_API);
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `"${entry.title.replace(/"/gu, '')}"`,
    srnamespace: '0', srlimit: '20', srwhat: 'text', format: 'json', formatversion: '2' }).toString();
  const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(20000), redirect: 'error',
    headers: { 'User-Agent': 'TitleKakkoKariQuestionCollector/1.0 (bibliography to verified work resolver)' } });
  if (!response.ok) throw new Error(`作品解説を検索できません (${response.status})`);
  const data = await response.json();
  if (data.error || !Array.isArray(data.query?.search)) throw new Error('作品検索の応答が不正です');
  const results = data.query.search.filter((page) => Number.isSafeInteger(page.pageid) && page.pageid > 0 &&
    typeof page.title === 'string' && sameTitle(page.title, entry.title)).slice(0, 4);
  const material = entry.ndl.categories.join(' ');
  const genres = entry.ndl.genres.join(' ');
  const possibleKinds = /録音資料/u.test(material) && !/楽曲|歌曲|シングル|アルバム/u.test(genres)
    ? ['music-work', 'song', 'album'] : [entry.kind];
  // Media metadata may identify only an audio recording, not song vs. album.
  // Each possible subtype gets all article and creator checks against the same
  // fetched response; inspecting another subtype does not refetch that article.
  const articleCache = new Map();
  const articleFetch = async (value, options) => {
    const key = String(value);
    if (articleCache.has(key)) return articleCache.get(key);
    const response = await fetchImpl(value, options);
    if (!response.ok) return response;
    const data = await response.json();
    const saved = { ok: response.ok, status: response.status, headers: response.headers,
      json: async () => structuredClone(data) };
    articleCache.set(key, saved);
    return saved;
  };
  for (const page of results) {
    for (const kind of possibleKinds) try {
      const question = await generateQuestion({ id: `wiki-ja-${page.pageid}`, title: page.title,
        realTitle: stripDisambiguation(page.title), aliases: entry.aliases || [], kind },
      { fetchImpl: articleFetch, localAI, now, expectedAuthors: entry.ndl.authors.map((author) => author.name) });
      const sources = [...question.sources, bibliographySource(entry, now().toISOString())];
      const archiveUrl = approvedNDLUrl(entry.ndl.archiveUrl, 'archive');
      if (archiveUrl) sources.push({ provider: 'ndl', role: 'archive', url: archiveUrl,
        label: `国立国会図書館デジタルコレクション「${entry.ndl.originalTitle}」`, retrievedAt: now().toISOString() });
      return { ...question, sources };
    } catch (error) {
      if (error.code === 'QUESTION_REQUEST_BUDGET' || error.code === 'QUESTION_SOURCE_COOLDOWN' || error.code === 'ENOENT' ||
        [5, 6, 7, 18, 28, 35, 52, 56, 92].includes(error.code) ||
        error.name === 'AbortError' || error.name === 'TimeoutError' ||
        /\((?:429|5\d\d)\)|fetch failed|failed to connect|could not resolve|timed out|ECONN|ENOTFOUND|EAI_AGAIN/iu.test(error.message)) throw error;
    }
  }
  throw new Error('書誌の作品名・作者・作品種別と一致する解説が見つかりません');
}

module.exports = { NDL_SEARCHES, discoverNDLCandidates, generateNDLQuestion,
  parseSearchPage, parseRecord, splitExplicitVolume, inferKind, explicitIntroduction };

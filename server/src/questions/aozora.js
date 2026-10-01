const { inflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { sourceSentences, redactTitle, containsTitle } = require('./generator');
const { enrichWithNDL } = require('./ndl');

const CATALOG_URL = 'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip';
const MAX_CATALOG_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const DISCOVERY_ORDER_VERSION = 2;
const MAX_AI_SOURCE_CHARACTERS = 30000;
const catalogCaches = new WeakMap();

function normalize(text) {
  return String(text).normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

function aozoraUrl(value, kind, workId = null) {
  let url;
  try { url = new URL(value); } catch { throw new Error('青空文庫のURLが不正です'); }
  const pattern = kind === 'card' ? /^\/cards\/\d+\/card(\d+)\.html$/u
    : /^\/cards\/\d+\/files\/[^/]+\.html?$/u;
  const match = url.pathname.match(pattern);
  if (url.protocol !== 'https:' || url.hostname !== 'www.aozora.gr.jp' || url.port ||
      url.username || url.password || url.search || url.hash || !match ||
      (kind === 'card' && workId !== null && Number(match[1]) !== Number(workId))) {
    throw new Error('青空文庫の作品URLを確認できません');
  }
  return url.href;
}

async function readBytes(response, maximum) {
  if (!response.ok) throw new Error(`青空文庫の資料を取得できません (${response.status})`);
  const contentLength = Number(response.headers?.get('content-length'));
  if (contentLength > maximum) throw new Error('青空文庫の資料が大きすぎます');
  if (response.body?.[Symbol.asyncIterator]) {
    const parts = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maximum) throw new Error('青空文庫の資料が大きすぎます');
      parts.push(Buffer.from(chunk));
    }
    return Buffer.concat(parts);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximum) throw new Error('青空文庫の資料が大きすぎます');
  return bytes;
}

// Only the CSV's bytes are read. ZIP entry names are never written to disk.
function unzipCatalog(bytes) {
  if (bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('青空文庫一覧がZIPではありません');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('青空文庫一覧のZIPを読めません');
  const count = bytes.readUInt16LE(end + 10);
  let position = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (position + 46 > bytes.length || bytes.readUInt32LE(position) !== 0x02014b50) break;
    const flags = bytes.readUInt16LE(position + 8);
    const method = bytes.readUInt16LE(position + 10);
    const compressedSize = bytes.readUInt32LE(position + 20);
    const originalSize = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const localOffset = bytes.readUInt32LE(position + 42);
    const name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    position += 46 + nameLength + extraLength + commentLength;
    if (!/(?:^|\/)list_person_all_extended_utf8\.csv$/u.test(name)) continue;
    if (flags & 1 || originalSize > MAX_CATALOG_BYTES || compressedSize > MAX_CATALOG_BYTES ||
        localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('青空文庫一覧のZIPが不正です');
    }
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) +
      bytes.readUInt16LE(localOffset + 28);
    if (dataOffset + compressedSize > bytes.length) throw new Error('青空文庫一覧のZIPが途切れています');
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const csv = method === 0 ? compressed : method === 8
      ? inflateRawSync(compressed, { maxOutputLength: MAX_CATALOG_BYTES }) : null;
    if (!csv || csv.length !== originalSize) throw new Error('青空文庫一覧の圧縮形式を読めません');
    return csv;
  }
  throw new Error('青空文庫一覧のCSVがありません');
}

function parseCsv(text) {
  const records = [];
  let row = [], field = '', quoted = false;
  const source = text.replace(/^\uFEFF/u, '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index++; }
      else if (!field || quoted) quoted = !quoted;
      else field += character;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(Boolean)) records.push(row);
      row = []; field = '';
    } else field += character;
  }
  if (quoted) throw new Error('青空文庫一覧のCSVが途切れています');
  if (field || row.length) { row.push(field); records.push(row); }
  const headers = records.shift();
  const required = ['作品ID', '作品名', '分類番号', '作品著作権フラグ', '図書カードURL',
    '役割フラグ', '姓', '名', 'XHTML/HTMLファイルURL', 'XHTML/HTMLファイル符号化方式'];
  if (!headers || required.some((key) => !headers.includes(key))) throw new Error('青空文庫一覧の項目が変わっています');
  return records.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] || ''])));
}

async function loadCatalog(fetchImpl, milliseconds) {
  const cacheKey = fetchImpl.sourceCacheKey || fetchImpl;
  let cache = catalogCaches.get(cacheKey);
  if (cache && Date.now() - cache.createdAt < milliseconds) return cache.promise;
  cache = { createdAt: Date.now(), promise: null };
  cache.promise = (async () => {
    const response = await fetchImpl(CATALOG_URL, {
      signal: AbortSignal.timeout(30000), redirect: 'error',
      headers: { 'User-Agent': 'TitleKakkoKariQuestionCollector/1.0 (open-literature questions)' },
    });
    const csv = unzipCatalog(await readBytes(response, MAX_CATALOG_BYTES));
    const rows = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(csv));
    // Japanese prose fiction avoids catalog-leading translated essay collections;
    // other languages remain discoverable after these rows, with no fixed title list.
    rows.sort((left, right) => Number(/\b913(?:\.\d+)?\b/u.test(right['分類番号'])) -
      Number(/\b913(?:\.\d+)?\b/u.test(left['分類番号'])));
    return { rows,
      sha256: createHash('sha256').update('aozora-discovery-v2:913-first\n').update(csv).digest('hex') };
  })();
  catalogCaches.set(cacheKey, cache);
  try { return await cache.promise; }
  catch (error) { if (catalogCaches.get(cacheKey) === cache) catalogCaches.delete(cacheKey); throw error; }
}

function candidateFromRow(row) {
  // NDC *13/*23/.../*83 identifies prose fiction, excluding criticism, biographies,
  // poetry and reference works. Eligibility still depends on usable narrative text.
  if (row['作品著作権フラグ'] !== 'なし' || row['役割フラグ'] !== '著者' ||
      !/\b(?:913|923|933|943|953|963|973|983)(?:\.\d+)?\b/u.test(row['分類番号']) ||
      !/^新字新仮名$/u.test(row['文字遣い種別']) || !/^\d+$/u.test(row['作品ID']) ||
      !row['作品名'].trim()) return null;
  const workId = String(Number(row['作品ID']));
  try {
    const title = normalize(row['作品名']);
    const authorParts = [row['姓'], row['名']].map(normalize).filter(Boolean);
    const aliases = [...new Set([title, row['原題'], row['副題']].map(normalize).filter(Boolean))];
    return { id: `aozora-${workId}`, provider: 'aozora', workId, title, realTitle: title,
      aliases, author: authorParts.join(' '), authorParts,
      birthDate: row['生年月日'] || null, deathDate: row['没年月日'] || null,
      kind: /\b913(?:\.\d+)?\b/u.test(row['分類番号']) ? 'novel' : 'literary-work',
      cardUrl: aozoraUrl(row['図書カードURL'], 'card', workId),
      textUrl: aozoraUrl(row['XHTML/HTMLファイルURL'], 'text'),
      encoding: row['XHTML/HTMLファイル符号化方式'], classification: row['分類番号'],
      copyright: 'なし' };
  } catch { return null; }
}

async function discoverAozoraCandidates({ state = {}, limit = 10, fetchImpl = global.fetch,
  catalogCacheMilliseconds = 6 * 60 * 60 * 1000 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('青空文庫の取得件数が不正です');
  const catalog = await loadCatalog(fetchImpl, catalogCacheMilliseconds);
  const seen = new Set(Array.isArray(state.seenWorkIds) ? state.seenWorkIds.map(String) : []);
  let cursor = state.orderVersion === DISCOVERY_ORDER_VERSION &&
    state.catalogSha256 === catalog.sha256 && Number.isSafeInteger(state.cursor)
    ? Math.max(0, Math.min(state.cursor, catalog.rows.length)) : 0;
  const candidates = [];
  while (cursor < catalog.rows.length && candidates.length < limit) {
    const entry = candidateFromRow(catalog.rows[cursor++]);
    if (!entry || seen.has(entry.workId)) continue;
    seen.add(entry.workId); candidates.push(entry);
  }
  return { candidates, state: { cursor, seenWorkIds: [...seen], catalogSha256: catalog.sha256,
    orderVersion: DISCOVERY_ORDER_VERSION },
    exhausted: cursor >= catalog.rows.length };
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (whole, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] || whole;
    const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : '';
  });
}

function plainHtml(html) {
  return normalize(decodeEntities(html
    .replace(/<(?:script|style|rt|rp)\b[^>]*>[\s\S]*?<\/(?:script|style|rt|rp)\s*>/giu, '')
    .replace(/<(?:span|div)\b[^>]*class\s*=\s*["'][^"']*\b(?:notes|annotation|editorial_note)\b[^"']*["'][^>]*>[\s\S]*?<\/(?:span|div)>/giu, '')
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/giu, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div)>/giu, '\n')
    .replace(/<[^>]*>/gu, '').replace(/［＃[^］]*］/gu, '')));
}

function removeSmallPrintBlocks(html) {
  const start = /<div\b[^>]*class\s*=\s*["'][^"']*\bsho[12]\b[^"']*["'][^>]*>/giu;
  let found;
  while ((found = start.exec(html))) {
    const tags = /<\/?div\b[^>]*>/giu;
    tags.lastIndex = found.index + found[0].length;
    let depth = 1, token, end = -1;
    while ((token = tags.exec(html))) {
      depth += /^<\/div/iu.test(token[0]) ? -1 : 1;
      if (!depth) { end = tags.lastIndex; break; }
    }
    if (end < 0) break;
    html = html.slice(0, found.index) + html.slice(end);
    start.lastIndex = found.index;
  }
  return html;
}

function extractAozoraText(html, expectedTitle) {
  if (typeof html !== 'string') throw new Error('青空文庫の本文がありません');
  const title = html.match(/<h1\b[^>]*class\s*=\s*["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu);
  if (!title || plainHtml(title[1]).replace(/\s/gu, '') !== normalize(expectedTitle).replace(/\s/gu, '')) {
    throw new Error('青空文庫の本文タイトルが一覧と一致しません');
  }
  const begin = /<div\b[^>]*class\s*=\s*["'][^"']*\bmain_text\b[^"']*["'][^>]*>/iu.exec(html);
  if (!begin) throw new Error('青空文庫の作品本文領域がありません');
  const contentStart = begin.index + begin[0].length;
  const tags = /<\/?div\b[^>]*>/giu;
  tags.lastIndex = contentStart;
  let depth = 1, token;
  while ((token = tags.exec(html))) {
    depth += /^<\/div/iu.test(token[0]) ? -1 : 1;
    if (!depth) return plainHtml(removeSmallPrintBlocks(html.slice(contentStart, token.index)));
  }
  throw new Error('青空文庫の本文領域が途切れています');
}

// A bounded TextRank-style graph ranks source sentences by shared Japanese
// character bigrams. The result is a contiguous passage, preserving context.
function summarizeNarrative(text, { minLength = 120, maxLength = 450 } = {}) {
  const sentences = sourceSentences(text);
  const options = sentences.slice(0, 180).map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => sentence.length >= 5 && sentence.length <= maxLength &&
      !/底本|入力者|校正者|著作権|青空文庫|この作品|本書|本稿|文学論|講演|諸君|読者|前の章|概括的な観察|――.*(?:作|古謡|唱歌)/u.test(sentence));
  if (options.length < 2) throw new Error('出題に使える物語の文がありません');
  const features = options.map(({ sentence }) => {
    const characters = sentence.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-z]/giu, '');
    const grams = new Set();
    for (let index = 0; index + 1 < characters.length; index++) grams.add(characters.slice(index, index + 2));
    return grams;
  });
  const edges = options.map(() => []);
  const totals = options.map(() => 0);
  for (let left = 0; left < options.length; left++) for (let right = left + 1; right < options.length; right++) {
    let overlap = 0;
    for (const gram of features[left]) if (features[right].has(gram)) overlap++;
    const score = overlap / Math.max(1, Math.log(2 + features[left].size) + Math.log(2 + features[right].size));
    if (score < 0.15) continue;
    edges[left].push([right, score]); edges[right].push([left, score]);
    totals[left] += score; totals[right] += score;
  }
  let ranks = options.map(() => 1);
  for (let iteration = 0; iteration < 12; iteration++) ranks = edges.map((neighbors) =>
    0.15 + 0.85 * neighbors.reduce((sum, [other, score]) => sum + score / totals[other] * ranks[other], 0));
  const passages = [];
  for (let start = 0; start < options.length; start++) {
    // A detached pronoun/conjunction usually refers to material outside a short
    // question. Prefer a passage that introduces its own scene or characters.
    if (options[start].index > 0 && /^(?:が[、,]|しかし|その|そこで|そして|それから|同時に|あとには|彼[はがをの]|彼女[はがをの]|もう[一二三四五六七八九十\d])/u.test(options[start].sentence)) continue;
    const selected = [];
    let length = 0, weight = 0;
    for (let index = start; index < options.length; index++) {
      const option = options[index];
      if (index > start && option.index !== options[index - 1].index + 1) break;
      if (length + option.sentence.length > maxLength) break;
      selected.push(option.sentence); length += option.sentence.length; weight += ranks[index];
      if (length >= minLength) {
        const joined = selected.join('');
        const humanActors = (joined.match(/少年|少女|青年|娘|息子|父|母|祖父|祖母|老人|妻|旅人|男|女|友人|子供|子ども|私|わたし|彼|彼女/gu) || []).length;
        const events = (joined.match(/出かけ|訪ね|訪れ|現れ|見つけ|出会|出逢|連れ|追い|逃げ|戻|帰|殺|死|助|探し|決心|暮ら|住|聞|語|話|歩|走|言/gu) || []).length;
        const commentary = (joined.match(/国民|虚構|概括|漫画化|文学|小説家|詩人|理想的な|ものごと/gu) || []).length;
        const narrative = Math.min(3, humanActors / 2) + Math.min(3, events / 2) - commentary * 2;
        if (narrative >= 1) passages.push({ excerpts: [...selected],
          score: (weight / selected.length + narrative) / (1 + options[start].index / 3) +
            Math.min(1, length / 300) });
      }
      if (length >= Math.min(330, maxLength)) break;
    }
  }
  passages.sort((left, right) => right.score - left.score);
  if (!passages.length) throw new Error('文を途中で切らずに出題できる物語の本文がありません');
  const excerpts = passages[0].excerpts;
  return { synopsis: excerpts.join(''), excerpts };
}

function validateLocalSummary(generated, text) {
  const sentences = sourceSentences(text);
  if (!generated || typeof generated.synopsis !== 'string' || !Array.isArray(generated.excerpts) ||
      !generated.excerpts.length) throw new Error('AIの抽出結果が不正です');
  const excerpts = generated.excerpts.map(normalize);
  const positions = excerpts.map((excerpt) => sentences.indexOf(excerpt));
  if (excerpts.some((excerpt, index) => !excerpt || positions[index] < 0 ||
      (index > 0 && positions[index] <= positions[index - 1])) ||
      normalize(generated.synopsis) !== excerpts.join('')) throw new Error('AIの出力が出典本文の文と一致しません');
  return { synopsis: excerpts.join(''), excerpts };
}

async function generateAozoraQuestion(entry, { fetchImpl = global.fetch, localAI = null,
  now = () => new Date(), includeNDL = true } = {}) {
  if (!entry || entry.provider !== 'aozora' || !/^aozora-\d+$/u.test(entry.id) ||
      entry.id !== `aozora-${Number(entry.workId)}` || entry.copyright !== 'なし' ||
      !entry.title?.trim() || entry.realTitle !== entry.title || !Array.isArray(entry.aliases) ||
      !entry.aliases.every((alias) => typeof alias === 'string' && alias.trim())) {
    throw new Error('青空文庫の作品情報が不正です');
  }
  const cardUrl = aozoraUrl(entry.cardUrl, 'card', entry.workId);
  const textUrl = aozoraUrl(entry.textUrl, 'text');
  const response = await fetchImpl(textUrl, { signal: AbortSignal.timeout(20000), redirect: 'error',
    headers: { 'User-Agent': 'TitleKakkoKariQuestionCollector/1.0 (open-literature questions)' } });
  const encoding = /^(?:utf-?8)$/iu.test(entry.encoding) ? 'utf-8'
    : /^(?:shift[-_]?jis|sjis)$/iu.test(entry.encoding) ? 'shift_jis' : null;
  if (!encoding) throw new Error('青空文庫本文の文字コードを確認できません');
  const html = new TextDecoder(encoding, { fatal: true }).decode(await readBytes(response, MAX_TEXT_BYTES));
  const text = extractAozoraText(html, entry.title);
  const sourceId = entry.id;
  let aiSourceText = '';
  if (localAI) {
    const context = [];
    let length = 0;
    for (const sentence of sourceSentences(text)) {
      if (length + sentence.length > MAX_AI_SOURCE_CHARACTERS) break;
      context.push(sentence); length += sentence.length;
    }
    aiSourceText = context.join('');
    if (aiSourceText.length < 120) throw new Error('AIの文選択に使える本文が不足しています');
  }
  const generated = localAI ? validateLocalSummary(await localAI({ sourceId, text: aiSourceText,
    minLength: 120, maxLength: 450 }), aiSourceText) : summarizeNarrative(text);
  const aliases = [...new Set([entry.title, ...entry.aliases].map(normalize))];
  const synopsis = redactTitle(generated.synopsis, aliases);
  if (synopsis.length < 120 || synopsis.length > 450 || synopsis.replace(/■■■/gu, '').length < 120 ||
      containsTitle(synopsis, aliases) || /https?:\/\/|\[\[|\]\]/iu.test(synopsis)) {
    throw new Error('題名を伏せた出題文の検査に合格しませんでした');
  }
  const kind = /\b913(?:\.\d+)?\b/u.test(entry.classification) ? 'novel' : 'literary-work';
  const question = { id: entry.id, realTitle: normalize(entry.title), aliases, kind, synopsis,
    sources: [{ provider: 'aozora', label: `青空文庫「${entry.title}」`, url: cardUrl,
      textUrl, retrievedAt: now().toISOString(), license: '著作権なし（青空文庫公開情報）' }],
    generationMethod: localAI ? 'local-ai-v1' : 'extractive-v1',
    evidence: { sourceId, section: '本文', sourceTextSha256: createHash('sha256').update(text).digest('hex'),
      excerpts: generated.excerpts } };
  return includeNDL ? enrichWithNDL(question, entry, { fetchImpl, now }) : question;
}

module.exports = { CATALOG_URL, discoverAozoraCandidates, generateAozoraQuestion,
  parseCsv, unzipCatalog, candidateFromRow, extractAozoraText, summarizeNarrative, aozoraUrl };

const test = require('node:test');
const assert = require('node:assert/strict');
const { deflateRawSync } = require('node:zlib');
const { discoverAozoraCandidates, generateAozoraQuestion, parseCsv,
  extractAozoraText, summarizeNarrative, unzipCatalog } = require('../server/src/questions/aozora');
const { findNDLBibliography, enrichWithNDL, findMatchingRecord,
  approvedNDLUrl } = require('../server/src/questions/ndl');
const { NDL_SEARCHES, discoverNDLCandidates, generateNDLQuestion, parseSearchPage,
  splitExplicitVolume, explicitIntroduction } = require('../server/src/questions/ndl-discovery');

const HEADERS = ['作品ID', '作品名', '原題', '副題', '分類番号', '文字遣い種別', '作品著作権フラグ',
  '図書カードURL', '役割フラグ', '姓', '名', '生年月日', '没年月日', 'XHTML/HTMLファイルURL', 'XHTML/HTMLファイル符号化方式'];
function csvRow(id, overrides = {}) {
  const row = { 作品ID: String(id).padStart(6, '0'), 作品名: `物語その${id}`, 原題: '', 副題: '',
    分類番号: 'NDC 913.6', 文字遣い種別: '新字新仮名', 作品著作権フラグ: 'なし',
    図書カードURL: `https://www.aozora.gr.jp/cards/000879/card${id}.html`, 役割フラグ: '著者',
    姓: '物語', 名: '太郎', 生年月日: '1900-01-01', 没年月日: '1970-12-31',
    'XHTML/HTMLファイルURL': `https://www.aozora.gr.jp/cards/000879/files/${id}_1.html`,
    'XHTML/HTMLファイル符号化方式': 'UTF-8', ...overrides };
  return HEADERS.map((key) => `"${row[key].replace(/"/gu, '""')}"`).join(',');
}
function catalogCsv(rows) { return `\uFEFF${HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`; }
function zipCsv(csv) {
  const name = Buffer.from('list_person_all_extended_utf8.csv');
  const source = Buffer.from(csv), compressed = deflateRawSync(source);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(source.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}
function bytesResponse(bytes) { return { ok: true, status: 200, arrayBuffer: async () => bytes,
  headers: { get: () => null } }; }
function entry(id = 128) {
  return { id: `aozora-${id}`, provider: 'aozora', workId: String(id), title: '小さな灯台', realTitle: '小さな灯台',
    aliases: ['小さな灯台'], author: '物語 太郎', authorParts: ['物語', '太郎'], kind: 'novel', copyright: 'なし',
    classification: 'NDC 913.6', cardUrl: `https://www.aozora.gr.jp/cards/000879/card${id}.html`,
    textUrl: `https://www.aozora.gr.jp/cards/000879/files/${id}_1.html`, encoding: 'UTF-8' };
}
const SENTENCES = [
  '海辺の村に暮らす少年は、嵐の翌朝、壊れた舟のそばで見知らぬ旅人を見つけた。',
  '旅人は遠く離れた島から来たと言い、行方のわからなくなった妹を探していると話した。',
  '少年は小さな灯台の番人である祖父に相談して、旅人とともに村の古い港を訪ねることにした。',
  '港の人々は旅人を怪しんだが、少年が拾った銀色の鍵を見せると、ひとりの老人が昔の出来事を語り始めた。',
  '老人の話を聞いた少年は、祖父が長年隠してきた秘密と、島に残された約束がつながっていることを知った。',
  '少年と旅人は危険な夜の海に舟を出し、離ればなれになった家族を再び会わせようと決心した。',
  '村の人々も二人を助けるために集まり、暗い海を照らす明かりを一晩中守り続けた。',
];
function html(text = SENTENCES.join(''), title = '小さな灯台') {
  return `<html><h1 class="title">${title}</h1><h2 class="author">物語 太郎</h2>` +
    `<div class="main_text"><div class="jisage">${text}</div></div><div class="bibliographical_information">底本:秘密</div></html>`;
}
function ndlItem({ title = '小さな灯台', creator = '物語, 太郎, 1900-1970',
  url = 'https://ndlsearch.ndl.go.jp/books/R100000002-I000000001', archive = true } = {}) {
  return `<item><title>${title}</title><link>${url}</link><dc:title>${title}</dc:title>` +
    `<dc:creator>${creator}</dc:creator>${archive ? '<rdfs:seeAlso rdf:resource="https://dl.ndl.go.jp/pid/1234567"/>' : ''}</item>`;
}

test('Aozora CSV preserves quoted newlines, commas, doubled quotes and requires actual fields', () => {
  const rows = parseCsv(catalogCsv([csvRow(1, { 作品名: '物語, "第一章"\n続き' })]));
  assert.equal(rows[0]['作品名'], '物語, "第一章"\n続き');
  assert.throws(() => parseCsv('作品ID,作品名\n1,無効'), /項目/u);
  assert.throws(() => unzipCatalog(Buffer.alloc(100)), /ZIP/u);
});

test('Aozora online catalog discovery keeps collecting beyond 25 works and resumes without duplicates', async () => {
  const rows = [csvRow(1, { 作品著作権フラグ: 'あり' }), csvRow(2, { 分類番号: 'NDC 291' }),
    csvRow(3, { 役割フラグ: '翻訳者' }), csvRow(4, { 文字遣い種別: '旧字旧仮名' }),
    ...Array.from({ length: 45 }, (_, index) => csvRow(100 + index)), csvRow(100)];
  let requests = 0;
  const fetchImpl = async (url) => { assert.match(url, /list_person_all_extended_utf8\.zip$/u);
    requests++; return bytesResponse(zipCsv(catalogCsv(rows))); };
  const first = await discoverAozoraCandidates({ limit: 30, fetchImpl });
  assert.equal(first.candidates.length, 30); assert.equal(first.exhausted, false);
  assert.equal(first.candidates[0].birthDate, '1900-01-01');
  assert.equal(first.candidates[0].deathDate, '1970-12-31');
  const second = await discoverAozoraCandidates({ state: first.state, limit: 30, fetchImpl });
  assert.equal(second.candidates.length, 15); assert.equal(second.exhausted, true);
  assert.equal(new Set([...first.candidates, ...second.candidates].map((candidate) => candidate.id)).size, 45);
  assert.equal(requests, 1);
  assert.equal(first.state.seenWorkIds.length, 30, 'incoming state must not be mutated by resume');
  assert.equal((await discoverAozoraCandidates({ state: second.state, limit: 30, fetchImpl })).candidates.length, 0);
});

test('catalog changes discover new works while preserving already discovered identifiers', async () => {
  let version = 1;
  const fetchImpl = async () => bytesResponse(zipCsv(catalogCsv(
    version === 1 ? [csvRow(100)] : [csvRow(50), csvRow(100), csvRow(150)])));
  const first = await discoverAozoraCandidates({ fetchImpl, catalogCacheMilliseconds: 0 });
  version = 2;
  const second = await discoverAozoraCandidates({ state: first.state, fetchImpl, catalogCacheMilliseconds: 0 });
  assert.deepEqual(second.candidates.map((candidate) => candidate.id), ['aozora-50', 'aozora-150']);
});

test('catalog budget failure leaves discovery cursor intact and permits retry', async () => {
  const state = { cursor: 5, seenWorkIds: ['42'], catalogSha256: 'prior' };
  let fail = true;
  const fetchImpl = async () => {
    if (fail) { const error = new Error('budget'); error.code = 'QUESTION_REQUEST_BUDGET'; throw error; }
    return bytesResponse(zipCsv(catalogCsv([csvRow(42), csvRow(43)])));
  };
  await assert.rejects(discoverAozoraCandidates({ state, fetchImpl }), { code: 'QUESTION_REQUEST_BUDGET' });
  assert.deepEqual(state, { cursor: 5, seenWorkIds: ['42'], catalogSha256: 'prior' });
  fail = false;
  assert.deepEqual((await discoverAozoraCandidates({ state, fetchImpl })).candidates.map((candidate) => candidate.id), ['aozora-43']);
});

test('Aozora text excludes metadata, ruby readings, editorial notes and footer', () => {
  const body = '<div class="sho1"><div>古い詩の引用。――詩人作</div></div>' +
    '少年は<ruby><rb>港</rb><rp>（</rp><rt>みなと</rt><rp>）</rp></ruby>へ行った。' +
    '<span class="notes">［＃説明］</span><div>老人に出会った。</div>';
  assert.equal(extractAozoraText(html(body), '小さな灯台'), '少年は港へ行った。老人に出会った。');
  assert.throws(() => extractAozoraText(html(body, '違う作品'), '小さな灯台'), /タイトル/u);
  assert.throws(() => extractAozoraText('<h1 class="title">小さな灯台</h1>', '小さな灯台'), /本文領域/u);
});

test('automatic narrative summary uses complete source sentences in original order', () => {
  const summary = summarizeNarrative(SENTENCES.join(''));
  assert(summary.synopsis.length >= 120 && summary.synopsis.length <= 450);
  assert.equal(summary.synopsis, summary.excerpts.join(''));
  const positions = summary.excerpts.map((sentence) => SENTENCES.indexOf(sentence));
  assert(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
  assert(positions.every((position, index) => !index || position === positions[index - 1] + 1), 'source passage stays contiguous');
  assert.throws(() => summarizeNarrative('短い文。'), /物語/u);
});

test('narrative extraction rejects commentary and avoids anthology preface before the story setup', () => {
  const essay = 'イギリス国民が漫画化した理想的な人物を観察するのは、文学と虚構の関係を考えるうえで興味深いことである。'.repeat(5);
  assert.throws(() => summarizeNarrative(essay), /物語/u);
  const preface = '前の章で文学について概括的な観察を述べたので、読者にはここでも同じ観点から小説家について考えていただきたい。';
  const summary = summarizeNarrative(preface + SENTENCES.join(''));
  assert(!summary.synopsis.includes('読者')); assert(!summary.synopsis.includes('概括的な観察'));
  assert(summary.excerpts.every((sentence) => SENTENCES.includes(sentence)));
  const detached = ['が、彼はそこで老人の話を聞いて母を助けようと決心し、妻と少年を連れて走った。',
    'そのうちに少年は娘と老人を連れて走り、彼女の母と父を助けに出かけた。'];
  const withDetachedLater = summarizeNarrative(SENTENCES.join('') + detached.join(''));
  assert(!withDetachedLater.synopsis.startsWith('が、彼')); assert(!withDetachedLater.synopsis.startsWith('そのうち'));
});

test('Aozora generation masks title and preserves source evidence and rights without invented licensing', async () => {
  const question = await generateAozoraQuestion(entry(), { fetchImpl: async () => bytesResponse(Buffer.from(html())),
    includeNDL: false, now: () => new Date('2026-10-01T01:02:03Z') });
  assert.equal(question.realTitle, '小さな灯台'); assert.equal(question.id, 'aozora-128');
  assert(!question.synopsis.includes(question.realTitle));
  assert.equal(question.generationMethod, 'extractive-v1');
  assert.equal(question.sources[0].license, '著作権なし（青空文庫公開情報）');
  assert.equal(question.sources[0].licenseUrl, undefined);
  assert.equal(question.sources[0].revisionId, undefined);
  assert.match(question.evidence.sourceTextSha256, /^[a-f0-9]{64}$/u);
  assert(question.evidence.excerpts.every((excerpt) => SENTENCES.includes(excerpt)));
  assert.equal(question.sources[0].retrievedAt, '2026-10-01T01:02:03.000Z');
  assert.equal(question.birthDate, undefined);
  assert.equal(question.sources[0].birthDate, undefined);
});

test('Aozora rejects protected works, unexpected source hosts, incorrect file titles and invented AI prose', async () => {
  const fetchImpl = async () => bytesResponse(Buffer.from(html()));
  await assert.rejects(generateAozoraQuestion({ ...entry(), copyright: 'あり' }, { fetchImpl }), /作品情報/u);
  await assert.rejects(generateAozoraQuestion({ ...entry(), textUrl: 'https://evil.example/file.html' }, { fetchImpl }), /作品URL/u);
  await assert.rejects(generateAozoraQuestion(entry(), { fetchImpl: async () => bytesResponse(Buffer.from(html('', '別の作品'))) }), /タイトル/u);
  await assert.rejects(generateAozoraQuestion(entry(), { fetchImpl, localAI: async () => ({ synopsis: '架空のあらすじ。', excerpts: ['架空のあらすじ。'] }) }), /出典本文/u);
});

test('local AI may select verifiable sentences and optional NDL outage does not discard generated question', async () => {
  const question = await generateAozoraQuestion(entry(), {
    fetchImpl: async (url) => {
      if (url.startsWith('https://ndlsearch')) { const error = new Error('budget'); error.code = 'QUESTION_REQUEST_BUDGET'; throw error; }
      return bytesResponse(Buffer.from(html()));
    }, localAI: async () => ({ synopsis: SENTENCES.slice(0, 5).join(''), excerpts: SENTENCES.slice(0, 5) }),
  });
  assert.equal(question.generationMethod, 'local-ai-v1'); assert.equal(question.sources.length, 1);
});

test('Aozora bounds local model context and labels foreign literary classification without claiming it is a novel', async () => {
  const question = await generateAozoraQuestion({ ...entry(), classification: 'NDC 933', kind: 'literary-work' }, {
    fetchImpl: async () => bytesResponse(Buffer.from(html(SENTENCES.join('').repeat(100)))), includeNDL: false,
    localAI: async ({ text }) => {
      assert(text.length <= 30000); assert(text.length > 120);
      return { synopsis: SENTENCES.slice(0, 5).join(''), excerpts: SENTENCES.slice(0, 5) };
    },
  });
  assert.equal(question.kind, 'literary-work');
});

test('NDL matches exact title and author rather than relying on search position or title substring', () => {
  const xml = `<rss>${ndlItem({ title: '小さな灯台作品集' })}${ndlItem({ creator: '別人 花子' })}${ndlItem()}</rss>`;
  const match = findMatchingRecord(xml, entry());
  assert.equal(match.url, 'https://ndlsearch.ndl.go.jp/books/R100000002-I000000001');
  assert.equal(match.archiveUrl, 'https://dl.ndl.go.jp/pid/1234567');
  assert.equal(findMatchingRecord(`<rss>${ndlItem({ title: '小さな灯台作品集' })}</rss>`, entry()), null);
  assert.equal(approvedNDLUrl('https://ndlsearch.ndl.go.jp.evil.example/books/R123'), null);
  assert.equal(approvedNDLUrl('https://dl.ndl.go.jp/pid/123?unsafe=1', 'archive'), null);
});

test('NDL rejects longer names and cross-person matches in aggregate author fields', () => {
  const expected = { ...entry(), author: '山田 太郎', authorParts: ['山田', '太郎'] };
  assert.equal(findMatchingRecord(`<rss>${ndlItem({ creator: '山田, 太郎次郎, 1900-1970' })}</rss>`, expected), null);
  const crossed = ndlItem({ creator: '山田, 花子' }).replace('</item>',
    '<dc:creator>佐藤, 太郎</dc:creator><author>山田 花子,佐藤 太郎</author></item>');
  assert.equal(findMatchingRecord(`<rss>${crossed}</rss>`, expected), null);
  const coauthors = ndlItem({ creator: '佐藤, 花子' }).replace('</item>',
    '<dc:creator>山田, 太郎 [著]</dc:creator></item>');
  assert(findMatchingRecord(`<rss>${coauthors}</rss>`, expected));
});

test('NDL compares known birth and death years, rejects contradictions and preserves older candidate compatibility', () => {
  const expected = { ...entry(), birthDate: '1900-01-01', deathDate: '1970-12-31' };
  assert(findMatchingRecord(`<rss>${ndlItem()}</rss>`, expected));
  assert.equal(findMatchingRecord(`<rss>${ndlItem({ creator: '物語, 太郎, 1980-' })}</rss>`, expected), null);
  assert.equal(findMatchingRecord(`<rss>${ndlItem({ creator: '物語, 太郎, 1900-1950' })}</rss>`, expected), null);
  assert(findMatchingRecord(`<rss>${ndlItem({ creator: '物語 太郎 [著]' })}</rss>`, expected), 'missing NDL dates do not contradict known author');
  const conflictingDuplicate = ndlItem({ creator: '物語, 太郎, 1980-' }).replace('</item>',
    '<dc:creator>物語 太郎</dc:creator></item>');
  assert.equal(findMatchingRecord(`<rss>${conflictingDuplicate}</rss>`, expected), null,
    'undated duplicate name cannot hide explicitly contradictory lifespan');
  assert(findMatchingRecord(`<rss>${ndlItem({ creator: '物語, 太郎, 1900-1970' })}</rss>`, entry()), 'saved older candidates may lack lifespan fields');
});

test('NDL uses individual creator records before cautiously falling back to a single author field', () => {
  const expected = { ...entry(), author: '山田 太郎', authorParts: ['山田', '太郎'] };
  const disagreement = ndlItem({ creator: '佐藤 花子' }).replace('</item>', '<author>山田 太郎</author></item>');
  assert.equal(findMatchingRecord(`<rss>${disagreement}</rss>`, expected), null);
  const noCreators = (author) => ndlItem({ creator: 'unused' }).replace('<dc:creator>unused</dc:creator>', `<author>${author}</author>`);
  assert(findMatchingRecord(`<rss>${noCreators('山田 太郎 [著]')}</rss>`, expected));
  assert(findMatchingRecord(`<rss>${noCreators('山田太郎著')}</rss>`, expected), 'NDL role suffix may have no separator');
  assert.equal(findMatchingRecord(`<rss>${noCreators('山田 花子,佐藤 太郎')}</rss>`, expected), null);
  assert(findMatchingRecord(`<rss>${noCreators('山田, 太郎, 1900-1970')}</rss>`, expected));
});

test('NDL enrichment attaches verified bibliography and corresponding digital archive without fabricating synopsis', async () => {
  const fetchImpl = async (url) => { const requested = new URL(url);
    assert.equal(requested.searchParams.get('title'), entry().title);
    assert.equal(requested.searchParams.get('creator'), entry().author);
    return { ok: true, headers: { get: () => null }, text: async () => `<rss>${ndlItem()}</rss>` }; };
  const source = await findNDLBibliography(entry(), { fetchImpl });
  assert.equal(source.role, 'bibliography'); assert.equal(source.license, undefined);
  const before = { synopsis: '原資料から自動要約した文章。', sources: [{ provider: 'aozora' }] };
  const enriched = await enrichWithNDL(before, entry(), { fetchImpl });
  assert.equal(enriched.synopsis, before.synopsis); assert.equal(enriched.sources.length, 3);
  assert.equal(enriched.sources[2].role, 'archive'); assert.equal(before.sources.length, 1);
});

function discoveryItem({ title = '空の航海', recordId = 'R100000002-I000000077',
  creators = ['山田, 太郎, 1900-1970'], categories = ['図書', '紙'], classification = '726.1',
  genres = ['漫画'], volume = null, descriptions = ['初版発行 2000'], author = null } = {}) {
  const xml = (value) => String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  return `<item><dc:title>${xml(title)}</dc:title><link>https://ndlsearch.ndl.go.jp/books/${recordId}</link>` +
    creators.map((creator) => `<dc:creator>${xml(creator)}</dc:creator>`).join('') +
    (author ? `<author>${xml(author)}</author>` : '') + categories.map((category) => `<category>${xml(category)}</category>`).join('') +
    (classification ? `<dc:subject xsi:type="dcndl:NDC10">${classification}</dc:subject>` : '') +
    genres.map((genre) => `<dcndl:genre>${xml(genre)}</dcndl:genre>`).join('') +
    (volume ? `<dcndl:volume>${xml(volume)}</dcndl:volume>` : '') +
    `<dcterms:issued>2000.1</dcterms:issued>` +
    descriptions.map((description) => `<dc:description>${xml(description)}</dc:description>`).join('') + '</item>';
}
function searchRSS(items, total = items.length) {
  return `<rss><channel><openSearch:totalResults>${total}</openSearch:totalResults>${items.join('')}</channel></rss>`;
}
function xmlResponse(xml) { return { ok: true, status: 200, headers: { get: () => null }, text: async () => xml }; }
function ndlCandidate(overrides = {}) {
  return parseSearchPage(searchRSS([discoveryItem(overrides)]), NDL_SEARCHES[0]).candidates[0];
}
function wikiPage({ author = '山田太郎', kind = 'manga', title = '空の航海 (漫画)', pageid = 77 } = {}) {
  const types = { manga: '漫画作品', novel: '小説作品', song: '楽曲', album: 'アルバム', 'music-work': '楽曲' };
  return { pageid, ns: 0, title, canonicalurl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    extract: `『${title.replace(/ \(.*\)$/u, '')}』は、${author}による日本の${types[kind]}である。\n\n== あらすじ ==\n${SENTENCES.join('')}`,
    revisions: [{ revid: 500 }], lastrevid: 500, categories: [{ title: `Category:日本の${types[kind]}` }] };
}
function resolverFetch(page, { failArticle = null } = {}) {
  return async (value) => {
    const url = new URL(value);
    assert.equal(url.hostname, 'ja.wikipedia.org');
    if (url.searchParams.get('list') === 'search') return { ok: true, json: async () => ({ query: { search: [{ pageid: page.pageid, title: page.title }] } }) };
    if (failArticle) throw failArticle;
    return { ok: true, status: 200, json: async () => ({ query: { pages: [page] } }) };
  };
}

test('NDL discovery is independent and paginated by genres, preserving buffered candidates and source metadata', async () => {
  const requests = [];
  const fetchImpl = async (value) => {
    const url = new URL(value); requests.push(url);
    assert.equal(url.hostname, 'ndlsearch.ndl.go.jp');
    if (url.searchParams.has('ndc')) return xmlResponse(searchRSS([
      discoveryItem({ title: '空の航海. 1', volume: '1' }),
      discoveryItem({ title: '月の図書館', recordId: 'R100000002-I000000078' }),
    ], 100));
    return xmlResponse(searchRSS([discoveryItem({ title: '夜明けの歌', recordId: 'R100000002-I000000079',
      categories: ['録音資料', '記録メディア'], classification: null, genres: ['音楽'], creators: [], author: 'Superfly' })], 100));
  };
  const first = await discoverNDLCandidates({ limit: 1, maxRequests: 1, fetchImpl });
  assert.equal(first.candidates[0].title, '空の航海');
  assert.equal(first.candidates[0].ndl.originalTitle, '空の航海. 1');
  assert.equal(first.candidates[0].ndl.volume, '1');
  assert.equal(first.candidates[0].ndl.authors[0].name, '山田太郎');
  assert.equal(first.candidates[0].ndl.authors[0].birthYear, 1900);
  assert.equal(first.candidates[0].ndl.publishedYear, 2000);
  assert.equal(first.state.cursors.manga, 3);
  const second = await discoverNDLCandidates({ state: first.state, limit: 2, maxRequests: 1, fetchImpl });
  assert.equal(second.candidates.length, 2);
  assert.equal(second.candidates[0].title, '月の図書館');
  assert.equal(second.candidates[1].kind, 'music-work');
  assert.equal(requests[1].searchParams.get('any'), '音楽');
  assert.equal(first.state.pendingCandidates.length, 1, 'incoming state is not mutated');
});

test('NDL material classification rejects review articles and film research books as movie candidates', () => {
  const movieSearch = NDL_SEARCHES.find((search) => search.id === 'film');
  const xml = searchRSS([
    discoveryItem({ categories: ['記事', 'デジタル'], classification: null, genres: [] }),
    discoveryItem({ categories: ['図書', '紙'], classification: '778', genres: [] }),
    discoveryItem({ title: '空の航海', recordId: 'R100000002-I000000080', categories: ['映像資料', '記録メディア'], classification: null, genres: ['映画'] }),
  ]);
  const page = parseSearchPage(xml, movieSearch);
  assert.equal(page.itemCount, 3); assert.equal(page.candidates.length, 1); assert.equal(page.candidates[0].kind, 'film');
});

test('NDL page failures keep their cursor for retry without corrupting prior progress', async () => {
  const state = { version: 1, nextQueryIndex: 0, cursors: { manga: 41 }, seenRecordIds: [] };
  const error = new Error('request budget'); error.code = 'QUESTION_REQUEST_BUDGET';
  const result = await discoverNDLCandidates({ state, limit: 2, maxRequests: 1, fetchImpl: async () => { throw error; } });
  assert.equal(result.state.cursors.manga, 41); assert.equal(result.candidates.length, 0);
  assert.equal(state.nextQueryIndex, 0); assert.equal(state.cursors.manga, 41);
  assert.equal(result.errors.length, 1);
});

test('NDL subsequent full scans wait seven days from each new completion while retaining discovered records', async () => {
  const seenRecordIds = ['R100000002-I000000077'];
  const initial = { version: 1, nextQueryIndex: 0, cursors: { manga: 100 }, seenRecordIds,
    exhaustedQueries: NDL_SEARCHES.map((search) => search.id), lastFullScanAt: '2026-09-01T00:00:00.000Z' };
  let requests = 0;
  const fetchImpl = async () => { requests++; return xmlResponse(searchRSS([], 0)); };
  const options = { limit: 1, maxRequests: NDL_SEARCHES.length, fetchImpl };
  const second = await discoverNDLCandidates({ ...options, state: initial, now: () => new Date('2026-09-10T00:00:00Z') });
  assert.equal(second.requests, NDL_SEARCHES.length); assert.equal(second.exhausted, true);
  assert.equal(second.state.lastFullScanAt, '2026-09-10T00:00:00.000Z');
  assert.deepEqual(second.state.seenRecordIds, seenRecordIds);
  const nextDay = await discoverNDLCandidates({ ...options, state: second.state, now: () => new Date('2026-09-11T00:00:00Z') });
  assert.equal(nextDay.requests, 0, 'the previous cycle completion must not trigger an immediate new rescan');
  const third = await discoverNDLCandidates({ ...options, state: nextDay.state, now: () => new Date('2026-09-18T00:00:00Z') });
  assert.equal(third.requests, NDL_SEARCHES.length);
  assert.equal(third.state.lastFullScanAt, '2026-09-18T00:00:00.000Z');
  const afterThird = await discoverNDLCandidates({ ...options, state: third.state, now: () => new Date('2026-09-19T00:00:00Z') });
  assert.equal(afterThird.requests, 0);
  assert.equal(requests, NDL_SEARCHES.length * 2); assert.deepEqual(afterThird.state.seenRecordIds, seenRecordIds);
});

test('NDL numeric title endings are retained unless explicit volume metadata provides a boundary', () => {
  assert.deepEqual(splitExplicitVolume('作品. 1', null, 'manga'), { title: '作品. 1', separated: false });
  assert.deepEqual(splitExplicitVolume('作品. 1', '1', 'manga'), { title: '作品', separated: true });
  assert.deepEqual(splitExplicitVolume('1984', '4', 'novel'), { title: '1984', separated: false });
  assert.deepEqual(splitExplicitVolume('作品1', '1', 'manga'), { title: '作品1', separated: false });
  assert.deepEqual(splitExplicitVolume('作品. 2', '1', 'manga'), { title: '作品. 2', separated: false });
});

test('NDL resolves a manga through verified article and author, preserving original volume bibliography', async () => {
  const candidate = ndlCandidate({ title: '空の航海. 1', volume: '1' });
  const question = await generateNDLQuestion(candidate, { fetchImpl: resolverFetch(wikiPage()) });
  assert.equal(question.realTitle, '空の航海'); assert.equal(question.kind, 'manga');
  assert.equal(question.sources[0].provider || 'wikipedia', 'wikipedia');
  assert.equal(question.sources[1].provider, 'ndl'); assert.equal(question.sources[1].originalTitle, '空の航海. 1');
  assert.equal(question.sources[1].volume, '1'); assert(!question.synopsis.includes(question.realTitle));
});

test('NDL rejects wrong creator, wrong work type and unauthored volume resolution', async () => {
  const candidate = ndlCandidate();
  await assert.rejects(generateNDLQuestion(candidate, { fetchImpl: resolverFetch(wikiPage({ author: '佐藤花子' })) }), /一致する解説/u);
  await assert.rejects(generateNDLQuestion(candidate, { fetchImpl: resolverFetch(wikiPage({ kind: 'novel' })) }), /一致する解説/u);
  const anonymous = ndlCandidate({ title: '空の航海. 1', volume: '1', creators: [], author: null });
  await assert.rejects(generateNDLQuestion(anonymous, { fetchImpl: resolverFetch(wikiPage()) }), /著者がありません/u);
  const unknownAuthor = ndlCandidate({ creators: [], author: null });
  let requests = 0;
  await assert.rejects(generateNDLQuestion(unknownAuthor, { fetchImpl: async () => { requests++; return {}; } }), /作者・アーティストがありません/u);
  assert.equal(requests, 0, 'a same-title article cannot establish that an unauthored catalog record is the same work');
  await assert.rejects(generateNDLQuestion({ ...candidate, kind: 'song' }, { fetchImpl: resolverFetch(wikiPage()) }), /資料種別/u);
});

test('NDL resolver propagates temporary curl/network failures for collector retry', async () => {
  const error = new Error('temporary transport outage'); error.code = 7;
  await assert.rejects(generateNDLQuestion(ndlCandidate(), { fetchImpl: resolverFetch(wikiPage(), { failArticle: error }) }), { code: 7 });
});

test('NDL audio material refines song or album subtype using the verified article without refetching it', async () => {
  const candidate = parseSearchPage(searchRSS([discoveryItem({ title: '夜明けの音', categories: ['録音資料'],
    classification: null, genres: [], creators: [], author: 'Superfly' })]),
  NDL_SEARCHES.find((search) => search.id === 'music')).candidates[0];
  const explanation = 'このアルバムは、旅立ちと家族のつながりを主題とした曲を中心に構成されている。' +
    'アコースティック楽器を中心としたサウンドに、軽快なリズムと透明な歌唱を組み合わせている。' +
    '静かな音色から力強い旋律へと変化する構成が特徴で、希望と孤独という二つのテーマを対比させている。' +
    '全体を通じて穏やかな音色が保たれ、家族との別れを歌詞の情景と繊細な編曲で表現している。';
  const page = wikiPage({ author: 'Superfly', kind: 'album', title: '夜明けの音 (アルバム)' });
  page.extract = `『夜明けの音』は、Superflyによるアルバムである。\n\n== 内容 ==\n${explanation}`;
  let requests = 0;
  const underlying = resolverFetch(page);
  const question = await generateNDLQuestion(candidate, { fetchImpl: async (...args) => { requests++; return underlying(...args); } });
  assert.equal(question.kind, 'album'); assert.equal(question.contentType, 'description');
  assert.equal(requests, 2, 'one search request and one article request cover subtype checks');
});

test('NDL explicit content introduction may become a sourced description without inventing a license or body', async () => {
  const candidate = ndlCandidate({ descriptions: [`内容紹介: ${SENTENCES.join('')}`] });
  let networkRequests = 0;
  const question = await generateNDLQuestion(candidate, { fetchImpl: async () => { networkRequests++; throw new Error('unneeded'); } });
  assert.equal(networkRequests, 0); assert.equal(question.sources[0].provider, 'ndl');
  assert.equal(question.contentType, 'description'); assert.equal(question.evidence.section, '内容紹介');
  assert.equal(question.evidence.sourceId, 'ndl-R100000002-I000000077');
  assert.equal(question.sources[0].license, undefined); assert.equal(question.sources[0].licenseUrl, undefined);
  assert(question.evidence.excerpts.every((excerpt) => SENTENCES.includes(excerpt)));
  const plot = await generateNDLQuestion(ndlCandidate({ descriptions: [`あらすじ: ${SENTENCES.join('')}`] }));
  assert.equal(plot.contentType, 'synopsis');
});

test('NDL edition notes, contents lists and wrongly classified metadata are not plot sources', () => {
  for (const description of ['初版発行2000年、本文240頁。', `内容紹介: 目次 第一章 海への旅。${SENTENCES.join('')}`,
    `内容細目: ${SENTENCES.join('')}`, '内容紹介: 短い説明。']) {
    assert.equal(explicitIntroduction(ndlCandidate({ descriptions: [description] })), null);
  }
  const recording = parseSearchPage(searchRSS([discoveryItem({ categories: ['録音資料'], classification: null, genres: [],
    descriptions: [`内容紹介: ${SENTENCES.join('')}`] })]), NDL_SEARCHES.find((search) => search.id === 'music')).candidates[0];
  assert.equal(explicitIntroduction(recording), null, 'audio material alone does not prove musical work genre');
  const genreFixture = (kind, description, overrides = {}) => {
    const search = NDL_SEARCHES.find((entry) => entry.kind === kind);
    return parseSearchPage(searchRSS([discoveryItem({ classifications: [], ...overrides,
      descriptions: [`内容紹介: ${description}`] })]), search).candidates[0];
  };
  const quotedPoem = genreFixture('poem', `「${SENTENCES.join('')}」。`, { classification: '911', genres: ['詩'] });
  assert.equal(explicitIntroduction(quotedPoem), null, 'a whole quoted poem is not explanatory description');
  const rawLyrics = genreFixture('song', `歌詞: ${'少年は風に向かって歌い、夜の空へ願いを届ける。'.repeat(12)}`,
    { categories: ['録音資料'], classification: null, genres: ['楽曲'] });
  assert.equal(explicitIntroduction(rawLyrics), null);
  const tracks = genreFixture('album', `収録曲: ${'夜のサウンド。春の歌。夏の夢。'.repeat(12)}`,
    { categories: ['録音資料'], classification: null, genres: ['アルバム'] });
  assert.equal(explicitIntroduction(tracks), null);
  const criticism = ndlCandidate({ descriptions: [`内容紹介: 漫画の描き方を解説する研究書である。${SENTENCES.join('')}`] });
  assert.equal(explicitIntroduction(criticism), null, 'a comic criticism book is not accepted as the manga itself');
});

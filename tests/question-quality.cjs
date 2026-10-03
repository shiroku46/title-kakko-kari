const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { introductionSentenceIsUsable, MAX_LENGTH } = require('../server/src/questions/quality');
const { sourceSentences, summarizeExtractively } = require('../server/src/questions/generator');
const { extractWebWork } = require('../server/src/questions/web-source');
const { questionIsValid, prepareQuestion } = require('../server/src/questions/validation');
const { createQuestionService } = require('../server/src/questions/service');

const sentences = [
  '海辺の村に暮らす少年は、嵐の翌朝、壊れた舟のそばで見知らぬ旅人を見つけた。',
  '旅人は遠く離れた島から来たと言い、行方のわからなくなった妹を探していると話した。',
  '少年は灯台の番人である祖父に相談し、旅人とともに村の古い港を訪ねることにした。',
  '港で出会った老人の話を聞きながら、二人は家族の秘密と島に残された約束に向き合うことになる。',
  '少年と旅人は危険な夜の海に舟を出し、離ればなれになった家族を再び会わせようと決心した。',
];
const story = sentences.join('');
const noise = '定価：1980円。ISBN：9781234567890。著者は東京で生まれ、大学を卒業して作家としてデビューした。購入はこちらをクリックしてください。読んだ感想として、友人にもおすすめします。芥川賞受賞の気鋭が医師としての経験を元に描いた、受賞後初の単行本。';
const page = (markup) => `<title>港の約束 | 小説</title><h1>港の約束</h1>${markup}`;

function storedQuestion(text, changes = {}) {
  text = text.normalize('NFKC');
  return { id: 'quality-test', realTitle: '港の約束', aliases: [], kind: 'novel', synopsis: text,
    sources: [{ label: 'Wikipedia：港の約束', url: 'https://ja.wikipedia.org/wiki/'+encodeURIComponent('港の約束')+'?oldid=100',
      revisionId: 100, retrievedAt: '2026-10-03T00:00:00Z', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
    generationMethod: 'extractive-v1', evidence: { sourceId: 'wikipedia-ja-1-100', section: 'あらすじ',
      sourceTextSha256: createHash('sha256').update(text).digest('hex'), excerpts: sourceSentences(text) }, ...changes };
}

test('nested reviews, biographies, purchase controls and headings never enter a Web introduction', () => {
  for (const markup of [
    `<h2>内容紹介</h2><p>${sentences[0]}</p><div class="related-products"><div>${noise}</div></div>`+
      `<h3>レビュー</h3><p>${noise}</p><h4>読者の声</h4><p>${noise}</p><h4>感想</h4><p>${noise}</p>`+
      `<h3>ストーリーの続き</h3><p>${sentences.slice(1).join('')}</p><h2>著者紹介</h2>${noise}`,
    `<div class="productDescription"><p>${sentences[0]}</p><aside>${noise}</aside><form>${noise}</form>`+
      `<div class="author-profile">${noise}</div><table><tr><td>${noise}</td></tr></table>`+
      `<div hidden>${noise}</div><div aria-hidden="true">${noise}</div><p>${sentences.slice(1).join('')}</p></div>`,
  ]) {
    const q = extractWebWork(page(markup), 'https://publisher.example.org/book/1', 'novel');
    assert.ok(q.synopsis.length >= 120 && q.synopsis.length <= MAX_LENGTH);
    assert.ok(!/定価|ISBN|著者は|購入|感想/u.test(q.synopsis));
    assert.ok(q.evidence.excerpts.every((excerpt) => sentences.includes(excerpt)));
  }
});

test('introduction-looking descendants of a review or author section cannot become a source', () => {
  for (const markup of [
    `<h2>レビュー</h2><h3>あらすじ</h3><p>${story}</p>`,
    `<h2>著者紹介</h2><div class="description">${story}</div>`,
  ]) assert.throws(() => extractWebWork(page(markup), 'https://publisher.example.org/book/1', 'novel'));
});

test('the visible bounded synopsis takes precedence over a retailer structured description', () => {
  const metadata = `<script type="application/ld+json">${JSON.stringify({ '@type':'Book', name:'港の約束', genre:'小説', description:noise.repeat(4) })}</script>`;
  const q = extractWebWork(page(metadata+`<h2>あらすじ</h2>${story}`), 'https://shop.example.org/work/1', 'novel');
  assert.equal(q.evidence.section, 'あらすじ');
  assert.ok(!q.synopsis.includes('ISBN'));
  assert.throws(() => extractWebWork(page(metadata), 'https://shop.example.org/work/1', 'novel'));
});

test('promotion, bibliography and author biography sentences are filtered even without HTML markers', () => {
  const q = summarizeExtractively(noise+story);
  assert.ok(q.excerpts.every((excerpt) => sentences.includes(excerpt)));
  assert.throws(() => summarizeExtractively(noise.repeat(5)));
});

test('old orthography, classical prose and non-Japanese descriptions are not emitted', () => {
  for (const text of [
    '少年は海を見てゐた。旅人は島に帰らうと思ひ、家族に会ふことを願った。'.repeat(5),
    'いづれの御時にか、女御更衣あまたさぶらひ給ひけり。'.repeat(8),
    'A young traveller leaves the village and follows a mysterious letter to find his lost family!'.repeat(4),
    '「これは昔の物語なり。」'.repeat(12),
  ]) assert.throws(() => summarizeExtractively(text));
  assert.equal(introductionSentenceIsUsable('江戸時代の村を舞台に、失われた約束を探す少年と旅人の物語を描く。'), true);
  assert.ok(summarizeExtractively(story).synopsis.length >= 120, 'old works can use a modern introduction');
});

test('long sources produce complete ordered sentences within the shared display limit', () => {
  const q = summarizeExtractively(story.repeat(20), { maxLength: 10000 });
  assert.ok(q.synopsis.length <= 280);
  assert.equal(q.synopsis, q.excerpts.join(''));
  assert.ok(q.excerpts.every((s) => sentences.includes(s)));
  assert.ok(q.synopsis.endsWith('。'));
  assert.throws(() => summarizeExtractively('長い文の途中を切って表示することはできない'.repeat(20)+'。'));
});

test('saved long or mixed introductions are shortened with matching evidence and without altering the stored object', () => {
  const q = storedQuestion(noise+story+story);
  const before = JSON.stringify(q);
  const prepared = prepareQuestion(q);
  assert.ok(prepared && questionIsValid(prepared));
  assert.ok(prepared.synopsis.length <= 280);
  assert.ok(!/購入|ISBN|著者は/u.test(prepared.synopsis));
  assert.equal(prepared.synopsis, prepared.evidence.excerpts.join(''));
  assert.equal(prepared.evidence.sourceTextSha256, q.evidence.sourceTextSha256);
  assert.equal(JSON.stringify(q), before);
});

test('saved primary text, old prose, trailing fragments and mismatched evidence fail closed', () => {
  const good = storedQuestion(story);
  for (const q of [
    { ...good, evidence: { ...good.evidence, section: '本文' } },
    storedQuestion('少年は海を見てゐた。'.repeat(30)),
    { ...good, synopsis: '資料と一致しない紹介。'.repeat(20) },
  ]) { assert.equal(questionIsValid(q), false); assert.equal(prepareQuestion(q), null); }
  const fragment = storedQuestion(story);
  fragment.synopsis += 'これは文の途中';
  fragment.evidence.excerpts.push('これは文の途中');
  assert.equal(questionIsValid(fragment), false);
  const prepared = prepareQuestion(fragment);
  assert.ok(prepared && !prepared.synopsis.includes('文の途中'));
});

test('selection and collection apply saved-quality checks without deleting rejected stored records', async (t) => {
  const directory = mkdtempSync(join(tmpdir(),'title-quality-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const bankPath = join(directory,'bank.json');
  const good = storedQuestion(story.repeat(3));
  const old = storedQuestion('少年は海を見てゐた。'.repeat(30), { id:'old-text' });
  old.sources[0].url = 'https://ja.wikipedia.org/wiki/'+encodeURIComponent('古い作品')+'?oldid=100';
  writeFileSync(bankPath,JSON.stringify({ schemaVersion:1,questions:[good,old] }));
  let received;
  const service = createQuestionService({ bankPath, minimumAvailable: 1, collectImpl: async ({ questions,state }) => {
    received = questions;
    return { questions,state,added:[],rejected:[],requests:0 };
  } });
  t.after(()=>service.stop());
  const chosen = await service.selectQuestion();
  assert.equal(chosen.id,good.id); assert.ok(chosen.synopsis.length<=280);
  assert.equal(JSON.parse(readFileSync(bankPath,'utf8')).questions.length,2);
  await service.collectNow();
  assert.deepEqual(received.map(q=>q.id),[good.id]);
  assert.ok(questionIsValid(received[0]));
  assert.equal(JSON.parse(readFileSync(bankPath,'utf8')).questions.length,2);
});

test('ratings and article guidance cannot enter the synopsis as sentence prefixes', () => {
  for (const sentence of [
    'IMDb 1位・1994 冤罪の終身刑を受けた銀行員は、刑務所で友人と出会う。',
    'ここからは、水属性の魔法使いのあらすじをざっくり押さえていきましょう。',
    'この記事では、作品のあらすじを紹介していきます。',
  ]) assert.equal(introductionSentenceIsUsable(sentence),false);
});

test('ASCII and full-width exclamation/question marks keep complete sentences and remove retail promotion separately', () => {
  const prefix='とよ田みのる最新作は、漫画家漫画！待望の新作をすべての人に届けます！';
  const source=prefix+story+'※こちらの商品には限定特典イラストが収録されています。';
  const q=summarizeExtractively(source);
  assert.ok(!/最新作|待望|特典/u.test(q.synopsis));
  assert.ok(q.excerpts.every(s=>sentences.includes(s)));
  assert.deepEqual(sourceSentences('彼は船に乗る!島に家族はいるのか!?少年は港を目指した。'),
    ['彼は船に乗る!','島に家族はいるのか!?','少年は港を目指した。']);
});

test('Latin names in quoted works do not reject an otherwise Japanese introduction', () => {
  assert.equal(introductionSentenceIsUsable('STEINS;GATEは「CHAOS;HEAD NOAH」に続く科学アドベンチャーシリーズの第2弾です。'),true);
  assert.equal(introductionSentenceIsUsable('A young traveller follows a secret letter and finds his family in the village!'),false);
});

// Rules are exercised with complete sourced questions, not only string matching.
test('numbered sequel titles are excluded without discarding numeric names or phrases', () => {
  const { playableTitle } = require('../server/src/questions/title-policy');
  for (const title of ['小説 ヒトラー II 戦前篇', '三体Ⅱ 黒暗森林', 'ファイナルファンタジーVII',
    '港の約束2', '港の約束 2: 帰還', '港の約束 (2)', '港の約束 二', '港の約束 第三部',
    '港の約束 PART II', '港の約束 前編', '港の約束 後篇', '続・港の約束', '港の約束II(オリジナル版)']) {
    const q = storedQuestion(story, { realTitle: title });
    assert.equal(playableTitle(title, 'novel'), null, title);
    assert.equal(questionIsValid(q), false, title);
    assert.equal(prepareQuestion(q), null, title);
    assert.throws(() => extractWebWork(`<title>${title} | 小説</title><h1>${title}</h1><h2>あらすじ</h2>${story}`,
      'https://publisher.example.org/work/1', 'novel'), /出題対象外/, title);
  }
  for (const title of ['1984', '三体', '七人の侍', '秒速5センチメートル', '2001年宇宙の旅', '海の100年', 'I, ROBOT', '吸血鬼ハンターD']) {
    assert.equal(playableTitle(title, 'film'), title);
    assert.ok(questionIsValid(storedQuestion(story, { realTitle: title })));
  }
});

test('saved edition and volume titles become base answers, remask both names and preserve original evidence', () => {
  const { redactTitle } = require('../server/src/questions/generator');
  for (const [title, baseTitle, kind] of [
    ['ストレイト・ストーリー 4Kリマスター版', 'ストレイト・ストーリー', 'film'],
    ['STEINS;GATE(オリジナル版)', 'STEINS;GATE', 'game'],
    ['Journey HD Remaster', 'Journey', 'game'],
    ['港の約束【新装版】', '港の約束', 'novel'],
    ['港の約束 (1)', '港の約束', 'manga'],
    ['港の約束 12巻', '港の約束', 'manga'],
    ['港の約束(分冊版)第1話', '港の約束', 'manga'],
  ]) {
    const sourceText = `${title}は、海を渡る少年が失われた家族の手紙を探す物語である。${story}${baseTitle}の舞台には静かな港町と遠い島が登場する。`;
    const q = storedQuestion(sourceText, { realTitle: title, kind });
    q.synopsis = redactTitle(sourceText, [title]);
    q.sources[0].url = 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(title) + '?oldid=100';
    const before = JSON.stringify(q);
    const prepared = prepareQuestion(q);
    assert.ok(prepared && questionIsValid(prepared), title);
    assert.equal(prepared.realTitle, baseTitle);
    assert.ok(prepared.aliases.includes(title));
    assert.ok(!prepared.synopsis.includes(baseTitle));
    assert.equal(prepared.evidence.sourceTextSha256, q.evidence.sourceTextSha256);
    assert.deepEqual(prepared.sources, q.sources);
    assert.equal(JSON.stringify(q), before);
    assert.equal(prepareQuestion(prepared), prepared, 'preparation is idempotent');
  }
});

test('saved Web evidence must still identify the original work after edition normalization', async () => {
  const { generateWebQuestion } = require('../server/src/questions/web-source');
  const title = '港の約束 4Kリマスター版';
  const q = await generateWebQuestion({url:'https://film.example.org/',kind:'film'}, {
    fetchImpl:async()=>new Response(`<title>映画『${title}』公式サイト</title><h2>STORY</h2>${story}`,{headers:{'content-type':'text/html'}}),
  });
  assert.equal(q.realTitle,'港の約束');
  assert.equal(questionIsValid(q),true);
  const legacy = { ...q, realTitle:title, aliases:[], evidence:{ ...q.evidence, work:{ ...q.evidence.work,title } } };
  assert.ok(questionIsValid(prepareQuestion(legacy)));
  for (const wrongTitle of ['別の作品', '港の約束 II']) {
    const bad = {...legacy,evidence:{...legacy.evidence,work:{...legacy.evidence.work,title:wrongTitle}}};
    assert.equal(prepareQuestion(bad),null);
  }
});

test('selection skips numbered saved works and presents editions with their base title without deleting records', async (t) => {
  const directory = mkdtempSync(join(tmpdir(),'title-policy-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const bankPath = join(directory,'bank.json');
  const sequel = storedQuestion(story,{id:'sequel',realTitle:'港の約束 II'});
  const edition = storedQuestion(story,{id:'edition',realTitle:'港の約束(オリジナル版)',kind:'game'});
  writeFileSync(bankPath,JSON.stringify({schemaVersion:1,questions:[sequel,edition]}));
  const service = createQuestionService({bankPath,enabled:false});
  t.after(()=>service.stop());
  const q = await service.selectQuestion();
  assert.equal(q.id,'edition');assert.equal(q.realTitle,'港の約束');
  assert.deepEqual(JSON.parse(readFileSync(bankPath,'utf8')).questions.map(q=>q.realTitle),['港の約束 II','港の約束(オリジナル版)']);
});

test('NDL direct introductions apply the same title policy before fallback and preserve bibliography', async () => {
  const { NDL_SEARCHES, parseSearchPage, generateNDLQuestion } = require('../server/src/questions/ndl-discovery');
  const candidate = title => parseSearchPage(`<rss><channel><openSearch:totalResults>1</openSearch:totalResults>`+
    `<item><dc:title>${title}</dc:title><link>https://ndlsearch.ndl.go.jp/books/R100000002-I000000077</link>`+
    `<dc:creator>山田太郎</dc:creator><category>図書</category><dc:subject xsi:type="dcndl:NDC10">726.1</dc:subject>`+
    `<dcndl:genre>漫画</dcndl:genre><dc:description>あらすじ: ${story}</dc:description></item></channel></rss>`,
    NDL_SEARCHES[0]).candidates[0];
  let calls=0;
  const fetchImpl=async()=>{calls++;throw new Error('must not fetch');};
  await assert.rejects(generateNDLQuestion(candidate('港の約束 II'),{fetchImpl}),/出題対象外/);
  const q=await generateNDLQuestion(candidate('港の約束(新装版)'),{fetchImpl});
  assert.equal(calls,0);assert.equal(q.realTitle,'港の約束');
  assert.ok(q.aliases.includes('港の約束(新装版)'));assert.equal(q.sources[0].provider,'ndl');
  assert.equal(questionIsValid(q),true);
});

test('title-bearing sentences are omitted and complete later source sentences fill the introduction', async () => {
  const { summarizeWithoutTitles } = require('../server/src/questions/generator');
  const named = '「港の約束」は、家族の再会を描く小説である。';
  const source = named + sentences[0] + '港の約束という作品では旅人が登場する。' + sentences.slice(1).join('');
  const summary = summarizeWithoutTitles(source, ['港の約束']);
  assert.ok(summary.synopsis.length >= 120 && summary.synopsis.length <= 280);
  assert.ok(!/港の約束|■■■/u.test(summary.synopsis));
  assert.ok(summary.excerpts.every(sentence => sentences.includes(sentence)));
  assert.equal(summary.synopsis, summary.excerpts.join(''));
  const { generateWebQuestion } = require('../server/src/questions/web-source');
  const web = await generateWebQuestion({url:'https://publisher.example.org/book/1',kind:'novel'},
    {fetchImpl:async()=>new Response(page(`<h2>あらすじ</h2>${source}`),{headers:{'content-type':'text/html'}})});
  assert.equal(questionIsValid(web), true);
  assert.ok(!/港の約束|■■■/u.test(web.synopsis));
  assert.equal(web.evidence.sourceTextSha256, createHash('sha256').update(source).digest('hex'));
});

test('legacy masks are replaced by sentence omission without changing records or source hashes', () => {
  const { redactTitle } = require('../server/src/questions/generator');
  const source = '「港の約束」は海辺の村の少年を描く小説である。' + story;
  const saved = storedQuestion(source);
  saved.synopsis = redactTitle(source, [saved.realTitle]);
  const before = JSON.stringify(saved);
  assert.equal(questionIsValid(saved), false);
  const prepared = prepareQuestion(saved);
  assert.ok(prepared && questionIsValid(prepared));
  assert.ok(!/港の約束|■■■/u.test(prepared.synopsis));
  assert.equal(prepared.evidence.sourceTextSha256, saved.evidence.sourceTextSha256);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(prepareQuestion({...saved, synopsis:saved.synopsis+'改変。'}), null);
  const shortSource = '港の約束をめぐり少年と旅人が島を訪ねる物語。'.repeat(8) + sentences[0];
  const short = storedQuestion(shortSource);
  short.synopsis = redactTitle(shortSource, [short.realTitle]);
  assert.equal(prepareQuestion(short), null);
});

test('verified translated and movie base aliases are removed as whole sentences', () => {
  const { summarizeWithoutTitles } = require('../server/src/questions/generator');
  const { questionTitleAliases } = require('../server/src/questions/title-policy');
  for (const [title, name] of [['STORY GAME〈ストーリー・ゲーム〉','ストーリー・ゲーム'],
    ['ストリートファイター/ザ・ ムービー','ストリートファイター']]) {
    const aliases = questionTitleAliases(title,[], 'film');
    assert.ok(aliases.includes(name));
    const summary = summarizeWithoutTitles(`「${name}」は家族の約束と旅の秘密を描いた作品である。`+story,aliases);
    assert.ok(!summary.synopsis.includes(name));
    assert.ok(!summary.synopsis.includes('■■■'));
    assert.ok(summary.excerpts.every(sentence=>sentences.includes(sentence)));
  }
});

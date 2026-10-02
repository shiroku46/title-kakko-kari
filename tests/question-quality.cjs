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

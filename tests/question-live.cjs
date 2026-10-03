const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createLiveQuestionSource } = require('../server/src/questions/live');
const { createQuestionService } = require('../server/src/questions/service');
const { generateWebQuestion, hash } = require('../server/src/questions/web-source');
const { discoverLiveCandidates, catalogueLinks } = require('../server/src/questions/catalogues');
const { questionIsValid } = require('../server/src/questions/validation');
const { evidenceTier } = require('../server/src/questions/selection-policy');
const { playableTitle } = require('../server/src/questions/title-policy');

const story = '港町に暮らす青年は、差出人のわからない手紙を受け取る。古い写真の中には、幼い頃に別れた友人と見知らぬ灯台が写っていた。青年は最後の船に乗り、地図から消えた島へと向かう。誰もいないと思われた島で、彼を待っていたのは名前を失った少女だった。二人は手紙に隠された約束をたどり、町に残された人々の記憶を取り戻そうとする。';
const work = n => ({ url: `https://indie${n}.example.org/films/letter`, kind: 'film', id: `web-${hash(`https://indie${n}.example.org/films/letter`)}` });
const html = n => `<title>自主制作映画「港への便り${n}の日」</title><h1>港への便り${n}の日</h1><h2>あらすじ</h2><p>${story}</p>`;
const response = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const discovery = candidates => async () => ({ candidates: [...candidates] });

test('production ignores missing/corrupt/populated banks and freshly fetches on every request', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'title-live-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bankPath = join(directory, 'bank.json'); writeFileSync(bankPath, 'not a question bank');
  const before = readFileSync(bankPath, 'utf8'); let calls = 0, discoveries = 0;
  const source = createQuestionService({ bankPath, collectImpl: () => { throw Error('bank collector must not run'); },
    fetchImpl: async () => { calls++; return response(html(1)); }, liveOptions: {
      discoverImpl: async () => { discoveries++; return { candidates: [work(1)] }; },
    } });
  t.after(() => source.stop());
  for (let i = 0; i < 3; i++) assert.equal(questionIsValid(await source.selectQuestion()), true);
  assert.equal(calls, 3); assert.equal(discoveries, 3); assert.equal(readFileSync(bankPath, 'utf8'), before);
  assert.equal(source.getStatus().mode, 'live'); assert.equal(source.getStatus().successfulRequests, 3);
});

test('a failed request creates no inventory cooldown and the next request searches again', async t => {
  let blocked = true, calls = 0;
  const source = createLiveQuestionSource({ maxRequests: 4, discoverImpl: discovery([work(1)]),
    fetchImpl: async () => { calls++; if (blocked) throw Error('source unavailable'); return response(html(1)); } });
  t.after(() => source.stop());
  await assert.rejects(source.selectQuestion(), /ネット検索先/); blocked = false;
  assert.equal(questionIsValid(await source.selectQuestion()), true); assert.equal(calls, 2);
  assert.equal(source.getStatus().failure, null);
});

test('room exclusions skip previously used works while an invalid source does not block a different domain', async t => {
  const visited = [];
  const source = createLiveQuestionSource({ discoverImpl: discovery([work(1), work(2), work(3)]),
    fetchImpl: async url => { visited.push(url); if (url === work(2).url) throw Error('bad source'); return response(html(3)); } });
  t.after(() => source.stop());
  const selected = await source.selectQuestion([work(1).id]);
  assert.equal(selected.id, work(3).id); assert.ok(!visited.includes(work(1).url));
});

test('concurrent room requests perform independent searches and retain each exclusion', async t => {
  let discoveries = 0;
  const source = createLiveQuestionSource({ discoverImpl: async () => { discoveries++; return { candidates: [work(1), work(2)] }; },
    fetchImpl: async url => response(html(url === work(1).url ? 1 : 2)) });
  t.after(() => source.stop());
  const [a,b] = await Promise.all([source.selectQuestion([work(1).id]), source.selectQuestion([work(2).id])]);
  assert.equal(a.id, work(2).id); assert.equal(b.id, work(1).id); assert.equal(discoveries, 2);
  assert.equal(source.getStatus().activeRequests, 0);
});

test('a slow source cannot delay a verified source; losing transport receives cancellation', async t => {
  let cancelled = false;
  const source = createLiveQuestionSource({ deadlineMilliseconds: 1000, discoverImpl: discovery([work(1),work(2)]),
    fetchImpl: async (url, { signal }) => {
      if (url === work(2).url) return response(html(2));
      signal.addEventListener('abort', () => { cancelled = true; }, { once: true });
      return new Promise(() => {});
    } });
  t.after(() => source.stop());
  assert.equal((await source.selectQuestion()).id, work(2).id); assert.equal(cancelled, true);
});

test('hard deadline and stop release active requests even for a transport that ignores abort', async t => {
  const source = createLiveQuestionSource({ deadlineMilliseconds: 25, discoverImpl: discovery([work(1)]), fetchImpl: () => new Promise(() => {}) });
  t.after(() => source.stop());
  await assert.rejects(source.selectQuestion(), /ネット検索先/); assert.equal(source.getStatus().activeRequests, 0);
  const pending = source.selectQuestion(); source.stop(); await assert.rejects(pending, /停止/);
});

test('429 respects Retry-After while another source remains available on subsequent searches', async t => {
  let failedCalls = 0;
  const source = createLiveQuestionSource({ discoverImpl: discovery([work(1),work(2)]), fetchImpl: async url => {
    if (url === work(1).url) { failedCalls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); }
    return response(html(2));
  } });
  t.after(() => source.stop());
  await source.selectQuestion(); await source.selectQuestion(); assert.equal(failedCalls, 1);
});

test('fresh discovery continues through a blocked engine to links from a live catalogue', async () => {
  const seen = [];
  const result = await discoverLiveCandidates({ kind: 'novel', fetchImpl: async url => {
    seen.push(url); return url.includes('yahoo') ? new Response('', { status: 429 }) : response('<a title="港の便り" href="/works/123">港の便り</a>');
  } });
  assert.equal(seen.length, 2); assert.equal(result.errors, 1);
  assert.deepEqual(result.candidates.map(c => c.url), ['https://kakuyomu.jp/works/123']);
});

test('catalogues yield current exact work links, not episodes, reviews, other hosts or a fixed title stock', () => {
  const result = catalogueLinks('<a href="/works/123">ある小説</a><a href="/works/123/episodes/1">本文</a><a href="/works/456/reviews">レビュー</a><a href="https://evil.example.org/works/789">別サイト</a>', 'https://kakuyomu.jp/search?q=x', 'novel');
  assert.equal(result.length, 1); assert.equal(result[0].url, 'https://kakuyomu.jp/works/123');
});

function postedHtml(changes = {}, { visible = story, canonical = 'https://kakuyomu.jp/works/123' } = {}) {
  const author = { __typename: 'UserAccount', activityName: '投稿する作者', isOfficialUser: false };
  const current = { __typename: 'Work', id: '123', title: '港の便り', introduction: story, author: { __ref: 'UserAccount:1' },
    fanFictionSource: null, isSexual: false, hasPublication: false, totalReadCount: 12, totalFollowers: 2, totalReviewPoint: 0,
    publicMediaFranchisedWorks: { totalCount: 0 }, ...changes };
  const data = { props: { pageProps: { __APOLLO_STATE__: { 'Work:123': current, 'UserAccount:1': author,
    'Work:999': { ...current, id: '999', title: '関連する有名作品', totalReadCount: 999999, hasPublication: true } } } } };
  return `<title>港の便り（投稿する作者） - カクヨム</title><meta property="og:type" content="article"><meta property="og:url" content="${canonical}"><h1>港の便り</h1><div>${visible}</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
}

test('self-published work uses its matched visible introduction and its own verified reach, never related work data', async () => {
  const candidate = { url: 'https://kakuyomu.jp/works/123', kind: 'novel' };
  const q = await generateWebQuestion(candidate, { fetchImpl: async () => response(postedHtml()) });
  assert.equal(questionIsValid(q), true); assert.equal(q.realTitle, '港の便り'); assert.equal(evidenceTier(q), 0);
  assert.ok(q.evidence.excerpts.every(s => story.includes(s)));
  for (const changes of [{ hasPublication: true }, { totalReadCount: 5000 }, { totalFollowers: 50 }, { totalReviewPoint: 100 }]) {
    const popular = await generateWebQuestion(candidate, { fetchImpl: async () => response(postedHtml(changes)) });
    assert.equal(evidenceTier(popular), 2);
  }
  for (const source of [postedHtml({}, { visible: '別の文章' }), postedHtml({}, { canonical: 'https://kakuyomu.jp/works/456' }), postedHtml({ fanFictionSource: {} })]) {
    await assert.rejects(generateWebQuestion(candidate, { fetchImpl: async () => response(source) }));
  }
});

test('numbered chapter prefixes are rejected without rejecting numbers within a genuine title', () => {
  for (const title of ['① 着て帰る','② 二枚目の控え','３：夜の港','III 港への手紙','かみさまノート 序章']) assert.equal(playableTitle(title,'novel'), null);
  assert.equal(playableTitle('1リットルの涙','novel'), '1リットルの涙');
});

test('short explicitly labelled plot cannot be padded with the project creators anecdote or credits', async () => {
  const source = `<title>自主制作映画「港への手紙」</title><div class="description"><p>${story}</p><p><strong>あらすじ。</strong></p><p>山に登ろうとする夫婦。夫は秘密を抱えていた。</p><p>出演者 港の太郎</p></div>`;
  await assert.rejects(generateWebQuestion({url:work(1).url,kind:'film'}, {fetchImpl:async()=>response(source)}));
});

test('game catalogue excludes add-ons and a store page requiring a base game cannot be a standalone work', async () => {
  assert.match(require('../server/src/questions/catalogues').catalogueUrl('game',0), /category1=998/u);
  await assert.rejects(generateWebQuestion({url:'https://store.steampowered.com/app/123/',kind:'game'}, {
    fetchImpl:async()=>response(`<title>独立ゲームの画集</title><div class="game_area_dlc_bubble">本編が必要です</div><h2>ストーリー</h2>${story}`),
  }), /追加コンテンツ/u);
});

test('a caller cancelling an obsolete round promptly frees the live search slot', async t => {
  const source = createLiveQuestionSource({ discoverImpl: discovery([work(1)]), fetchImpl:()=>new Promise(()=>{}) });
  t.after(()=>source.stop());
  const controller = new AbortController(), pending = source.selectQuestion([], {signal:controller.signal});
  controller.abort(); await assert.rejects(pending); assert.equal(source.getStatus().activeRequests,0);
});

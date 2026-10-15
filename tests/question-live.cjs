const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createLiveQuestionSource } = require('../server/src/questions/live');
const { createQuestionService } = require('../server/src/questions/service');
const { generateWebQuestion, hash } = require('../server/src/questions/web-source');
const { discoverLiveCandidates, catalogueLinks, catalogueUrl } = require('../server/src/questions/catalogues');
const { questionIsValid } = require('../server/src/questions/validation');
const { evidenceTier } = require('../server/src/questions/selection-policy');
const { playableTitle } = require('../server/src/questions/title-policy');

const story = '港町に暮らす青年は、差出人のわからない手紙を受け取る。古い写真の中には、幼い頃に別れた友人と見知らぬ灯台が写っていた。青年は最後の船に乗り、地図から消えた島へと向かう。誰もいないと思われた島で、彼を待っていたのは名前を失った少女だった。二人は手紙に隠された約束をたどり、町に残された人々の記憶を取り戻そうとする。';
const work = n => ({ url: `https://indie${n}.example.org/films/letter`, kind: 'film', id: `web-${hash(`https://indie${n}.example.org/films/letter`)}` });
const html = n => `<title>自主制作映画「港への便り${n}の日」</title><h1>港への便り${n}の日</h1><dl><dt>配給</dt><dd>検証配給会社</dd><dt>公開日</dt><dd>2026-01-01</dd></dl><h2>あらすじ</h2><p>${story}</p>`;
const response = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const discovery = candidates => async () => ({ candidates: [...candidates] });

test('second discovery pass changes to a work-introduction query instead of repeating business results', async () => {
  const queries = [];
  for (const pass of [0, 1]) await discoverLiveCandidates({ kind: 'game', pass, page: 0,
    fetchImpl: async url => { const u = new URL(url); if (u.searchParams.has('p') || u.searchParams.has('q')) queries.push(u.searchParams.get('p') || u.searchParams.get('q')); return response(''); } });
  assert.equal(queries.length, 2); assert.notEqual(queries[0], queries[1]);
  assert.match(queries[1], /ストーリー 公式サイト/u);
  const { searchQuery } = require('../server/src/questions/web-search');
  assert.match(searchQuery('manga', '作品紹介'), /短編集 内容紹介 出版社/u);
  assert.doesNotMatch(searchQuery('manga', '作品紹介'), /1巻/u);
});

test('persisted works exclude another URL for the same title after source restart', async t => {
  const source = createLiveQuestionSource({ discoverImpl: discovery([work(1)]),
    fetchImpl: async () => response(html(1)) });
  t.after(() => source.stop());
  const previous = { realTitle: '港への便り1の日', kind: 'film' };
  await assert.rejects(source.selectQuestion(['old-url-id'], { kind: 'film', excludedWorks: [previous] }));
  assert.equal(source.getStatus().successfulRequests, 0);
});

test('an explicit genre limits every discovery attempt and never falls back to a different medium', async t => {
  const searched = [];
  const source = createLiveQuestionSource({ discoverImpl: async ({ kind }) => {
    searched.push(kind); return { candidates: [work(1)] };
  }, fetchImpl: async () => response(html(1)) });
  t.after(() => source.stop());
  assert.equal((await source.selectQuestion([], { kind: 'film' })).kind, 'film');
  assert.ok(searched.length && searched.every(kind => kind === 'film'));
  searched.length = 0;
  await assert.rejects(source.selectQuestion([], { kind: 'novel' }));
  assert.ok(searched.length && searched.every(kind => kind === 'novel'));
  const before = searched.length;
  for (const kind of ['INVALID', ['film'], null, 'constructor']) await assert.rejects(source.selectQuestion([], { kind }), /ジャンル/);
  assert.equal(searched.length, before);
  assert.equal(source.getStatus().activeRequests, 0);
});

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
  assert.equal(calls, 3); assert.ok(discoveries >= 3); assert.equal(readFileSync(bankPath, 'utf8'), before);
  assert.equal(source.getStatus().mode, 'live'); assert.equal(source.getStatus().successfulRequests, 3);
});

test('twelve consecutive requests keep finding fresh works after other media are exhausted', async t => {
  const candidates = Array.from({ length: 16 }, (_, index) => work(index + 1));
  const source = createLiveQuestionSource({ discoverImpl: async ({ kind }) => ({ candidates: kind === 'film' ? candidates : [] }),
    fetchImpl: async url => response(html(Number(new URL(url).hostname.match(/indie(\d+)/u)[1]))) });
  t.after(() => source.stop());
  const used = [], titles = new Set();
  for (let index = 0; index < 12; index++) {
    const next = await source.selectQuestion(used);
    assert.equal(questionIsValid(next), true);
    assert.equal(used.includes(next.id), false);
    assert.equal(titles.has(next.realTitle), false);
    used.push(next.id);
    titles.add(next.realTitle);
  }
  assert.equal(source.getStatus().successfulRequests, 12);
  assert.equal(source.getStatus().activeRequests, 0);
  assert.equal(candidates.length, 16, 'a request must not consume a discovery adapter’s reusable results');
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
  assert.equal(a.id, work(2).id); assert.equal(b.id, work(1).id); assert.ok(discoveries >= 2);
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
    seen.push(url); return url.includes('yahoo') ? new Response('', { status: 429 }) : response('<a title="港の便り" href="/rb/123/">港の便り</a>');
  } });
  assert.equal(seen.length, 3); assert.equal(result.errors, 2);
  assert.deepEqual(result.candidates.map(c => c.url), ['https://books.rakuten.co.jp/rb/123/']);
});

test('book discovery keeps unrestricted search and obtains current ISBN links without engine or store results', async t => {
  const pages = [];
  const source = createLiveQuestionSource({ deadlineMilliseconds: 500, fetchImpl: async (url, {signal, method, body}) => {
    pages.push(url);
    const location = new URL(url);
    if (location.hostname === 'books.rakuten.co.jp') {
      return new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }
    if (location.hostname === 'search.yahoo.co.jp') {
      return response('<a ping="/xts/list" href="https://article.example.org/">作品リスト</a>');
    }
    if (location.pathname === '/bd/search/query.json') {
      assert.equal(method, 'POST');
      const query = JSON.parse(body);
      assert.equal(query.categoryname, 'search/top'); assert.deepEqual(query.conds.genre.checked, ['01']);
      assert.equal(query.conds.keyword.search, '物語'); assert.equal(query.rowmax, 20);
      assert.equal(query.conds.salesdate.from, `${query.part}-01-01`);
      return response(JSON.stringify({result: true, data: {list: [
        {isbn: '9784065373261'}, {isbn: '9784065373262',uniq:'ABCDEFGH',lastupdated:'202601010000'},
        {isbn:'9784065373262',uniq:'ABCDEFGH',lastupdated:'202601010000'},
        {isbn:'https://169.254.169.254/metadata'}, {url:'https://evil.example.org/'}
      ]}}));
    }
    if (location.pathname === '/bd/book/uniqs/HG/FE/DC/book.ABCDEFGH.202601010000.json') return response(JSON.stringify({result:true,data:{book:{
      uniq:'ABCDEFGH',isbn13:'9784065373262',codes:{isbn13:'9784065373262'},titles:{title:{text:'港の便り'}},
      genres:{ccode:'0093'},hakkou:{hatsubai:'海辺出版'},dates:{sales:'2026-01-01'},desc:[story]
    }}}));
    return response('<title>一般記事</title>');
  }});
  t.after(()=>source.stop());
  const selected = await source.selectQuestion([], {kind:'novel'});
  assert.equal(selected.kind,'novel'); assert.equal(selected.realTitle,'港の便り');
  const queries=pages.filter(url=>new URL(url).hostname==='search.yahoo.co.jp').map(url=>new URL(url).searchParams.get('p'));
  assert(queries.some(query=>!query.startsWith('site:')));
  assert.equal(pages.filter(url=>new URL(url).pathname==='/bd/book/uniqs/HG/FE/DC/book.ABCDEFGH.202601010000.json').length,1);
  assert(!pages.some(url=>url.includes('169.254') || url.includes('/evil.')));
});

test('publisher catalogue queries preserve every book genre and reject malformed ISBN lists', async () => {
  for (const kind of ['novel', 'short-story', 'literary-work', 'manga']) {
    let query;
    const result = await discoverLiveCandidates({ kind, page: 4, fetchImpl: async (url, options) => {
      if (!url.includes('hanmoto')) return new Response('', {status:503});
      query = JSON.parse(options.body);
      return response(JSON.stringify({result:true,data:{list:[{isbn:'9784065373262',uniq:'ABCDEFGH',lastupdated:'202601010000'}]}}));
    }});
    assert.deepEqual(result.candidates.map(c=>c.kind),[kind]);
    assert.deepEqual(query.conds.genre.checked,[kind==='manga'?'43':'01']);
    assert.equal(query.conds.keyword.search,['manga','short-story'].includes(kind)?'短編':'物語');
    assert.equal(query.part,new Date().getUTCFullYear()-2); assert.equal(query.offset,20);
  }
  for (const body of ['not JSON','{}','{"result":true,"data":{"list":null}}']) {
    const result=await discoverLiveCandidates({kind:'novel',fetchImpl:async()=>response(body)});
    assert.equal(result.candidates.length,0); assert.equal(result.errors,1);
  }
});

test('live failure diagnosis exposes only bounded counts and fixed network codes, with an independent snapshot', async t => {
  const source=createLiveQuestionSource({maxRequests:4,discoverImpl:discovery([work(1)]),fetchImpl:async()=>{
    const error=Error('private title https://secret.example.org/?token=private');
    error.code='private-token'; throw error;
  }});
  t.after(()=>source.stop());
  await assert.rejects(source.selectQuestion());
  const status=source.getStatus();
  assert.equal(status.failure.details.fetchErrors,1); assert.equal(status.failure.details.workErrors,1);
  assert.equal(status.failure.details.requests,1); assert.equal(status.failure.details.networkCode,'FETCH_ERROR');
  assert(!JSON.stringify(status).includes('private')); assert(!JSON.stringify(status).includes(work(1).url));
  status.failure.details.fetchErrors=999; assert.equal(source.getStatus().failure.details.fetchErrors,1);
});

test('catalogues yield current exact work links, not episodes, reviews, other hosts or a fixed title stock', () => {
  const result = catalogueLinks('<a href="/rb/123/">ある小説</a><a href="/rb/123/episodes/1">本文</a><a href="https://evil.example.org/rb/789/">別サイト</a>', 'https://books.rakuten.co.jp/search?sitem=x', 'novel');
  assert.equal(result.length, 1); assert.equal(result[0].url, 'https://books.rakuten.co.jp/rb/123/');
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

test('posted work uses its matched visible introduction and its own verified reach, never related work data', async () => {
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

test('a used work cannot return through a different URL during reselection', async t => {
  let round = 0;
  const source = createLiveQuestionSource({ discoverImpl:async()=>({candidates:++round===1?[work(1)]:[work(2),work(3)]}),
    fetchImpl:async url=>response(html(url===work(3).url?3:1)) });
  t.after(()=>source.stop());
  const first=await source.selectQuestion(), next=await source.selectQuestion([first.id]);
  assert.equal(next.id,work(3).id); assert.notEqual(first.realTitle,next.realTitle);
});

test('a self-produced comics event fundraiser is not a manga work even with a quoted project name', async () => {
  const source = `<title>「続く即売会」自主制作漫画誌展示即売会 開催継続支援プロジェクト</title><h1>続く即売会</h1><div class="description">${story}</div>`;
  await assert.rejects(generateWebQuestion({url:work(1).url,kind:'manga'},{fetchImpl:async()=>response(source)}), /イベント/u);
});

const publicationMarkup = kind => `<script type="application/ld+json">${JSON.stringify({ '@type':kind==='game'?'VideoGame':kind==='film'?'Movie':'Book',name:'PLACEHOLDER',genre:kind==='manga'?'漫画':kind==='novel'?'小説':kind==='film'?'映画':'ゲーム',publisher:{name:'検証出版社'},datePublished:'2026-01-01',isbn:'9784065373262',developer:{name:'検証開発会社'},offers:{price:1000},description:story})}</script>`;
const mediaPage = (kind, title) => `<title>${{novel:'小規模出版小説',film:'自主制作映画',game:'インディーゲーム',manga:'漫画'}[kind]}「${title}」</title><h1>${title}</h1>${publicationMarkup(kind).replace('PLACEHOLDER',title)}<h2>あらすじ</h2><p>${story}</p>`;

test('actual delivered media stay balanced across rounds, including reselection, and rooms retain independent histories', async t => {
  let next = 0;
  const pages = new Map();
  const source = createLiveQuestionSource({ discoverImpl: async ({kind}) => {
    const n = ++next, url = `https://creator.example.org/works/${n}`;
    pages.set(url, mediaPage(kind, `海に届く便り${n}の日`));
    return { candidates: [{id:`web-${hash(url)}`,url,kind}] };
  }, fetchImpl: async url => response(pages.get(url)) });
  t.after(()=>source.stop());
  const rooms = [[],[]], counts = [new Map(), new Map()];
  for (let round=0; round<9; round++) for (let room=0; room<2; room++) {
    const q = await source.selectQuestion(rooms[room]);
    assert.equal(questionIsValid(q), true); rooms[room].push(q.id);
    counts[room].set(q.kind,(counts[room].get(q.kind)||0)+1);
    const values = ['novel','film','game','manga'].map(kind=>counts[room].get(kind)||0);
    assert.ok(Math.max(...values)-Math.min(...values)<=1, JSON.stringify(values));
  }
  assert.equal(source.getStatus().successfulRequests,18);
});

test('an underrepresented medium gets a fresh second-engine attempt before used media can win', async t => {
  let second = false; const seen=[];
  const source = createLiveQuestionSource({ discoverImpl: async ({kind,pass}) => {
    seen.push({kind,pass});
    if (!second && kind==='novel' || second && kind==='film' && pass===1) {
      const url=`https://creator.example.org/${kind}`;
      return {candidates:[{url,kind}]};
    }
    return {candidates:[]};
  }, fetchImpl: async url=>response(mediaPage(url.endsWith('film')?'film':'novel','消えない便り')) });
  t.after(()=>source.stop());
  const first=await source.selectQuestion(); second=true; seen.length=0;
  assert.equal((await source.selectQuestion([first.id])).kind,'film');
  assert.ok(seen.some(s=>s.kind==='film' && s.pass===1));
  assert.ok(seen.every(s=>s.kind!=='novel'));
});

test('wrong-medium results cannot satisfy a film search, and an unavailable medium permits bounded fallback', async t => {
  const source = createLiveQuestionSource({ maxRequests:16, discoverImpl:async({kind})=>({candidates:[{
    kind,url:kind==='film'?'https://creator.example.org/wrong-game':`https://creator.example.org/${kind}`,
  }]}), initialKind:1, fetchImpl:async url=>response(mediaPage(url.endsWith('wrong-game')?'game':url.split('/').pop(),'明日の灯台')) });
  t.after(()=>source.stop());
  const q=await source.selectQuestion();
  assert.equal(q.kind,'game'); assert.notEqual(q.sources[0].url,'https://creator.example.org/wrong-game');
});

test('film catalogue uses the current category path and comics query targets original creator works', () => {
  const {catalogueUrl}=require('../server/src/questions/catalogues');
  assert.equal(new URL(catalogueUrl('film',3)).pathname,'/movie/');
  assert.equal(new URL(catalogueUrl('film',3)).searchParams.get('page'),'4');
  assert.equal(new URL(catalogueUrl('manga',0)).hostname,'books.rakuten.co.jp');
  const cs=catalogueLinks('<a href="/movie/T1234567"><h3>映画「小さな灯」</h3></a>','https://www.cinematoday.jp/movie/','film');
  assert.equal(cs[0].title,'映画「小さな灯」');
});

const {hasOfficialDistribution,distributionEvidence,isbnIsValid,releaseDate}=require('../server/src/questions/distribution-policy');
const commercialBook=(extra={},markup='')=>`<title>港の便り | 小説</title><h1>港の便り</h1><main><script type="application/ld+json">${JSON.stringify({'@type':'Book',name:'港の便り',genre:'小説',publisher:{name:'海辺出版'},author:{name:'書く人'},isbn:'9784065373262',datePublished:'2026-01-01',description:story,...extra})}</script><h2>あらすじ</h2><p>${story}</p>${markup}</main>`;

test('explicit short-story and literary-work choices use book discovery and verify their exact kind', async t => {
  for (const [kind, label] of [['short-story', '短編小説'], ['literary-work', '文学作品']]) {
    assert.equal(new URL(catalogueUrl(kind, 0)).hostname, 'books.rakuten.co.jp');
    const source = createLiveQuestionSource({ discoverImpl: async ({ kind: searched }) => {
      assert.equal(searched, kind); return { candidates: [{ ...work(1), kind }] };
    }, fetchImpl: async () => response(commercialBook({ genre: label })) });
    t.after(() => source.stop());
    assert.equal((await source.selectQuestion([], { kind })).kind, kind);
  }
});
test('novel searches admit source short-story/literary-work kinds and reject cross-classification repeats', async t => {
  for (const [kind, label] of [['short-story', '短編小説'], ['literary-work', '文学作品']]) {
    const source = createLiveQuestionSource({ discoverImpl: async ({ kind: requested }) => {
      assert.equal(requested, 'novel'); return { candidates: [{ ...work(1), kind }] };
    }, fetchImpl: async () => response(commercialBook({ genre: label })) });
    t.after(() => source.stop());
    const q = await source.selectQuestion([], { kind: 'novel' });
    assert.equal(q.kind, kind);
    assert.equal(questionIsValid(q), true);
    await assert.rejects(source.selectQuestion([q.id], { kind: 'novel' }));
  }
  let second = false;
  const source = createLiveQuestionSource({ discoverImpl: async () => ({ candidates: [{ ...work(second ? 2 : 1), kind: second ? 'literary-work' : 'short-story' }] }),
    fetchImpl: async () => response(commercialBook({ genre: second ? '文学作品' : '短編小説' })) });
  t.after(() => source.stop());
  const first = await source.selectQuestion([], { kind: 'novel' });
  second = true;
  await assert.rejects(source.selectQuestion([first.id], { kind: 'novel' }));
});

test('random selection requires own commercial publication, not a web posting, self publication or another work metadata',async()=>{
  const url='https://publisher.example.org/book/letter',policy=require('../server/src/questions/selection-policy').createSelectionPolicy();
  const generate=html=>generateWebQuestion({url,kind:'novel'},{fetchImpl:async()=>response(html)});
  const official=await generate(commercialBook());assert(hasOfficialDistribution(official));assert(policy.isEligible(official));
  for(const extra of [{publisher:undefined},{isbn:'9784065373261'},{datePublished:'2099-01-01'},{publisher:{name:'書く人'}},{genre:['小説','自費出版']},{genre:['小説','同人誌']}]){
    const q=await generate(commercialBook(extra));assert.equal(hasOfficialDistribution(q),false);assert.equal(policy.isEligible(q),false);
  }
  const hidden=await generate(commercialBook({publisher:undefined,isbn:undefined,datePublished:undefined},'<aside><dl><dt>出版社</dt><dd>海辺出版</dd><dt>ISBN</dt><dd>9784065373262</dd><dt>発売日</dt><dd>2026-01-01</dd></dl></aside>'));assert.equal(hasOfficialDistribution(hidden),false);
  for(const changes of [{},{hasPublication:true}]){
    const q=await generateWebQuestion({url:'https://kakuyomu.jp/works/123',kind:'novel'},{fetchImpl:async()=>response(postedHtml(changes))});assert.equal(policy.isEligible(q),false);
  }
  assert.equal(policy.isEligible({...official,realTitle:'別の作品'}),false);assert.equal(policy.isEligible({...official,sources:[{url:'https://other.example.org/book/1'}]}),false);
  assert.equal(policy.isEligible({...official,evidence:{...official.evidence,distribution:{...official.evidence.distribution,sha256:'0'.repeat(64)}}}),false);
  assert.equal(isbnIsValid('978-4-06-537326-2'),true);assert.equal(isbnIsValid('9784065373261'),false);assert.equal(releaseDate('2026-02-32'),null);
});
test('official movie distribution and paid published games pass, but crowdfunded-only, free, personal and unreleased games fail',async()=>{
  const generate=(type,kind,extra)=>generateWebQuestion({url:`https://store.example.org/${kind}/1`,kind},{fetchImpl:async()=>response(commercialBook({'@type':type,genre:kind==='game'?'ゲーム':'映画',publisher:{name:'流通会社'},developer:{name:'開発会社'},offers:{price:1000},...extra}))});
  assert(hasOfficialDistribution(await generate('Movie','film',{})));assert(hasOfficialDistribution(await generate('VideoGame','game',{})));
  for(const extra of [{offers:{price:0}},{offers:undefined},{publisher:{name:'開発会社'}},{publisher:{name:'Solo Studio'},developer:{name:'Solo Studio'}},{genre:['ゲーム','個人開発']},{genre:['ゲーム','フリーゲーム']},{datePublished:'2099-01-01'}])assert.equal(hasOfficialDistribution(await generate('VideoGame','game',extra)),false);
  assert.equal(hasOfficialDistribution(await generate('Movie','film',{publisher:undefined})),false);
  const studio=await generate('VideoGame','game',{publisher:{name:'Sea Studio Ltd.'},developer:{name:'Sea Studio Ltd.'}});assert(hasOfficialDistribution(studio));
});
test('old banks cannot serve unverified or personal works; valid official unknown works remain below small official works',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'title-official-policy-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const url='https://publisher.example.org/book/1',q=await generateWebQuestion({url,kind:'novel'},{fetchImpl:async()=>response(commercialBook())});
  const unverified={...q,id:'unpublished',evidence:{...q.evidence,distribution:undefined}};const bankPath=join(directory,'bank.json');
  writeFileSync(bankPath,JSON.stringify({schemaVersion:1,questions:[unverified]}));const source=createQuestionService({bankPath,enabled:false});t.after(()=>source.stop());await assert.rejects(source.selectQuestion(),/公式流通/);
  writeFileSync(bankPath,JSON.stringify({schemaVersion:1,questions:[unverified,q]}));assert.equal((await source.selectQuestion()).id,q.id);
});

test('a ready work catalogue is usable before a slow search route consumes the deadline', async t => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  t.after(() => clearTimeout(timer));
  let cancelled = false;
  const result = await discoverLiveCandidates({ kind: 'novel', signal: controller.signal, fetchImpl: async (url, { signal }) => {
    if (!url.includes('yahoo')) return response('<a href="/rb/123/">港の便り</a>');
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      cancelled = true; reject(Error('slow search cancelled'));
    }, { once: true }));
  } });
  assert.equal(controller.signal.aborted, false);
  assert.ok(result.remaining);
  controller.abort();
  await result.remaining;
  assert.equal(cancelled, true);
  assert.deepEqual(result.candidates.map(candidate => candidate.url), ['https://books.rakuten.co.jp/rb/123/']);
});

test('after two used works, slow invalid candidates in one medium cannot starve the third new work', async t => {
  let third = false;
  const source = createLiveQuestionSource({ deadlineMilliseconds: 180, discoverImpl: async ({ kind }) => ({
    candidates: third && kind === 'game'
      ? Array.from({ length: 9 }, (_, i) => ({ kind, url: `https://creator.example.org/game/invalid${i}` }))
      : [{ kind, url: `https://creator.example.org/${kind}/valid` }],
  }), fetchImpl: async url => {
    if (url.includes('/invalid')) { await new Promise(resolve => setTimeout(resolve, 75)); return response('<title>作品の説明なし</title>'); }
    const kind = new URL(url).pathname.split('/')[1];
    return response(mediaPage(kind, `${kind}への便り`));
  } });
  t.after(() => source.stop());
  const first = await source.selectQuestion();
  const second = await source.selectQuestion([first.id]);
  assert.equal(first.kind, 'novel');
  assert.equal(second.kind, 'film');
  third = true;
  const next = await source.selectQuestion([first.id, second.id]);
  assert.equal(next.kind, 'manga');
  assert.equal(new Set([first.id, second.id, next.id]).size, 3);
  assert.equal(source.getStatus().activeRequests, 0);
});

test('candidate rotation retains a later valid work when every other discovery has no usable links', async t => {
  const source = createLiveQuestionSource({ discoverImpl: async ({ kind, pass }) => ({
    candidates: kind === 'film' && pass === 0 ? [work(1), work(2), work(3), work(4)] : [],
  }), fetchImpl: async url => response(url === work(4).url ? html(4) : '<title>作品情報なし</title>') });
  t.after(() => source.stop());
  assert.equal((await source.selectQuestion()).id, work(4).id);
});

test('a slower discovery route retains its valid work when the ready catalogue only contains invalid pages', async t => {
  const source = createLiveQuestionSource({ deadlineMilliseconds: 1000, fetchImpl: async url => {
    const location = new URL(url);
    if (location.hostname === 'search.yahoo.co.jp' && location.searchParams.get('p').includes('小説')) {
      await new Promise(resolve => setTimeout(resolve, 30));
      return response('<a ping="/xts/click" href="https://publisher.example.org/books/letter">港の便り</a>');
    }
    if (location.pathname === '/books/letter') return response(commercialBook());
    if (location.hostname === 'books.rakuten.co.jp' && location.pathname === '/search') {
      return response('<a href="/rb/1/">説明なしの書籍</a><a href="/rb/2/">説明なしの書籍</a><a href="/rb/3/">説明なしの書籍</a>');
    }
    return response('<title>作品情報なし</title>');
  } });
  t.after(() => source.stop());
  const result = await source.selectQuestion();
  assert.equal(result.sources[0].url, 'https://publisher.example.org/books/letter');
  assert.equal(result.kind, 'novel');
});

test('successful selection cancels its still-pending discovery transport', async t => {
  let cancelled = false;
  const source = createLiveQuestionSource({ deadlineMilliseconds: 1000, fetchImpl: async (url, { signal }) => {
    if (url.includes('yahoo')) return new Promise((_, reject) => signal.addEventListener('abort', () => {
      cancelled = true; reject(Error('losing discovery cancelled'));
    }, { once: true }));
    return response(new URL(url).pathname === '/search' ? '<a href="/rb/123/">港の便り</a>' : commercialBook());
  } });
  t.after(() => source.stop());
  assert.equal((await source.selectQuestion()).kind, 'novel');
  assert.equal(cancelled, true);
  assert.equal(source.getStatus().activeRequests, 0);
});

test('a completed late route is checked before a large ready queue exhausts the budget', async t => {
  const source = createLiveQuestionSource({ maxRequests: 8, discoverImpl: async ({ kind, pass }) => ({
    candidates: kind === 'novel' && pass === 0
      ? Array.from({ length: 60 }, (_, i) => ({ kind, url: `https://publisher.example.org/invalid${i}` })) : [],
    ...(kind === 'novel' && pass === 0 && { remaining: new Promise(resolve => setTimeout(() => resolve({
      candidates: [{ kind, url: 'https://publisher.example.org/book/letter' }],
    }), 5)) }),
  }), fetchImpl: async url => {
    if (url.endsWith('/book/letter')) return response(commercialBook());
    await new Promise(resolve => setTimeout(resolve, 15));
    return response('<title>作品情報なし</title>');
  } });
  t.after(() => source.stop());
  assert.equal((await source.selectQuestion()).kind, 'novel');
});

test('fast invalid pages leave budget for a slower verified discovery route', async t => {
  let requests = 0;
  const source = createLiveQuestionSource({ maxRequests: 8, deadlineMilliseconds: 500,
    discoverImpl: async ({ kind }) => ({ candidates: Array.from({ length: 50 }, (_, i) => ({ kind, url: `https://publisher.example.org/invalid${i}` })),
      remaining: new Promise(resolve => setTimeout(() => resolve({ candidates: [{ kind, url: 'https://publisher.example.org/book/letter' }] }), 20)) }),
    fetchImpl: async url => { requests++; return response(url.endsWith('/book/letter') ? commercialBook() : '<title>作品情報なし</title>'); } });
  t.after(() => source.stop());
  assert.equal((await source.selectQuestion([], { kind: 'novel' })).kind, 'novel');
  assert.ok(requests <= 8);
});

test('an exhausted CPU theme falls back only to another verified work with unused decoys', async t => {
  const { generateComputerTitles } = require('../server/src/computerTitles');
  const usedTitles = generateComputerTitles(story, 100);
  const farming = '農場を継いだ青年は、古い畑で作物を育て始める。日照りで収穫が減るなか、隣の農園に暮らす人々と協力し、水路を修理することにした。離れて暮らす家族にも手紙を送り、この土地での新たな暮らしを伝える。次の春に種をまくため、彼らは小さな倉庫を直し、村の市場で収穫物を売ろうとする。';
  const source = createLiveQuestionSource({ discoverImpl: discovery([work(1), work(2)]),
    fetchImpl: async url => response(url === work(1).url ? html(1) : html(2).replace(story, farming)) });
  t.after(() => source.stop());
  const next = await source.selectQuestion([], { kind: 'film', acceptQuestion: q =>
    generateComputerTitles(q.synopsis, 5, { realTitle: q.realTitle, usedTitles }).length === 5 });
  assert.equal(next.id, work(2).id);
  const decoys = generateComputerTitles(next.synopsis, 5, { usedTitles, realTitle: next.realTitle });
  assert.equal(decoys.length, 5); assert.ok(decoys.every(title => !usedTitles.includes(title)));
  await assert.rejects(source.selectQuestion([], { kind: 'film', acceptQuestion: () => false }), /未使用のCPU/u);
  assert.equal(source.getStatus().failure.code, 'cpu_titles_exhausted');
});

test('unavailable media cannot exhaust the request budget before a verified used-medium fallback is tried', async t => {
  let repeated = false;
  const seen = [];
  const source = createLiveQuestionSource({ maxRequests: 32, discoverImpl: async ({ kind, pass, fetchImpl }) => {
    seen.push({ kind, pass });
    await fetchImpl(`https://search.example.org/${kind}/${pass}`);
    return { candidates: kind === 'film'
      ? [{ kind, url: `https://creator.example.org/film/${repeated ? 'second' : 'first'}` }]
      : repeated ? Array.from({ length: 60 }, (_, i) => ({ kind, url: `https://creator.example.org/${kind}/invalid${i}` })) : [] };
  }, fetchImpl: async url => response(url.includes('/film/') && !url.includes('search.example.org')
    ? mediaPage('film', url.endsWith('first') ? '最初の便り' : '次の便り') : '<title>作品情報なし</title>') });
  t.after(() => source.stop());
  const first = await source.selectQuestion();
  repeated = true; seen.length = 0;
  const next = await source.selectQuestion([first.id]);
  assert.equal(next.kind, 'film');
  assert.notEqual(next.id, first.id);
  for (const kind of ['novel', 'game', 'manga']) assert.ok(seen.some(search => search.kind === kind && search.pass === 1));
});

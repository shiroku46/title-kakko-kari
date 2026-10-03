const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublicFetch, publicUrl, publicAddress } = require('../server/src/questions/web-fetch');
const { extractWebWork, generateWebQuestion, linkedCandidates, hash } = require('../server/src/questions/web-source');
const { discoverWebCandidates, parseResults, searchQuery } = require('../server/src/questions/web-search');
const { collectQuestions, identityKeys } = require('../server/src/questions/collector');
const { questionIsValid } = require('../server/src/questions/validation');
const { publicRound } = require('../server/src/gameState');
const base = 'https://publisher.example.org/book/1';
const story = '港町に暮らす青年は、届いた一通の手紙をきっかけに故郷を離れる。友人とともに失われた約束を探すうちに、二人は町で起きた事件の秘密を知る。住民たちの話を聞きながら旅を続け、青年は自分の家族と町の過去に向き合うことになる。海の向こうから戻った幼なじみと協力し、二人は新しい生活を始めるために最後の決断を下す。';
function book({ title = '港の約束', description = story, extra = {}, markup = '' } = {}) {
  return `<html><title>${title} | 出版社</title><h1><img alt="logo"></h1><h1>${title}</h1>` +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Book', name: title, genre: '小説', author: { name: '架空の著者' }, description, ...extra })}</script>${markup}</html>`;
}
function page(html, url = base) {
  const r = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}
function results(links) {
  return links.map((url, i) => `<a class="result__a" href="${url}">作品紹介${i}</a>`).join('');
}

test('web URL and every resolved address must be public HTTPS', async () => {
  for (const url of ['http://publisher.example.org', 'https://localhost/', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://x.internal', 'https://x.local', 'https://user:pass@publisher.example.org', 'https://publisher.example.org:8443']) assert.throws(() => publicUrl(url));
  for (const address of ['127.0.0.1','10.1.1.1','172.31.0.1','169.254.169.254','100.64.0.1','192.168.0.1','198.18.0.1','192.0.2.1','::1','::ffff:8.8.8.8','fe80::1','fc00::1','2001:db8::1','2001:10::1','2002:7f00::1','3fff::1']) assert.equal(publicAddress(address),false,address);
  for (const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(publicAddress(address),true,address);
  let calls = 0;
  const fetch = createPublicFetch({ lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], requestImpl: async () => { calls++; } });
  await assert.rejects(fetch(base)); assert.equal(calls,0);
});

test('redirect targets are revalidated, pinned and bounded', async () => {
  const requested = [];
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  const denied = createPublicFetch({ lookup, requestImpl: async (url, address) => {
    requested.push({ url: url.href, address });
    return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/metadata' } });
  } });
  await assert.rejects(denied(base)); assert.equal(requested.length,1);
  assert.equal(requested[0].address.address,'8.8.8.8');
  let count = 0;
  const loop = createPublicFetch({ lookup, requestImpl: async () => { count++; return new Response(null,{status:302,headers:{location:'/again'}}); } });
  await assert.rejects(loop(base)); assert.equal(count,4);
  const ok = createPublicFetch({ lookup, requestImpl: async (url) => url.pathname === '/book/1' ? new Response(null,{status:302,headers:{location:'/book/2'}}) : page(book()) });
  assert.equal((await ok(base)).url,'https://publisher.example.org/book/2');
});

test('restricted, oversized, non-HTML and short material is not a question', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  const denied = createPublicFetch({ lookup, requestImpl: async () => new Response('text',{headers:{'x-robots-tag':'nosnippet'}}) });
  await assert.rejects(denied(base));
  const huge = createPublicFetch({ lookup, requestImpl: async () => new Response('x'.repeat(2*1024*1024+1)) });
  await assert.rejects(huge(base));
  for (const markup of ['<meta name="robots" content="noarchive">', '<meta name="robots" content="max-snippet:0">']) assert.throws(() => extractWebWork(book({markup}),base,'novel'));
  assert.throws(() => extractWebWork(book({description:'短い紹介。'}),base,'novel'));
  await assert.rejects(generateWebQuestion({url:base,kind:'novel'},{fetchImpl:async()=>new Response('{}',{headers:{'content-type':'application/json'}})}));
});

test('a typed work from any publisher produces validated masked evidence and keeps alternate titles hidden', async () => {
  const title = '港の約束'; const alias = '約束の港';
  const q = await generateWebQuestion({url:base,kind:'novel'}, {fetchImpl:async()=>page(book({title,description:`${title}では、${story}${alias}という作品の物語が続く。`,extra:{alternateName:alias}})), now:()=>new Date('2026-10-03T00:00:00Z')});
  assert.equal(q.realTitle,title); assert.equal(questionIsValid(q),true);
  assert.ok(!q.synopsis.includes(title)); assert.ok(!q.synopsis.includes(alias));
  assert.equal(q.evidence.sourceId,`web-${hash(base)}`);
  assert.equal(q.sources[0].provider,'web'); assert.equal(q.sources[0].license,undefined);
  const view=publicRound({sourceQuestion:q, real_title:q.realTitle});
  assert.equal(view.real_title,null); assert.equal(view.sourceQuestion,undefined);
  assert.ok(!JSON.stringify(view).includes(base));
  assert.equal(questionIsValid({...q,evidence:{...q.evidence,sourceId:'web-wrong'}}),false);
});

test('plain explicit sections and nested semantic containers work without Wikipedia or site adapters', () => {
  for (const markup of [
    `<h2>内容紹介</h2><p>${story}</p><h2>著者</h2><p>無関係な著者紹介。</p>`,
    `<h2>あらすじ・概要</h2><p>${story}</p><h2>関連情報</h2>`,
    `<div><div class="work__description"><p>${story}</p><div>紹介の末尾。</div></div></div>`,
    `<section id="productDescription"><p>${story}</p></section>`,
  ]) {
    const q=extractWebWork(`<title>港の約束 | 小説作品</title><h1>港の約束</h1>${markup}`,base,'novel');
    assert.equal(q.realTitle,'港の約束'); assert.ok(q.synopsis.length>=120); assert.ok(!q.synopsis.includes('無関係'));
  }
});

test('retail title metadata can include author/imprint while the visible heading defines the answer', () => {
  const markup=book({ extra:{name:'港の約束／架空の著者／出版社単行本'} });
  assert.equal(extractWebWork(markup,base,'novel').realTitle,'港の約束');
});

test('non-story work uses its source description and keeps its genre', () => {
  const markup=book({extra:{'@type':'MusicAlbum',genre:'音楽アルバム'},description:story});
  const q=extractWebWork(markup,base,'album');
  assert.equal(q.kind,'album'); assert.equal(q.contentType,'description');
});

test('listings, mismatched titles, SEO descriptions and query hints alone do not establish a work', () => {
  assert.throws(()=>extractWebWork(book({title:'おすすめ100選',markup:'<h2>内容紹介</h2>'+story}),base,'novel'));
  assert.throws(()=>extractWebWork(book().replaceAll('<h1>港の約束</h1>','<h1>別作品</h1>').replace('<title>港の約束 | 出版社</title>','<title>別作品</title>'),base,'novel'));
  assert.throws(()=>extractWebWork(`<title>港の約束</title><h1>港の約束</h1><meta name="description" content="${story}">`,base,'novel'));
  const two=book()+`<script type="application/ld+json">${JSON.stringify({'@type':'Book',name:'他の作品',description:story})}</script>`;
  assert.throws(()=>extractWebWork(two,base,'novel'));
  assert.throws(()=>extractWebWork(`<title>企業のサービス</title><h1>企業のサービス</h1><h2>商品説明</h2>${story}`,base,'novel'));
});

test('search providers unwrap links, retain query IDs and interleave independent domains', () => {
  const urls=['https://one.example.org/a','https://one.example.org/b','https://two.example.org/book?id=1','https://three.example.org/c'];
  const parsed=parseResults(results(urls),'duckduckgo','novel');
  assert.deepEqual(parsed.map(p=>new URL(p.url).hostname),['one.example.org','two.example.org','three.example.org','one.example.org']);
  const wrapper=`https://duckduckgo.com/l/?uddg=${encodeURIComponent(urls[2])}&amp;rut=foo`;
  assert.equal(parseResults(results([wrapper,'http://insecure.example.org','https://127.0.0.1']),'duckduckgo','novel')[0].url,urls[2]);
  const bing=parseResults(`<rss><item><title>作品</title><link>${urls[0]}</link></item></rss>`,'bing','film');
  assert.equal(bing[0].url,urls[0]);
  assert.ok(searchQuery('film','新作',new Date('2027-01-01')).includes('2027'));
  assert.ok(!searchQuery('novel','話題').includes('site:'));
});

test('search checkpoints pending results, rotates queries and falls back on a rate-limited engine', async () => {
  const calls=[];
  const found=results(['https://one.example.org/a','https://two.example.org/b']);
  const fetchImpl=async(url)=>{calls.push(url);return page(found)};
  const first=await discoverWebCandidates({limit:1,maxRequests:1,fetchImpl});
  assert.equal(first.candidates.length,1); assert.equal(first.state.pending.length,1);
  const second=await discoverWebCandidates({state:first.state,limit:1,maxRequests:1,fetchImpl});
  assert.equal(calls.length,1); assert.notEqual(second.candidates[0].url,first.candidates[0].url);
  const fallback=await discoverWebCandidates({limit:1,maxRequests:2,fetchImpl:async(url)=>url.includes('duckduckgo')?new Response('',{status:429,headers:{'retry-after':'60'}}):page('<rss><item><title>小説の作品</title><link>https://other.example.org/work</link></item></rss>')});
  assert.equal(fallback.candidates.length,1); assert.equal(fallback.errors.length,1); assert.ok(fallback.state.cooldowns.duckduckgo>Date.now());
  assert.equal(fallback.candidates[0].url,'https://other.example.org/work');
});

test('listing pages lead to verified work pages; bounded discovery survives into the next batch', async () => {
  const listing='https://shop.example.org/new-books';
  const listingHtml=`<title>新刊一覧</title><h1>新刊一覧</h1><main><a href="${base}"><img alt="港の約束">港の約束</a><a href="https://127.0.0.1/"><img alt="unsafe"></a></main>`;
  assert.equal(linkedCandidates(listingHtml,listing,'novel').length,1);
  const fetchImpl=async(url)=>url===listing?page(listingHtml,listing):page(book(),url);
  const initial={collector:{pendingCandidates:[{id:'listing',provider:'web',title:'新刊一覧',kind:'novel',url:listing}]}};
  const first=await collectQuestions({providers:['web'],state:initial,limit:1,maxRequests:1,fetchImpl,throttleMilliseconds:0,validateQuestion:questionIsValid});
  assert.equal(first.added.length,0); assert.equal(first.state.collector.pendingCandidates[0].url,base);
  const next=await collectQuestions({providers:['web'],state:first.state,limit:1,maxRequests:1,fetchImpl,throttleMilliseconds:0,validateQuestion:questionIsValid});
  assert.equal(next.added.length,1); assert.equal(next.added[0].realTitle,'港の約束');
});

test('query-based pages remain separate and author/work fingerprints deduplicate cross-domain copies', async () => {
  const a={id:'a',provider:'web',url:'https://shop.example.org/detail?id=1',title:'同名作品',kind:'novel'};
  const b={...a,id:'b',url:'https://shop.example.org/detail?id=2'};
  assert.ok(!identityKeys(a).some(k=>identityKeys(b).includes(k)));
  const first=await generateWebQuestion({...a,url:base},{fetchImpl:async()=>page(book())});
  const second=await generateWebQuestion({...a,url:'https://other.example.org/book/1'},{fetchImpl:async()=>page(book(),'https://other.example.org/book/1')});
  assert.equal(first.workIdentity,second.workIdentity);
  const distinct=extractWebWork(book({extra:{author:{name:'別の著者'}}}),base,'novel');
  assert.notEqual(distinct.workIdentity,first.workIdentity);
});

test('person pages and editorial headlines cannot become work titles, including saved Web records', async () => {
  for (const [title,url,markup] of [
    ['米澤崇史','https://media.example.org/author/38/page/1',`<div class="description">${story}</div>`],
    ['水属性の魔法使いのネタバレ|涼とセーラと結末考察',base,`<h2>あらすじ</h2>${story}`],
    ['今月の第1巻 漫画特集',base,`<h2>作品紹介</h2>${story}`],
  ]) assert.throws(() => extractWebWork(`<title>${title} | ゲーム 漫画</title><h1>${title}</h1>${markup}`,url,'game'));
  const good=await generateWebQuestion({url:base,kind:'novel'},{fetchImpl:async()=>page(book())});
  assert.equal(questionIsValid(good),true);
  const {prepareQuestion}=require('../server/src/questions/validation');
  const old={...good,evidence:{...good.evidence}}; delete old.evidence.work;
  assert.equal(questionIsValid(old),false); assert.equal(prepareQuestion(old),null);
  assert.equal(questionIsValid({...good,evidence:{...good.evidence,work:{...good.evidence.work,title:'人物'}}}),false);
});

test('official quoted movie titles override logo headings and search genre hints; story precedes promotion', () => {
  const html=`<title>映画『STORY GAME〈ストーリー・ゲーム〉』公式サイト</title>`+
    `<h1>予告編</h1><h2>INTRODUCTION</h2>${story.replaceAll('青年','製作者')}`+
    `<h2><img alt="STORY" src="story.png"></h2><p>${story}</p><h2>キャスト</h2>`;
  const q=extractWebWork(html,'https://film.example.org/','game');
  assert.equal(q.realTitle,'STORY GAME〈ストーリー・ゲーム〉');
  assert.equal(q.kind,'film'); assert.equal(q.evidence.section,'STORY');
  assert.ok(!q.synopsis.includes('製作者')); assert.ok(!q.realTitle.includes('公式サイト'));
});

test('independent typed movie, game and comic pages generate valid questions with confirmed media', async () => {
  for(const [kind,type,genre,url] of [
    ['film','Movie','映画','https://film.example.org/work'],
    ['game','VideoGame','アドベンチャーゲーム','https://store.example.org/app/1'],
    ['manga','Book','コミック','https://comics.example.org/title/1'],
  ]) {
    const q=await generateWebQuestion({url,kind},{fetchImpl:async()=>page(book({extra:{'@type':type,genre}}),url)});
    assert.equal(q.kind,kind);assert.equal(questionIsValid(q),true);
  }
});

test('listing traversal omits author, category, bookmark and affiliate service links', () => {
  const markup=['/author/38','/category/game','/tag/game','/bookmark/1','/rss','/comic/1'].map((path)=>
    `<a href="${path}"><img alt="作品名">作品名</a>`).join('');
  assert.deepEqual(linkedCandidates(markup,'https://media.example.org/','game').map(c=>new URL(c.url).pathname),['/comic/1']);
});

test('genre queues cannot let a publisher backlog occupy new film, game and manga searches', async () => {
  const pending=Array.from({length:6},(_,i)=>({id:`old-${i}`,provider:'web',kind:'novel',title:`旧小説${i}`,url:`https://publisher.example.org/book/${i}`}));
  const searched=[];
  const fetchImpl=async(url)=>{
    if(url.includes('duckduckgo')||url.includes('bing')) {
      const query=new URL(url).searchParams.get('q'); searched.push(query);
      const kind=query.includes('映画')?'film':query.includes('ゲーム')?'game':'manga';
      return page(results([`https://${kind}.example.org/work`]));
    }
    const kind=url.includes('film.')?'film':url.includes('game.')?'game':url.includes('manga.')?'manga':'novel';
    const type=kind==='film'?'Movie':kind==='game'?'VideoGame':'Book';
    const genre={film:'映画',game:'ゲーム',manga:'漫画',novel:'小説'}[kind];
    return page(book({title:`港の約束${kind}`,extra:{'@type':type,genre}}),url);
  };
  const result=await collectQuestions({providers:['web'],limit:4,maxRequests:7,throttleMilliseconds:0,fetchImpl,
    validateQuestion:questionIsValid,state:{collector:{pendingCandidates:pending}}});
  assert.deepEqual(result.added.map(q=>q.kind),['novel','film','game','manga']);
  assert.equal(searched.length,3); assert.ok(searched.every(q=>!q.includes('site:')));
  assert.equal(result.state.collector.pendingCandidates.filter(c=>c.kind==='novel').length,5);
  for(const kind of ['film','game','manga']) assert.ok(result.state.providers.web.byKind[kind]);
});

test('retail edition promotion is not the answer or synopsis but remains a hidden title alias', async () => {
  const title='【デジタル版限定特典付き】港の約束 1巻';
  const q=await generateWebQuestion({url:base,kind:'manga'},{fetchImpl:async()=>page(book({title,
    description:story+'※こちらの商品には限定特典イラストが収録されています。',extra:{genre:'コミック'}}))});
  assert.equal(q.realTitle,'港の約束'); assert.ok(q.aliases.includes(title));
  assert.ok(!/特典/u.test(q.synopsis)); assert.equal(questionIsValid(q),true);
});

test('search rate limits are shared by genres, and repeated temporary Web page failures are bounded', async () => {
  const calls=[];
  const state={providers:{web:{cooldowns:{duckduckgo:Date.now()+60000,bing:Date.now()+60000}}}};
  const result=await collectQuestions({state,providers:['web'],limit:1,maxRequests:5,throttleMilliseconds:0,
    fetchImpl:async(url)=>{calls.push(url); return page('');}});
  assert.equal(calls.length,0); assert.equal(result.added.length,0);
  const candidate={id:'temporary',title:'港の約束',url:base,provider:'web',kind:'novel',collectionRetries:2};
  const failed=await collectQuestions({state:{collector:{pendingCandidates:[candidate]}},providers:['web'],maxRequests:1,
    limit:1,throttleMilliseconds:0,fetchImpl:async()=>new Response('',{status:503})});
  assert.equal(failed.state.collector.pendingCandidates.length,0);
  assert.ok(!failed.state.collector.processedKeys.some(k=>k.includes('temporary')));
});

test('edition suffixes do not expose the base game title and installation notes are excluded', async () => {
  const title='港の約束(オリジナル版)';
  const q=await generateWebQuestion({url:base,kind:'game'},{fetchImpl:async()=>page(book({title,extra:{'@type':'VideoGame',genre:'ゲーム'},
    description:`${title}では、${story}※こちらのタイトルには追加パックは含まれておりません。`}))});
  assert.equal(q.realTitle,'港の約束'); assert.ok(q.aliases.includes(title)); assert.ok(!q.synopsis.includes('港の約束'));
  assert.ok(!q.synopsis.includes('追加パック')); assert.equal(questionIsValid(q),true);
  assert.throws(()=>extractWebWork(book({title:'【電子版】月刊コミックアライブ 2026年11月号',extra:{genre:'漫画'}}),base,'manga'));
});

test('the previous shared Web checkpoint retains unprocessed URLs when genre searches begin', async () => {
  const c={id:'previous-web',provider:'web',title:'港の約束',url:base,kind:'novel'};
  const result=await collectQuestions({providers:['web'],limit:1,maxRequests:1,throttleMilliseconds:0,validateQuestion:questionIsValid,
    state:{providers:{web:{pending:[c],cursor:3}}},fetchImpl:async(url)=>page(book(),url)});
  assert.equal(result.added.length,1); assert.deepEqual(result.state.providers.web.pending,[]);
});

test('a campaign headline is a discovery page rather than the answer, and old invalid Web identities can be rechecked', async () => {
  assert.throws(()=>extractWebWork(book({title:'【コミックス】『港の約束』今だけ2巻無料!!',extra:{genre:'漫画'}}),base,'manga'));
  const c={id:`web-${hash(base)}`,provider:'web',title:'港の約束',url:base,kind:'novel'};
  const result=await collectQuestions({providers:['web'],limit:1,maxRequests:1,throttleMilliseconds:0,validateQuestion:questionIsValid,
    state:{collector:{pendingCandidates:[c],processedKeys:[`web:${base}`,`url:${base}`,`id:${c.id}`]}},fetchImpl:async(url)=>page(book(),url)});
  assert.equal(result.added.length,1);assert.equal(result.state.collector.webValidationVersion,3);
});

test('all work cards inside a main or multiple articles are inspected, rather than only the first article', () => {
  for(const wrapper of ['main','div']){
    const html=`<${wrapper}><article><a href="/book/1"><img alt="第一作品"></a></article><article><a href="/book/2"><img alt="第二作品"></a></article></${wrapper}>`;
    assert.equal(linkedCandidates(html,'https://shop.example.org/','manga').length,2);
  }
});

test('trial-edition labels inside a retail name are removed without invalidating page evidence', async () => {
  const title='港の約束【期間限定無料】 1';
  const q=await generateWebQuestion({url:base,kind:'manga'},{fetchImpl:async()=>page(book({title,extra:{genre:'漫画'}}))});
  assert.equal(q.realTitle,'港の約束');assert.ok(q.aliases.includes(title));assert.equal(questionIsValid(q),true);
});

test('series headings cannot turn typed sequel data into a base-work question', () => {
  const markup = book({title:'港の約束 II',extra:{'@type':'Movie',genre:'映画'}}).replace('<h1>港の約束 II</h1>','<h1>港の約束</h1>');
  assert.throws(()=>extractWebWork(markup,base,'film'),/出題対象外/);
});

test('long-tail searches lead the new plan for films, games, comics and commercial small presses',async()=>{
  const {QUERY_VERSION}=require('../server/src/questions/web-search');
  for(const [kind,keyword] of [['film','単館公開'],['game','インディー'],['manga','単行本'],['novel','小出版社']]){
    let query;const result=await discoverWebCandidates({kinds:[kind],limit:1,maxRequests:1,fetchImpl:async(url)=>{
      query=new URL(url).searchParams.get('q');return page(results(['https://independent.example.org/work']));}});
    assert.ok(query.includes(keyword));assert.ok(!/site:|話題|ランキング|新刊/u.test(query));assert.equal(result.state.queryVersion,QUERY_VERSION);
  }
  assert.ok(searchQuery('novel','小規模').includes('小出版社'));
  assert.ok(searchQuery('game','小規模').includes('パブリッシャー'));
});

test('old broad search state begins a new query while preserving pending URLs, visits and cooldowns',async()=>{
  const old={id:'old',provider:'web',kind:'film',title:'古い候補',url:'https://old.example.org/work'};
  let calls=0;
  const result=await discoverWebCandidates({kinds:['film'],limit:1,maxRequests:1,state:{cursor:31,page:2,pending:[old],
    visited:[old.url],cooldowns:{bing:Date.now()+100000},completedCycle:true,revisitAt:'2099-01-01T00:00:00Z'},
    fetchImpl:async(url)=>{calls++;assert.ok(new URL(url).searchParams.get('q').includes('単館公開'));assert.equal(new URL(url).searchParams.get('s'),null);return page(results(['https://new.example.org/work']));}});
  assert.equal(calls,1);assert.equal(result.candidates[0].url,'https://new.example.org/work');
  assert.equal(result.state.pending[0].url,old.url);assert.ok(result.state.visited.includes(old.url));assert.ok(result.state.cooldowns.bing>Date.now());
  const next=await discoverWebCandidates({kinds:['film'],state:result.state,limit:1,maxRequests:1,fetchImpl:async()=>{throw Error('must use backlog');}});
  assert.equal(next.candidates[0].url,old.url);
});

test('source visibility evidence comes from the identified work rather than search labels or unrelated page widgets',async()=>{
  const {createSelectionPolicy}=require('../server/src/questions/selection-policy');const policy=createSelectionPolicy();
  const generate=async extra=>generateWebQuestion({url:base,kind:'game',discovery:{angle:'インディー'}},
    {fetchImpl:async()=>page(book({extra:{'@type':'VideoGame',genre:'アドベンチャーゲーム',...extra}}))});
  const ordinary=await generate({});assert.equal(questionIsValid(ordinary),true);assert.equal(policy.tier(ordinary),1);
  const indie=await generate({genre:['ゲーム','インディー']});assert.equal(policy.tier(indie),0);assert.equal(questionIsValid(indie),true);
  const hit=await generate({genre:['ゲーム','インディー'],aggregateRating:{'@type':'AggregateRating',ratingCount:3000}});
  assert.equal(policy.tier(hit),2);assert.equal(questionIsValid(hit),true);
  const markup=book({extra:{'@type':'VideoGame',genre:'ゲーム'}})+'<aside>インディーゲーム特集 本作は自主制作ゲームである。</aside>';
  const widget=await generateWebQuestion({url:base,kind:'game'},{fetchImpl:async()=>page(markup)});
  assert.equal(policy.tier(widget),1);
  const round=publicRound({id:'r',real_title:indie.realTitle,sourceQuestion:indie});
  assert.ok(!JSON.stringify(round).includes('visibility'));
});

test('collector starts long-tail queries ahead of an old genre backlog and retains its work URLs',async()=>{
  const old={id:'old',provider:'web',kind:'novel',title:'旧小説',url:'https://old.example.org/book/1'};
  let searched=0;const fresh='https://small.example.org/book/1';
  const result=await collectQuestions({providers:['web'],webKinds:['novel'],limit:1,maxRequests:3,throttleMilliseconds:0,
    state:{collector:{pendingCandidates:[old]},providers:{web:{byKind:{novel:{cursor:10,pending:[],visited:[]}}}}},
    fetchImpl:async(url)=>{if(url.includes('duckduckgo')){searched++;return page(results([fresh]));}
      assert.equal(url,fresh);return page(book({extra:{genre:['小説','自主出版']}}),url);},validateQuestion:questionIsValid});
  assert.equal(searched,1);assert.equal(result.added.length,1);assert.equal(result.added[0].sources[0].url,fresh);
  assert.ok(result.state.collector.pendingCandidates.some(q=>q.url===old.url));
});

test('long-tail production tutorials and untyped recommendation articles never become work answers',()=>{
  for(const title of ['自主制作映画の作り方:感性と物語を紡ぐ実践ガイド','隠れた名作小説10選',
    'お金がなくてもここまでやれる!低予算で成功した迫力の映画たち']){
    assert.throws(()=>extractWebWork(`<title>${title}</title><h1>${title}</h1><h2>あらすじ</h2>${story}`,base,'film'),/記事|一覧/);
  }
  // An actual reference book may have a how-to title, if its typed work data
  // and page title agree; an editorial headline alone is insufficient.
  const q=extractWebWork(book({title:'自主制作映画の作り方',extra:{genre:'書籍'}}),base,'nonfiction');
  assert.equal(q.realTitle,'自主制作映画の作り方');
  const links=linkedCandidates('<main><a href="/movie/123"><img alt="映画の題名">映画の題名</a></main>',
    'https://film.example.org/list','film');assert.equal(links[0].url,'https://film.example.org/movie/123');
});

test('writing apps discovered by minor-novel searches and store-owner headings cannot become novels',async()=>{
  for(const [title,name,description] of [
    ['ノベルストーン - NovelStone - ASR SHOP - STORE','ASR SHOP','NovelStoneはWindows用テキストエディタです。'+story],
    ['Web作家向けテキストエディタ「Lyll-writer」 - l-kettle - STORE','l-kettle',story],
    ['小説執筆エディタ NIGHTOVER','STORE',story],
  ]){
    assert.throws(()=>extractWebWork(`<title>${title}</title><h1>${name}</h1><h2>商品説明</h2>${description}`,
      'https://creator.example.org/items/1','novel'),/作品|ツール|記事/);
  }
  assert.throws(()=>extractWebWork(`<title>港の約束 - 著者の店 - STORE</title><h1>著者の店</h1><h2>あらすじ</h2>${story}`,
    'https://creator.example.org/items/1','novel'), /作品/);
  const {workPageTitleIsEligible}=require('../server/src/questions/web-source');
  assert.equal(workPageTitleIsEligible('ノベルストーン','page-title','小説執筆に役立つテキストエディタです。'),false);
});

test('storefront names, discount prefixes and release metadata never enter the work answer or introduction',async()=>{
  const {createSelectionPolicy}=require('../server/src/questions/selection-policy'),policy=createSelectionPolicy();
  const title='灯台の配達人';
  const html=`<title>Steamで20% OFF:${title}</title><h1>${title}</h1><main><b>ジャンル:</b><span>ゲーム、インディー</span><br>`+
    `<a itemprop="aggregateRating"><meta itemprop="reviewCount" content="199"></a>`+
    `<div class="release_date">リリース日:2026年1月1日</div><h2>早期アクセスのゲーム</h2>`+
    `<p>今すぐアクセスしてゲームの開発プロセスに参加しよう。</p><h2>このゲームについて</h2><p>${story}</p></main>`;
  const q=await generateWebQuestion({url:base,kind:'game'},{fetchImpl:async()=>page(html)});
  assert.equal(q.realTitle,title);assert.ok(questionIsValid(q));assert.equal(policy.tier(q),0);
  assert.ok(!/Steam|OFF|リリース日|開発プロセス/u.test(q.synopsis));
  const popular=await generateWebQuestion({url:base,kind:'game'},{fetchImpl:async()=>page(html.replace('content="199"','content="200"'))});
  assert.equal(policy.tier(popular),2);
});

test('review articles can lead to a real work storefront without passing on their indie claim',async()=>{
  const url='https://independent.example.org/reviews/work';
  const markup='<title>個人制作ゲームのレビュー</title><main><a href="https://store.steampowered.com/app/12345/">Steamで見る</a></main>';
  await assert.rejects(generateWebQuestion({url,kind:'game'},{fetchImpl:async()=>page(markup,url)}),e=>{
    assert.equal(e.additionalCandidates.length,1);assert.equal(e.additionalCandidates[0].url,'https://store.steampowered.com/app/12345/');
    assert.ok(!e.additionalCandidates[0].evidence);return true;});
});

test('search locale is Japanese and a version-2 cycle begins personal-work discovery without bypassing cooldowns',async()=>{
  const {searchUrl,QUERY_VERSION}=require('../server/src/questions/web-search');
  assert.equal(new URL(searchUrl('duckduckgo','個人制作',0)).searchParams.get('kl'),'jp-jp');
  assert.equal(new URL(searchUrl('bing','個人制作',0)).searchParams.get('mkt'),'ja-JP');
  let query;
  const result=await discoverWebCandidates({kinds:['game'],maxRequests:1,limit:1,state:{queryVersion:2,completedCycle:true,revisitAt:'2099-01-01T00:00:00Z'},
    fetchImpl:async url=>{query=new URL(url).searchParams.get('q');return page(results(['https://individual.example.org/game/1']));}});
  assert.match(query,/個人制作/);assert.equal(result.state.queryVersion,QUERY_VERSION);
  const cooled=await discoverWebCandidates({kinds:['game'],state:{queryVersion:2,cooldowns:{duckduckgo:Date.now()+100000,bing:Date.now()+100000}},
    fetchImpl:async()=>{throw Error('must not bypass cooldown');}});
  assert.equal(cooled.requests,0);
});

test('a self-produced quoted work title identifies the film rather than its fundraising headline',async()=>{
  const title='海辺の手紙',html=`<title>自主制作短編映画『${title}』を完成させたい | 制作者サイト</title>`+
    `<h1>自主制作短編映画『${title}』 を完成させたい</h1><h2>あらすじ</h2><p>${story.replace('二人は町','二人は&mdash;町')}</p>`;
  const q=await generateWebQuestion({url:base,kind:'film'},{fetchImpl:async()=>page(html)});
  assert.equal(q.realTitle,title);assert.ok(questionIsValid(q));assert.ok(!/&mdash;|完成させたい/u.test(q.synopsis));
  assert.equal(require('../server/src/questions/selection-policy').createSelectionPolicy().tier(q),0);
});

test('discovery can traverse a list and a review to a work with a two-link depth limit',async()=>{
  const article='https://indie.example.org/archives/2026/01/123/',store='https://store.steampowered.com/app/123456/';
  const review='<title>短編ゲームのレビュー</title><main><a href="'+store+'">Steamで見る</a></main>';
  for(const depth of [0,1])await assert.rejects(generateWebQuestion({url:article,kind:'game',webDepth:depth},{fetchImpl:async()=>page(review,article)}),e=>{
    assert.equal(e.additionalCandidates[0].url,store);return true;});
  await assert.rejects(generateWebQuestion({url:article,kind:'game',webDepth:2},{fetchImpl:async()=>page(review,article)}),e=>!e.additionalCandidates);
});

test('crowdfunding budget guides cannot become films or small-production evidence',()=>{
  const title='自主制作映画の予算をクラウドファンディングで成功させる戦略と成功例';
  assert.throws(()=>extractWebWork(`<title>${title}</title><meta property="og:type" content="article"><h1>${title}</h1><h2>作品紹介</h2>${story}`,base,'film'),/解説記事|一般記事/);
  const ordinary='創作映画の資金集めについて';
  assert.throws(()=>extractWebWork(`<title>${ordinary}</title><meta property="og:type" content="article"><h1>${ordinary}</h1><h2>作品紹介</h2>${story}`,base,'film'),/一般記事/);
});

test('sidebars and related widgets cannot supply the selected work production or review metadata',async()=>{
  const {createSelectionPolicy}=require('../server/src/questions/selection-policy'),policy=createSelectionPolicy();
  const unrelated='<b>ジャンル:</b><span>個人制作ゲーム</span><br><meta itemprop="reviewCount" content="9999">';
  const html=book({extra:{'@type':'VideoGame',genre:'ゲーム'},markup:`<aside>${unrelated}</aside><div class="related-products">${unrelated}</div>`});
  const q=await generateWebQuestion({url:base,kind:'game'},{fetchImpl:async()=>page(html)});
  assert.equal(policy.tier(q),1);assert.ok(!q.evidence.visibility);
});


test('localized name in the opening work definition is removed throughout the intro', () => {
  const intro = '『残響のモーラ』は、水に呑まれた村と兄を捜す少女をめぐるナラティブアドベンチャーです。';
  const repeated = '残響のモーラでは少女が村の過去を調べ始める。';
  const markup = '<title>Steam:Echoes of Mora</title><h1>Echoes of Mora</h1><div class="game_area_description"><h2>このゲームについて</h2><p>'+intro+story+repeated+'</p></div>';
  const q = extractWebWork(markup,'https://store.steampowered.com/app/3129050/','game');
  assert.ok(q.aliases.includes('残響のモーラ'));
  assert.ok(!q.synopsis.includes('残響のモーラ'));
  assert.ok(q.evidence.excerpts.every(s => !s.includes('残響のモーラ')));
  assert.equal(q.realTitle,'Echoes of Mora');
  assert.throws(() => extractWebWork(markup.replaceAll('残響のモーラ','残響のモーラ2'),'https://store.steampowered.com/app/3129050/','game'));
});

test('character dialogue and later unrelated work references do not supply localized aliases', () => {
  for (const intro of [
    '「旅人」は少年を見つけ、物語の始まりを告げる。',
    '少年が気に入っているのは、昔読んだ『遠い港』という小説です。',
    '『遠い港』は、主人公が読んでいた小説に登場するゲームです。',
  ]) {
    const markup = '<title>Steam:Quiet Harbor</title><h1>Quiet Harbor</h1><h2>このゲームについて</h2>'+intro+story;
    const q=extractWebWork(markup,'https://store.steampowered.com/app/321/','game');
    assert.deepEqual(q.aliases,['Quiet Harbor']);
  }
});


test('an explicit localized self-work definition after plot prose still hides every occurrence', () => {
  const preceding='主人公(「大人」)は、老人の葬儀に誰も参列しなかったことに戸惑いを覚える。その時、町全体を揺るがす大地震が発生し、町全体が迷宮へと変貌し、時間の流れまでもが狂ってしまう。';
  const definition='『迷路の中の迷路』は、迷路と化した町を舞台にした2Dピクセルアートのパズルアドベンチャーゲームです。';
  const markup='<title>Steam:A Maze In Labyrinth</title><h1>A Maze In Labyrinth</h1><h2>このゲームについて</h2>'+preceding+definition+story+'迷路の中の迷路では、家族を見つけるために町を探索する。';
  const q=extractWebWork(markup,'https://store.steampowered.com/app/333/','game');
  assert.ok(q.aliases.includes('迷路の中の迷路'));
  assert.ok(!q.synopsis.includes('迷路の中の迷路'));
  assert.ok(q.evidence.excerpts.every(s=>!s.includes('迷路の中の迷路')));
  assert.equal(q.realTitle,'A Maze In Labyrinth');
});

const creatorComicUrl='https://booth.pm/ja/items/123';
function creatorComic({id='123',category='56',name='港の灯り',description=`オリジナル漫画です。${story}`,productDescription=description,related='',brand='小さな作者',aggregateRating}={}) {
  const data={'@type':'Product',name,description:productDescription,url:creatorComicUrl,brand:{name:brand,url:'https://creator.booth.pm/'},aggregateRating};
  return `<title>${name} - ${brand} - BOOTH</title><meta property="og:url" content="${creatorComicUrl}"><div data-tracking="detail_item" data-product-id="${id}" data-product-category="${category}" data-product-name="${name}" data-product-brand="creator"></div><h2>${name}</h2><div>${brand}</div><div class="js-market-item-detail-description description"><p>${description}</p></div><script type="application/ld+json">${JSON.stringify(data)}</script><div class="related">${related}</div>`;
}

test('creator comic identity is bound to its product ID, visible title, own category, original prose and creator', async () => {
  const q=await generateWebQuestion({url:creatorComicUrl,kind:'manga'},{fetchImpl:async()=>page(creatorComic(),creatorComicUrl)});
  assert.equal(q.realTitle,'港の灯り');assert.equal(q.kind,'manga');assert.equal(questionIsValid(q),true);
  assert.equal(require('../server/src/questions/selection-policy').evidenceTier(q),0);
  const wide=await generateWebQuestion({url:creatorComicUrl,kind:'manga'},{fetchImpl:async()=>page(creatorComic({aggregateRating:{ratingCount:200}}),creatorComicUrl)});
  assert.equal(require('../server/src/questions/selection-policy').evidenceTier(wide),2);
  assert.ok(q.evidence.excerpts.every(s=>story.includes(s)));
  for(const options of [{id:'999'},{category:'177'},{description:story,related:'オリジナル漫画です。'},{description:`二次創作のオリジナル漫画です。${story}`},{productDescription:'別の商品の作品紹介。'}]) {
    await assert.rejects(generateWebQuestion({url:creatorComicUrl,kind:'manga'},{fetchImpl:async()=>page(creatorComic(options),creatorComicUrl)}),/当該商品/u);
  }
  const unrelatedUrl='https://bookstore.example.org/item/123';
  assert.equal(questionIsValid({...q,sources:[{...q.sources[0],url:unrelatedUrl}]}),false);
});

test('quoted film projects expose their own named plot without treating support reports or unrelated productions as plot/reach', async () => {
  const url='https://motion-gallery.net/projects/small-film';
  const source=`<title>短編映画『港の灯り』制作支援プロジェクト</title><meta property="og:type" content="article"><meta property="og:url" content="${url}"><h1>短編映画『港の灯り』制作支援プロジェクト</h1><div id="project-description"><p>映画『港の灯り』は本作の自主制作による映画です。</p><h2>◾︎『港の灯り』STORY</h2><p>${story}</p><h2>制作について</h2><p>制作資金へのご支援をお願いいたします。</p></div><aside>別作品は世界的大ヒットです。</aside>`;
  const q=await generateWebQuestion({url,kind:'film'},{fetchImpl:async()=>page(source,url)});
  assert.equal(questionIsValid(q),true);assert.equal(q.realTitle,'港の灯り');assert.equal(q.synopsis,story);
  assert.equal(require('../server/src/questions/selection-policy').evidenceTier(q),0);
  const short=source.replace(story,'手紙を受け取った青年は港へ向かう。');
  await assert.rejects(generateWebQuestion({url,kind:'film'},{fetchImpl:async()=>page(short,url)}),/十分な作品紹介/u);
  const article=source.replaceAll('https://motion-gallery.net/projects/small-film',base);
  await assert.rejects(generateWebQuestion({url:base,kind:'film'},{fetchImpl:async()=>page(article,base)}),/一般記事/u);
});

test('a headed short film plot cannot be duplicated as a flat label and padded from later production headings', async () => {
  const url='https://motion-gallery.net/projects/small-film';
  const source=`<title>自主制作映画「港の灯り」制作支援</title><meta property="og:type" content="article"><meta property="og:url" content="${url}"><h1>自主制作映画「港の灯り」制作支援</h1><div id="project-description"><p>映画「港の灯り」は自主制作映画です。</p><h2>あらすじ</h2><p>青年は手紙を受け取って港へ向かう。</p><h2>キャストに関して</h2><p>撮影に協力した人々。</p><h2>関係者とのこれまで</h2><p>${story}</p></div>`;
  await assert.rejects(generateWebQuestion({url,kind:'film'},{fetchImpl:async()=>page(source,url)}),/十分な作品紹介/u);
  const mixed=source.replaceAll('自主制作映画「港の灯り」制作支援','「別の旧作」「他の旧作」監督の自主制作映画「港の灯り」制作支援');
  await assert.rejects(generateWebQuestion({url,kind:'film'},{fetchImpl:async()=>page(mixed,url)}),/単一映画/u);
});

test('bracketed creator-store synopsis labels separate the plot from preceding product specifications', async () => {
  const description=`オリジナル漫画です。\n【収録内容】\n全66ページの仕様です。\n【あらすじ】\n${story}\n【仕様】\n販売形式の説明です。`;
  const q=await generateWebQuestion({url:creatorComicUrl,kind:'manga'},{fetchImpl:async()=>page(creatorComic({description}),creatorComicUrl)});
  assert.equal(q.synopsis,story);assert.equal(questionIsValid(q),true);
});


test('retail product title cannot hide volume numbers behind a series heading', () => {
  const retail = title => `<title>${title}</title><meta property="og:type" content="books.book"><h1>港の灯り</h1><h2>内容紹介</h2>${story}`;
  assert.throws(() => extractWebWork(retail('港の灯り 136 (ジャンプコミックス)'),base,'manga'));
  assert.throws(() => extractWebWork(retail('港の灯り 第136巻'),base,'manga'));
  assert.equal(extractWebWork(retail('港の灯り リマスター版'),base,'novel').realTitle,'港の灯り');
  assert.equal(extractWebWork(retail('港の灯り (講談社文庫)'),base,'novel').realTitle,'港の灯り');
});

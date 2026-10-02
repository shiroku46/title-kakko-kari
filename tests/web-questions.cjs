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

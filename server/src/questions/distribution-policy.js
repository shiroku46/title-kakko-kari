const { container } = require('./creator-work');
const { createHash } = require('node:crypto');
const BOOK_KINDS = new Set(['novel', 'short-story', 'literary-work', 'manga', 'poem', 'nonfiction']);
const PERSONAL = /自主出版|自費出版|私家版|同人(?:誌|作品|漫画)|個人(?:制作|製作|開発|配布|販売)|フリーゲーム|無料(?:配布|ゲーム)|未(?:出版|刊行|書籍化)|self[- ]published/iu;
const POSTED_HOST = /(?:^|\.)(?:kakuyomu\.jp|syosetu\.com|novelup\.plus|booth\.pm|itch\.io|note\.com)$/u;
const COMPANY = /株式会社|有限会社|合同会社|Inc\.?\b|Ltd\.?\b|LLC\b|Corporation/iu;
const digest = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');

function isbnIsValid(value) {
  if (typeof value !== 'string') return false;
  const isbn = value.replace(/[\s-]/gu, '').toUpperCase();
  if (/^(?:978|979)\d{10}$/u.test(isbn)) return [...isbn].reduce((n,c,i) => n + Number(c)*(i%2 ? 3 : 1),0)%10===0;
  return /^\d{9}[\dX]$/u.test(isbn) && [...isbn].reduce((n,c,i) => n+(c==='X'?10:Number(c))*(10-i),0)%11===0;
}
function releaseDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.normalize('NFKC').match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})(?:日|(?:T.*)?$)/u);
  if (!match) return null;
  const iso = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  const parsed=new Date(iso);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===iso ? iso : null;
}
function validRecord(record, now = new Date()) {
  if (!record || record.version !== 1 || !['retail-book','distributed-film','paid-retail-game','official-retail'].includes(record.channel) ||
      !['sourceUrl','workTitle','kind','publisher','releaseDate','author','developer','context','identifier'].every(k=>typeof record[k]==='string') ||
      Object.values(record).some(v=>typeof v==='string' && v.length>1500)) return false;
  let url;
  try { url=new URL(record.sourceUrl); } catch { return false; }
  if (url.protocol!=='https:' || POSTED_HOST.test(url.hostname) || !record.publisher.trim() ||
      record.publisher===record.author || PERSONAL.test([record.publisher,record.context].join(' '))) return false;
  const date = releaseDate(record.releaseDate);
  if (!date || date>now.toISOString().slice(0,10)) return false;
  if (BOOK_KINDS.has(record.kind)) return record.channel==='retail-book' && isbnIsValid(record.identifier);
  if (record.kind==='film') return record.channel==='distributed-film';
  if (record.kind==='game') return record.channel==='paid-retail-game' && Number.isFinite(record.price) && record.price>0 &&
    Boolean(record.developer) && (record.publisher!==record.developer || COMPANY.test(record.publisher));
  return record.channel==='official-retail' && Number.isFinite(record.price) && record.price>0;
}
function distributionEvidence({ title, kind, sourceUrl, publisher='', date='', identifier='', author='', developer='', context='', price=null }, now=new Date()) {
  const record = { version:1, sourceUrl, workTitle:title, kind, publisher, releaseDate:releaseDate(date)||'',
    identifier, author, developer, context:context.slice(0,1500), price:Number.isFinite(price)?price:null,
    channel:BOOK_KINDS.has(kind)?'retail-book':kind==='film'?'distributed-film':kind==='game'?'paid-retail-game':'official-retail' };
  return validRecord(record,now) ? {...record,sha256:digest(record)} : undefined;
}
function hasOfficialDistribution(question) {
  const evidence=question?.evidence?.distribution;
  if (!evidence || evidence.sourceUrl!==question.sources?.[0]?.url || require('./title-policy').playableTitle(evidence.workTitle,question.kind)!==question.realTitle || evidence.kind!==question.kind) return false;
  const {sha256,...record}=evidence;
  return sha256===digest(record) && validRecord(record);
}

// Only metadata inside the independently identified work page is passed here.
// Related cards/navigation have already been removed by the source extractor.
function distributionFromPage({title,kind,url,structured,meta,markup,pageTitle,author},helpers) {
  const {text,attributes}=helpers;
  const named=value=>Array.isArray(value)?value.map(named).filter(Boolean).join('、'):typeof value==='string'?text(value):typeof value?.name==='string'?text(value.name):'';
  function field(label) {
    for (const row of markup.matchAll(/<(?:li|tr)\b[^>]*>([\s\S]{0,3000}?)<\/(?:li|tr)>/giu)) {
      const value=text(row[1]).replace(/\s+/gu,' ');
      const match=value.match(new RegExp(`^(?:${label})\\s*[:：]?\\s*(.+)$`,'iu'));
      if (match) return match[1].trim();
    }
    for (const pair of markup.matchAll(/<(dt|th)\b[^>]*>([\s\S]{1,200}?)<\/\1>\s*<(dd|td)\b[^>]*>([\s\S]{1,1000}?)<\/\3>/giu)) {
      if (new RegExp(`^(?:${label})\\s*[:：]?$`,'iu').test(text(pair[2]))) return text(pair[4]);
    }
    const pair=new RegExp(`<(?:span|b|strong)\\b[^>]*>\\s*(?:${label})\\s*[:：]?\\s*</(?:span|b|strong)>\\s*(?:[:：]|&nbsp;|\\s)*<(?:span|div)\\b[^>]*>([\\s\\S]{1,500}?)</(?:span|div)>`,'iu');
    return text(markup.match(pair)?.[1]||'');
  }
  let publisher=named(structured?.publisher || structured?.distributor) || field(kind==='film'?'配給|配給会社|配信|配信元':'出版社|出版者|パブリッシャー|Publisher');
  let date=named(structured?.datePublished || structured?.releaseDate) || field(kind==='film'?'公開日|公開年月日':'発売日|刊行日|発行日|リリース日');
  let developer=named(structured?.developer || structured?.creator);
  const identifier=String(structured?.isbn || meta['books:isbn'] || meta['book:isbn'] || field('ISBN(?:コード)?')).replace(/[^\dX]/giu,'');
  const offers=[structured?.offers].flat().filter(Boolean);
  let price=offers.length===1?Number(offers[0].price):NaN;
  if (kind==='game' && new URL(url).hostname==='store.steampowered.com' && /^\/app\/\d+(?:\/|$)/u.test(new URL(url).pathname)) {
    const own=container(markup,a=>a.id==='app_header_grid',{attributes}) || container(markup,a=>/\bglance_ctn\b/u.test(a.class||''),{attributes});
    if (!own) return undefined;
    function steamField(label) {
      const grid=own.match(new RegExp(`<div\\b[^>]*class="[^"]*\\bgrid_label\\b[^"]*"[^>]*>\\s*(?:${label})\\s*[:：]?\\s*</div>\\s*<div\\b[^>]*class="[^"]*\\bgrid_content\\b[^"]*"[^>]*>([\\s\\S]{1,500}?)</div>`,'iu'));
      const row=own.match(new RegExp(`<div\\b[^>]*class="[^"]*\\bdev_row\\b[^"]*"[^>]*>\\s*<div\\b[^>]*>\\s*(?:${label})\\s*[:：]?\\s*</div>\\s*<div\\b[^>]*>([\\s\\S]{1,500}?)</div>`,'iu'));
      return text(grid?.[1]||row?.[1]||'');
    }
    developer=steamField('開発元|Developer');publisher=steamField('パブリッシャー|Publisher');
    date=steamField('リリース日|Release Date') || text(own.match(/<div\b[^>]*class="date"[^>]*>([^<]+)<\/div>/iu)?.[1]||'');
    const priceValues=[...markup.matchAll(/<meta\b[^>]*>/giu)].map(m=>attributes(m[0])).filter(a=>a.itemprop==='price').map(a=>Number(a.content));
    price=priceValues.length===1?priceValues[0]:NaN;
    if (/game_area_comingsoon|game_area_purchase_game_wrapper[^>]*>[\s\S]{0,1000}?(?:無料プレイ|Free to Play)/iu.test(markup)) return undefined;
  }
  return distributionEvidence({title,kind,sourceUrl:url,publisher,date,identifier,author,developer,price,
    context:[pageTitle,named(structured?.genre),field('制作形態|制作規模|出版形態')].join(' ') });
}
module.exports={distributionEvidence,distributionFromPage,hasOfficialDistribution,isbnIsValid,releaseDate};

const NDL_API = 'https://ndlsearch.ndl.go.jp/api/opensearch';

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/[\s\p{Punctuation}]/gu, '').toLowerCase();
}

function decodeXml(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (whole, entity) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] || whole;
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '';
    });
}

function tags(xml, name) {
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'giu');
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1]).trim());
}

function yearOf(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const match = String(value || '').match(/^(\d{3,4})(?:[-/]|$)/u);
  return match ? Number(match[1]) : null;
}

function personName(value, { aggregate = false } = {}) {
  let name = String(value || '').normalize('NFKC').trim();
  // Remove responsibility suffixes without treating text inside a name as a
  // second author. A bare role must be separated; brackets and / are explicit.
  const role = /\s*(?:\[(?:著|著者|訳|訳者|編|編者|作|原著)\]|\((?:著|著者|訳|訳者|編|編者|作|原著)\)|\/(?:著|著者|訳|訳者|編|編者|作|原著)|\s+(?:著|著者|訳|訳者|編|編者|作|原著))\s*$/u;
  while (role.test(name)) name = name.replace(role, '').trim();
  const lifespan = name.match(/[,\s]+(\d{3,4})?\s*[-–—]\s*(\d{3,4})?\s*$/u);
  const singleYear = !lifespan && name.match(/,\s*(\d{3,4})\s*$/u);
  const birthYear = lifespan?.[1] ? Number(lifespan[1]) : singleYear ? Number(singleYear[1]) : null;
  const deathYear = lifespan?.[2] ? Number(lifespan[2]) : null;
  if (lifespan) name = name.slice(0, lifespan.index).trim();
  else if (singleYear) name = name.slice(0, singleYear.index).trim();
  while (role.test(name)) name = name.replace(role, '').trim();
  // dc:creator names are separate persons and may use "surname, given".
  // An author aggregate with commas has ambiguous person boundaries, unless a
  // lifespan identifies the conventional individual authority heading.
  if (aggregate && /[,、;；]/u.test(name) && !lifespan && !singleYear) return null;
  if (/[、;；]/u.test(name)) return null;
  return { name: normalize(name), birthYear, deathYear };
}

function matchingPerson(value, entry, aggregate = false) {
  const creator = personName(value, { aggregate });
  if (!creator?.name) return null;
  const parts = (entry.authorParts || [entry.author]).map(normalize).filter(Boolean);
  if (!parts.length) return null;
  const names = new Set([parts.join(''), [...parts].reverse().join(''), normalize(entry.author)]);
  // Some NDL records omit the space in "芥川竜之介著". Remove a role only
  // after establishing that the entire preceding name equals the expected one.
  const exactName = names.has(creator.name) || [...names].some((name) => name &&
    ['著', '著者', '訳', '訳者', '編', '編者', '作', '原著'].some((role) => creator.name === name + role));
  return exactName ? creator : null;
}

function datesAgree(creator, entry) {
  const birthYear = yearOf(entry.birthDate || entry.birthYear);
  const deathYear = yearOf(entry.deathDate || entry.deathYear);
  return !(birthYear && creator.birthYear && birthYear !== creator.birthYear)
    && !(deathYear && creator.deathYear && deathYear !== creator.deathYear);
}

function creatorMatches(value, entry, aggregate = false) {
  const creator = matchingPerson(value, entry, aggregate);
  return Boolean(creator && datesAgree(creator, entry));
}

function approvedNDLUrl(value, role = 'bibliography') {
  let url;
  try { url = new URL(value); } catch { return null; }
  const valid = role === 'archive'
    ? url.hostname === 'dl.ndl.go.jp' && /^\/pid\/\d+\/?$/u.test(url.pathname)
    : url.hostname === 'ndlsearch.ndl.go.jp' && /^\/books\/R[0-9A-Za-z-]+$/u.test(url.pathname);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    !url.search && !url.hash && valid ? url.href : null;
}

function findMatchingRecord(xml, entry) {
  if (typeof xml !== 'string' || xml.length > 4 * 1024 * 1024) throw new Error('国立国会図書館の応答が不正です');
  // RSS is inspected as data; no external entities, scripts or linked pages execute.
  const expectedTitle = normalize(entry.realTitle || entry.title);
  const authorParts = (entry.authorParts || [entry.author]).map(normalize).filter(Boolean);
  if (!expectedTitle || !authorParts.length) return null;
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const item = match[1];
    const titles = [...tags(item, 'dc:title'), ...tags(item, 'title')];
    if (!titles.some((title) => normalize(title) === expectedTitle)) continue;
    const creators = tags(item, 'dc:creator');
    // Prefer individual creators. An aggregate author field must never combine
    // one person's surname with another person's given name.
    const authorRecords = creators.length ? creators : tags(item, 'author');
    const matches = authorRecords.map((creator) => matchingPerson(creator, entry, !creators.length)).filter(Boolean);
    // An undated duplicate name must not hide a contradictory authority heading.
    if (!matches.length || matches.some((creator) => !datesAgree(creator, entry))) continue;
    const url = [...tags(item, 'link'), ...tags(item, 'guid')].map((link) => approvedNDLUrl(link)).find(Boolean);
    if (!url) continue;
    const archiveUrl = [...item.matchAll(/<rdfs:seeAlso\b[^>]*rdf:resource\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/giu)]
      .map((archive) => approvedNDLUrl(decodeXml(archive[1]), 'archive')).find(Boolean);
    return { title: titles.find((title) => normalize(title) === expectedTitle), url, archiveUrl: archiveUrl || null };
  }
  return null;
}

async function findNDLBibliography(entry, { fetchImpl = global.fetch, now = () => new Date() } = {}) {
  if (!entry?.title || !entry.author) return null;
  const url = new URL(NDL_API);
  url.search = new URLSearchParams({ title: entry.title, creator: entry.author, cnt: '30' }).toString();
  const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(15000), redirect: 'error',
    headers: { 'User-Agent': 'TitleKakkoKariQuestionCollector/1.0 (source bibliographic verification)' } });
  if (!response.ok) throw new Error(`国立国会図書館の書誌を取得できません (${response.status})`);
  if (Number(response.headers?.get('content-length')) > 4 * 1024 * 1024) {
    throw new Error('国立国会図書館の応答が大きすぎます');
  }
  const match = findMatchingRecord(await response.text(), entry);
  if (!match) return null;
  return { provider: 'ndl', role: 'bibliography', label: `国立国会図書館サーチ「${match.title}」`,
    url: match.url, retrievedAt: now().toISOString(), ...(match.archiveUrl ? { archiveUrl: match.archiveUrl } : {}) };
}

async function enrichWithNDL(question, entry, options = {}) {
  try {
    const source = await findNDLBibliography(entry, options);
    if (!source) return question;
    const { archiveUrl, ...bibliography } = source;
    const sources = [...question.sources, bibliography];
    if (archiveUrl) sources.push({ provider: 'ndl', role: 'archive',
      label: `国立国会図書館デジタルコレクション「${entry.title}」`,
      url: archiveUrl, retrievedAt: source.retrievedAt });
    return { ...question, sources };
  } catch {
    // Public-domain Aozora text already establishes the source. Optional metadata
    // outages or a spent collection request budget must not discard valid work.
    return question;
  }
}

async function readNDLResponse(response) {
  if (!response.ok) throw new Error(`国立国会図書館の書誌を取得できません (${response.status})`);
  const maximum = 4 * 1024 * 1024;
  if (Number(response.headers?.get('content-length')) > maximum) throw new Error('国立国会図書館の応答が大きすぎます');
  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maximum) throw new Error('国立国会図書館の応答が大きすぎます');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const xml = await response.text();
  if (Buffer.byteLength(xml, 'utf8') > maximum) throw new Error('国立国会図書館の応答が大きすぎます');
  return xml;
}

module.exports = { NDL_API, findNDLBibliography, enrichWithNDL, findMatchingRecord, approvedNDLUrl,
  creatorMatches, decodeXml, tags, personName, readNDLResponse };

const { randomInt, createHash } = require('node:crypto');
const { questionTitleAliases } = require('./title-policy');

// These are source signals, not a claim that every player is unfamiliar with a
// work. Search wording and a missing Wikipedia article are not such evidence.
const INDEPENDENT = /インディー|\bindie\b|\bindependent\b|自主(?:制作|製作|出版)|自費出版|同人|個人(?:制作|製作|開発)|少人数(?:制作|開発)|小規模出版/iu;
const DENIAL = /では(?:ない|ありません)|ではなく|非インディー|not\s+(?:an?\s+)?indie/iu;
const WIDE_REACH = /国民的|社会現象|大ヒット|ベストセラー|ミリオンセラー|世界的(?:な)?(?:人気|ヒット)/u;
const OWN_WORK = /本(?:作|作品|ゲーム|映画)|この(?:作品|ゲーム|映画|漫画|小説)|原作|シリーズ/u;
const PRODUCTION = /(?:自主(?:制作|製作|出版)|自費出版|個人開発|少人数開発).{0,50}(?:完成させた|完成した|制作された|製作された|開発した|開発された|制作した|製作した|刊行された|出版した|による(?:映画|ゲーム|小説|漫画))/u;
const CHARACTER_ACTIVITY = /(?:主人公|登場人物|少年|少女).{0,50}(?:自主(?:制作|製作|出版)|同人|個人開発)/u;
const COPIES = /(?:累計|発行部数|販売本数|売上本数|ダウンロード数)[^。!?！？\d]{0,24}([\d,]+(?:\.\d+)?)\s*(万|億)?(?:部|本|ダウンロード|DL|件)/giu;
const MAX_SIGNALS = 12;
const key = value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\s_・･]+/gu, '').toLowerCase() : '';

function ownsStatement(statement, title, aliases, kind) {
  return OWN_WORK.test(statement) || questionTitleAliases(title, aliases, kind)
    .some(name => name.length > 1 && key(statement).includes(key(name)));
}

function substantialSales(statement) {
  return [...statement.matchAll(COPIES)].some(match => {
    const units = match[2] === '億' ? 100000000 : match[2] === '万' ? 10000 : 1;
    return Number(match[1].replaceAll(',', '')) * units >= 1000000;
  });
}

function classifySignal(signal, title, aliases, kind) {
  if (signal?.type === 'review-count') {
    return Number.isSafeInteger(signal.count) && signal.count >= 1000 ? 'wide' : null;
  }
  if (typeof signal?.excerpt !== 'string' || !signal.excerpt || signal.excerpt.length > 1000) return null;
  const excerpt = signal.excerpt.normalize('NFKC');
  if (signal.type === 'genre') return INDEPENDENT.test(excerpt) && !DENIAL.test(excerpt) ? 'small' : null;
  if (signal.type !== 'introduction') return null;
  if (substantialSales(excerpt) || WIDE_REACH.test(excerpt) && ownsStatement(excerpt, title, aliases, kind)) return 'wide';
  return INDEPENDENT.test(excerpt) && !DENIAL.test(excerpt) && !CHARACTER_ACTIVITY.test(excerpt) &&
    (ownsStatement(excerpt, title, aliases, kind) || PRODUCTION.test(excerpt)) ? 'small' : null;
}

function visibilityEvidence({ title, aliases = [], kind, sourceUrl, introductions = [], genres = [], reviewCount }) {
  const candidates = [];
  for (const genre of [genres].flat()) if (typeof genre === 'string') candidates.push({ type: 'genre', excerpt: genre });
  for (const introduction of introductions) {
    if (typeof introduction !== 'string') continue;
    for (const excerpt of introduction.normalize('NFKC').split(/(?<=[。!?！？])/u)) {
      if (excerpt.trim()) candidates.push({ type: 'introduction', excerpt: excerpt.trim() });
    }
  }
  // Counts come only from the identified work's structured aggregate rating.
  // A new work with few reviews is not automatically an obscure work.
  const count = typeof reviewCount === 'number' ? reviewCount :
    typeof reviewCount === 'string' && /^\d[\d,]*$/u.test(reviewCount) ? Number(reviewCount.replaceAll(',', '')) : NaN;
  if (Number.isSafeInteger(count)) candidates.push({ type: 'review-count', count });
  const signals = candidates.filter(s => classifySignal(s, title, aliases, kind));
  // Preserve wide-reach evidence before small-scale evidence, so a long intro
  // cannot hide its large sales or review count behind many indie claims.
  signals.sort((a, b) => (classifySignal(a, title, aliases, kind) === 'wide' ? 0 : 1) -
    (classifySignal(b, title, aliases, kind) === 'wide' ? 0 : 1));
  if (!signals.length) return undefined;
  const selected = signals.slice(0, MAX_SIGNALS);
  return { version: 1, sourceUrl, workTitle: title, kind, signals: selected,
    sha256: createHash('sha256').update(JSON.stringify(selected)).digest('hex') };
}

function evidenceTier(question) {
  const evidence = question.evidence?.visibility ?? visibilityEvidence({title:question.realTitle,aliases:question.aliases,
    kind:question.kind,sourceUrl:question.sources?.[0]?.url,introductions:[question.evidence?.excerpts?.join('')]});
  if (!evidence || evidence.version !== 1 || evidence.sourceUrl !== question.sources?.[0]?.url ||
      evidence.workTitle !== question.realTitle || evidence.kind !== question.kind ||
      !Array.isArray(evidence.signals) || !evidence.signals.length || evidence.signals.length > MAX_SIGNALS ||
      evidence.sha256 !== createHash('sha256').update(JSON.stringify(evidence.signals)).digest('hex')) return 1;
  const signals = evidence.signals.map(s => classifySignal(s, question.realTitle, question.aliases, question.kind));
  if (signals.some(s => !s)) return 1;
  if (signals.includes('wide')) return 2;
  return signals.includes('small') ? 0 : 1;
}

function createSelectionPolicy(seedQuestions = []) {
  const seedIds = new Set(seedQuestions.map(q => q.id));
  const seedNames = new Set(seedQuestions.flatMap(q => questionTitleAliases(q.realTitle, q.aliases, q.kind).map(name => `${q.kind}:${key(name)}`)));
  function tier(question) {
    // A famous seed re-collected from a different site stays a fallback.
    if (seedIds.has(question.id) || questionTitleAliases(question.realTitle, question.aliases, question.kind)
      .some(name => seedNames.has(`${question.kind}:${key(name)}`))) return 3;
    return evidenceTier(question);
  }
  function preferred(questions) {
    if (!questions.length) return [];
    const minimum = questions.reduce((minimum, q) => Math.min(minimum, tier(q)), Infinity);
    return questions.filter(q => tier(q) === minimum);
  }
  function select(questions) {
    const pool = preferred(questions);
    if (!pool.length) throw new Error('未使用の問題がありません');
    // Balance genres first, then domains within the chosen genre. The number
    // of film domains or publisher records must not dominate another medium.
    const genres = new Map();
    for (const q of pool) {
      if (!genres.has(q.kind)) genres.set(q.kind, new Map());
      const domains = genres.get(q.kind), domain = new URL(q.sources[0].url).hostname;
      if (!domains.has(domain)) domains.set(domain, []);
      domains.get(domain).push(q);
    }
    const domains = [...genres.values()][randomInt(genres.size)];
    const works = [...domains.values()][randomInt(domains.size)];
    return works[randomInt(works.length)];
  }
  return { tier, preferred, select };
}

module.exports = { createSelectionPolicy, visibilityEvidence, evidenceTier };

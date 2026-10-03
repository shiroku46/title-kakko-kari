const { redactTitle, sourceSentences, summarizeWithoutTitles, containsTitle } = require('./generator');
const { MIN_LENGTH, MAX_LENGTH, MAX_SENTENCES, EXCLUDED_SECTION, introductionSentenceIsUsable } = require('./quality');
const { KIND_IDS } = require('./kinds');
const { playableTitle, questionTitleAliases } = require('./title-policy');
const KINDS = new Set(KIND_IDS);

function sourceIsValid(source) {
  try {
    const url = new URL(source.url);
    if (typeof source.label !== 'string' || !source.label.trim()
      || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || typeof source.retrievedAt !== 'string' || !Number.isFinite(Date.parse(source.retrievedAt))) return false;
    if (!source.provider || source.provider === 'wikipedia') {
      return url.hostname === 'ja.wikipedia.org' && url.pathname.startsWith('/wiki/')
        && Number.isInteger(source.revisionId) && source.revisionId > 0
        && url.search === `?oldid=${source.revisionId}`
        && source.license === 'CC BY-SA 4.0'
        && source.licenseUrl === 'https://creativecommons.org/licenses/by-sa/4.0/';
    }
    if (source.provider === 'aozora') {
      const textUrl = new URL(source.textUrl);
      return url.hostname === 'www.aozora.gr.jp' && !url.search
        && /^\/cards\/\d+\/card\d+\.html$/.test(url.pathname)
        && textUrl.protocol === 'https:' && textUrl.hostname === url.hostname
        && !textUrl.username && !textUrl.password && !textUrl.port && !textUrl.search && !textUrl.hash
        && /^\/cards\/\d+\/files\/[\w.-]+\.html?$/.test(textUrl.pathname)
        && source.license === '著作権なし（青空文庫公開情報）';
    }
    if (source.provider === 'ndl') {
      return !url.search && ((source.role === 'bibliography'
        && url.hostname === 'ndlsearch.ndl.go.jp' && /^\/books\/[\w-]+$/.test(url.pathname))
        || (source.role === 'archive'
        && url.hostname === 'dl.ndl.go.jp' && /^\/pid\/\d+\/?$/.test(url.pathname)));
    }
    if (source.provider === 'web') {
      const { publicUrl } = require('./web-fetch');
      return publicUrl(source.url).href === source.url;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function evidenceMatchesPrimarySource(question) {
  const source = question.sources[0];
  const id = question.evidence.sourceId;
  if (source.provider === 'web') {
    const { hash, canonicalTitle, workPageTitleIsEligible } = require('./web-source');
    const work = question.evidence.work;
    return work?.version === 2 && playableTitle(work.title, work.kind) === question.realTitle && work.kind === question.kind
      && ['typed-work','page-title','posted-work'].includes(work.method) && typeof work.pageTitle === 'string' && canonicalTitle(work.pageTitle).includes(question.realTitle)
      && (work.method !== 'posted-work' || new URL(source.url).hostname === 'kakuyomu.jp' && /^\/works\/\d+$/u.test(new URL(source.url).pathname))
      && workPageTitleIsEligible(work.pageTitle, work.method, question.evidence.excerpts?.join(''))
      && id === `web-${hash(source.url)}` && question.id === id;
  }
  if (source.provider === 'aozora') {
    const workId = new URL(source.url).pathname.match(/card(\d+)\.html$/)?.[1];
    return /^aozora-\d+$/.test(id) && Number(id.slice('aozora-'.length)) === Number(workId);
  }
  if (source.provider === 'ndl') {
    const recordId = new URL(source.url).pathname.match(/^\/books\/(R[0-9A-Za-z-]+)$/)?.[1];
    return source.role === 'bibliography' && Boolean(recordId) && id === `ndl-${recordId}`;
  }
  return (!source.provider || source.provider === 'wikipedia')
    && /^wikipedia-ja-\d+-\d+$/.test(id) && id.endsWith(`-${source.revisionId}`);
}

function questionIsValid(question) {
  return question && typeof question.id === 'string' && question.id.length > 0
    && typeof question.realTitle === 'string' && question.realTitle.trim().length > 0
    && playableTitle(question.realTitle, question.kind) === question.realTitle
    && Array.isArray(question.aliases) && question.aliases.every((alias) => typeof alias === 'string' && alias.trim())
    && KINDS.has(question.kind)
    && (question.contentType === undefined || ['synopsis', 'description'].includes(question.contentType))
    && typeof question.synopsis === 'string' && question.synopsis.length >= MIN_LENGTH && question.synopsis.length <= MAX_LENGTH
    && !question.synopsis.includes('■■■')
    && sourceSentences(question.synopsis).length > 0 && sourceSentences(question.synopsis).length <= MAX_SENTENCES
    && sourceSentences(question.synopsis).every(introductionSentenceIsUsable)
    && sourceSentences(question.synopsis).join('') === question.synopsis.normalize('NFKC').trim()
    && !containsTitle(question.synopsis, questionTitleAliases(question.realTitle, question.aliases, question.kind))
    && Array.isArray(question.sources) && question.sources.length > 0 && question.sources.every(sourceIsValid)
    && ['extractive-v1', 'local-ai-v1'].includes(question.generationMethod)
    && question.evidence && typeof question.evidence.sourceId === 'string'
    && evidenceMatchesPrimarySource(question)
    && typeof question.evidence.section === 'string' && question.evidence.section.trim().length > 0
    && !EXCLUDED_SECTION.test(question.evidence.section)
    && /^[a-f0-9]{64}$/.test(question.evidence.sourceTextSha256)
    && Array.isArray(question.evidence.excerpts) && question.evidence.excerpts.length > 0
    && question.evidence.excerpts.every((excerpt) => typeof excerpt === 'string' && excerpt.trim().length > 0)
    && question.synopsis === question.evidence.excerpts.join('');
}

function prepareQuestion(question) {
  try {
    // A quoted endorsement can span multiple sentences before its credit.
    // Reject such legacy evidence rather than retaining the uncredited quote.
    if (/書評より(?:抜粋|引用)/u.test(question.evidence?.excerpts?.join('') || '')) return null;
    const realTitle = playableTitle(question.realTitle, question.kind);
    if (!realTitle) return null;
    if (questionIsValid(question)) return question;
    const originalAliases = [question.realTitle, ...question.aliases];
    // Only adjust verifiable saved excerpts. Never repair a mismatched or
    // invented synopsis, or convert a primary-text passage into an introduction.
    if (EXCLUDED_SECTION.test(question.evidence.section) ||
        (question.synopsis !== redactTitle(question.evidence.excerpts.join(''), originalAliases) &&
         question.synopsis !== question.evidence.excerpts.join(''))) return null;
    const aliases = questionTitleAliases(realTitle, originalAliases, question.kind);
    const summary = summarizeWithoutTitles(question.evidence.excerpts.join(''), aliases);
    const synopsis = summary.synopsis;
    const visibility = question.evidence.visibility;
    const prepared = { ...question, realTitle, aliases, synopsis, evidence: { ...question.evidence, excerpts: summary.excerpts,
      // Edition normalization changes the bound title, not the production
      // source. Rebind only evidence that matched the original title exactly.
      ...(visibility?.workTitle === question.realTitle && realTitle !== question.realTitle && {
        visibility: { ...visibility, workTitle: realTitle },
      }) } };
    return questionIsValid(prepared) ? prepared : null;
  } catch { return null; }
}

module.exports = { questionIsValid, sourceIsValid, prepareQuestion };

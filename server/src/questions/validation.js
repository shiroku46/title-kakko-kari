const { redactTitle } = require('./generator');
const { KIND_IDS } = require('./kinds');
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
    return false;
  } catch (_) {
    return false;
  }
}

function evidenceMatchesPrimarySource(question) {
  const source = question.sources[0];
  const id = question.evidence.sourceId;
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
    && Array.isArray(question.aliases) && question.aliases.every((alias) => typeof alias === 'string' && alias.trim())
    && KINDS.has(question.kind)
    && (question.contentType === undefined || ['synopsis', 'description'].includes(question.contentType))
    && typeof question.synopsis === 'string' && question.synopsis.length >= 120 && question.synopsis.length <= 450
    && redactTitle(question.synopsis, [question.realTitle, ...question.aliases]) === question.synopsis
    && Array.isArray(question.sources) && question.sources.length > 0 && question.sources.every(sourceIsValid)
    && ['extractive-v1', 'local-ai-v1'].includes(question.generationMethod)
    && question.evidence && typeof question.evidence.sourceId === 'string'
    && evidenceMatchesPrimarySource(question)
    && typeof question.evidence.section === 'string' && question.evidence.section.trim().length > 0
    && /^[a-f0-9]{64}$/.test(question.evidence.sourceTextSha256)
    && Array.isArray(question.evidence.excerpts) && question.evidence.excerpts.length > 0
    && question.evidence.excerpts.every((excerpt) => typeof excerpt === 'string' && excerpt.trim().length > 0)
    && question.synopsis === redactTitle(question.evidence.excerpts.join(''), [question.realTitle, ...question.aliases]);
}


module.exports = { questionIsValid, sourceIsValid };

const { createHash } = require('node:crypto');
const { getKind } = require('./kinds');
const { MIN_LENGTH, MAX_LENGTH, TARGET_LENGTH, MAX_SENTENCES, introductionSentenceIsUsable } = require('./quality');
const { requirePlayableTitle } = require('./title-policy');

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const LICENSE = 'CC BY-SA 4.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
const TYPE_INDICATORS = {
  novel: /(?:小説(?:集|作品|シリーズ)?|童話(?:集|作品)?|児童文学(?:作品)?|児童書|短編文学|寓話)(?=。|$|、|で(?:ある|あり|、))/u,
  'short-story': /(?:短編小説|短篇小説|掌編小説|短編文学作品|ショートショート)(?=。|$|、|で(?:ある|あり|、))/u,
  'literary-work': /(?:文学作品|文芸作品|小説(?:集|作品)?|童話(?:集|作品)?|児童文学(?:作品)?|随筆(?:集)?|エッセイ(?:集)?|詩集|戯曲)(?=。|$|、|で(?:ある|あり|、))/u,
  film: /(?:映画(?:作品)?|ドキュメンタリー(?:映画|作品)?|劇場(?:用)?アニメ(?:ーション)?|アニメーション作品)(?=。|$|、|で(?:ある|あり|、))/u,
  manga: /(?:漫画(?:作品|シリーズ)?|マンガ(?:作品|シリーズ)?|コミック(?:作品|シリーズ)?|漫画短編集)(?=。|$|、|で(?:ある|あり|、))/u,
  anime: /(?:テレビアニメ(?:作品|シリーズ)?|アニメ(?:作品|シリーズ)?|アニメーション(?:作品|映画)?|OVA|OAV|オリジナル(?:ビデオ|ネット)アニメ(?:ーション)?)(?=。|$|、|で(?:ある|あり|、))/u,
  game: /(?:(?:コンピュータ|ビデオ|ボード|カード|テーブル|アーケード|家庭用|ブラウザ|オンライン|スマートフォン|携帯電話用|コンシューマー|ロールプレイング|アクション|アドベンチャー|シューティング|シミュレーション|パズル|ストラテジー|レーシング|トレーディングカード)ゲーム(?:作品)?|ゲームソフト|ゲーム作品|コンピューター?RPG|テーブルトークRPG)(?=。|$|、|で(?:ある|あり|、))/u,
  play: /(?:戯曲|演劇作品|舞台作品|ミュージカル(?:作品)?|歌劇|オペラ(?:作品)?|人形劇作品)(?=。|$|、|で(?:ある|あり|、))/u,
  drama: /(?:テレビドラマ(?:作品|シリーズ)?|ドラマ(?:作品|シリーズ)?|連続(?:テレビ)?ドラマ|ラジオドラマ|テレビ映画)(?=。|$|、|で(?:ある|あり|、))/u,
  song: /(?:楽曲|歌曲|歌|シングル(?:曲|作品)?|音楽作品)(?=。|$|、|で(?:ある|あり|、))/u,
  album: /(?:アルバム(?:作品)?|音楽アルバム|スタジオアルバム|ライブアルバム|ベストアルバム|ミニアルバム|コンピレーションアルバム)(?=。|$|、|で(?:ある|あり|、))/u,
  'music-work': /(?:音楽作品|楽曲|交響曲|協奏曲|管弦楽曲|室内楽曲|器楽曲|歌曲|組曲|ソナタ|歌劇|オペラ)(?=。|$|、|で(?:ある|あり|、))/u,
  poem: /(?:詩(?:作品|集)?|叙事詩|抒情詩|叙情詩|短歌(?:集)?|俳句(?:集)?)(?=。|$|、|で(?:ある|あり|、))/u,
  artwork: /(?:絵画(?:作品)?|彫刻(?:作品)?|写真作品|美術作品|芸術作品|版画(?:作品)?|書道作品|インスタレーション作品)(?=。|$|、|で(?:ある|あり|、))/u,
  nonfiction: /(?:書籍|著作|著書|ノンフィクション(?:作品)?|評伝|評論(?:集)?|随筆(?:集)?|エッセイ(?:集)?|伝記|研究書|紀行(?:文)?|ルポルタージュ)(?=。|$|、|で(?:ある|あり|、))/u,
  'other-work': /(?:創作作品|文芸作品|芸術作品|美術作品|映像作品|放送作品|テレビ番組|ラジオ番組|アニメーション作品|舞台作品|文学作品|著作|作品)(?=。|$|、|で(?:ある|あり|、))/u,
};
const NON_WORK_DEFINITION = /(?:島|諸島|河川|川|湖|山|地名|人名|地域|都市|国家|町|村|県|人物|小説家|漫画家|作家|著者|歌手|バンド|音楽グループ|作曲家|作詞家|指揮者|演奏家|俳優|女優|監督|脚本家|教育者|学者|企業|会社|法人|財団|出版社|レーベル|制作会社|製作会社|配給会社|大学|学校|図書館|博物館|美術館|映画館|映画祭|祭典|一覧|ジャンル|文学の形式|文学形式|表現手法|表現形式|文学用語|音楽形式|音楽用語|映像表現|映像技法)(?:の(?:一つ|一種|一連|ひとつ|1つ|名称))?(?=。|$|で(?:ある(?:。|$)|あり[、,]|[、,]))/u;
const GENERIC_ARTICLE_TITLES = new Set(['小説', '映画', '漫画', 'アニメ', 'アニメーション', 'ゲーム', 'コンピュータゲーム', 'コンピュータRPG', 'コンピューターRPG', 'ロールプレイングゲーム', '楽曲', '音楽', 'アルバム', '詩', '絵画', '彫刻', '写真', '舞台', '戯曲', '演劇', '文学', 'ノンフィクション', '書籍', '作品', 'テレビ番組']);
const PLANNED_WORK = /(?:刊行|出版|発売|発表|配信|放送|公開|上映|制作|製作|連載)(?:される|され|する)?(?:予定|計画)|(?:予定|計画|構想)(?:されている|中|段階)|未公開|未刊行|未出版/u;
const FICTIONAL_WORK = new RegExp('(?:架空の|に登場する(?:架空の)?)(?:日本の|海外の|長編|短編|新作|人気|作中の){0,3}' +
  `(?:作中(?:の)?作品|出版物|${Object.values(TYPE_INDICATORS).map((pattern) => pattern.source).join('|')})`, 'u');

function normalize(value) {
  return value.replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function stripDisambiguation(title) {
  return normalize(title).replace(/\s*\([^()]+\)$/u, '').trim();
}

function normalizedTitle(value) {
  return normalize(value).replace(/[\s_]+/gu, '').toLocaleLowerCase('ja');
}

function titleAliases(entry) {
  if (!entry || typeof entry.title !== 'string' || !entry.title.trim() ||
      !/^[a-z0-9][a-z0-9-]{1,79}$/u.test(entry.id || '') ||
      !getKind(entry.kind) || !Object.hasOwn(TYPE_INDICATORS, entry.kind) ||
      (entry.aliases !== undefined && (!Array.isArray(entry.aliases) ||
        entry.aliases.some((alias) => typeof alias !== 'string' || !alias.trim())))) {
    throw new Error('作品カタログの形式が不正です');
  }
  const realTitle = entry.realTitle || stripDisambiguation(entry.title);
  if (typeof realTitle !== 'string' || !realTitle.trim() ||
      normalizedTitle(realTitle) !== normalizedTitle(stripDisambiguation(entry.title))) {
    throw new Error('正解タイトルが登録済みの記事タイトルと一致しません');
  }
  return [...new Set([entry.title, realTitle, ...(entry.aliases || [])].map(normalize))];
}

function retrievedTitleAliases(entry, page) {
  const aliases = titleAliases(entry);
  // prop=redirects describes pages targeting this verified article, unlike
  // page.redirect, which describes the requested page itself as a redirect.
  for (const redirect of page.redirects || []) {
    if (!redirect || (redirect.ns !== undefined && redirect.ns !== 0) || redirect.fragment ||
        typeof redirect.title !== 'string' || !normalize(redirect.title)) continue;
    const title = normalize(redirect.title);
    aliases.push(title, stripDisambiguation(title));
  }
  const subject = workSubject(page);
  if (subject) {
    aliases.push(subject.name);
    for (const note of subject.readingNotes) aliases.push(...readingAliases(note));
  }
  // Short verified aliases remain masked too; if they erase too much text the
  // existing useful-length check rejects the question rather than leaking it.
  return [...new Set(aliases.filter(Boolean))];
}

function subjectTitleKey(title) {
  // Article-title restrictions sometimes omit a decorative mark in the lead.
  return normalizedTitle(title).replace(/[♥♡❤★☆♪♫]+$/u, '');
}

function skipReading(prefix, readingNotes = []) {
  let rest = prefix.trimStart();
  while (rest.startsWith('(')) {
    let depth = 0;
    let end = -1;
    for (let index = 0; index < rest.length; index++) {
      if (rest[index] === '(') depth++;
      if (rest[index] === ')' && --depth === 0) { end = index; break; }
    }
    if (end < 0) return null;
    readingNotes.push(rest.slice(1, end));
    rest = rest.slice(end + 1).trimStart();
  }
  return rest;
}

function readingAliases(note) {
  const aliases = [];
  for (const piece of normalize(note).split(/[、;；]/u)) {
    const annotation = piece.trim().match(/^(?:(?:英|英語|英題|原題|原語名|原語|別名|別称|略称|読み|新仮名|旧表記|[\p{Script=Han}\p{Script=Katakana}]+語|English|original title|also known as|abbreviation)\s*[:：]\s*)(.+)$/iu);
    const pronunciation = (annotation ? annotation[1] : piece).match(/\[([^\]]+)\]\s*$/u)?.[1];
    if (pronunciation && /[ɐ-ʯˈˌ]/u.test(pronunciation)) aliases.push(pronunciation);
    let alias = (annotation ? annotation[1] : piece).trim()
      .replace(/\s*\[[^\]]*\]\s*$/u, '').replace(/^[『「“"]|[』」”"]$/gu, '').trim();
    if (!alias || /[()\[\]]/u.test(alias)) continue;
    // Only the named subject's immediate annotation is read. Unmarked kana
    // readings and Latin original names are safe; dates/creator notes are not.
    const reading = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(alias);
    const latin = /\p{Script=Latin}/u.test(alias) &&
      /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(alias);
    if (reading || latin || (annotation && !/(?:年|公開|刊行|監督|作曲|著者|原作)/u.test(alias))) aliases.push(alias);
  }
  return aliases;
}

function removeReferenceSpans(value) {
  const pairs = { '(': ')', '『': '』', '「': '」', '“': '”', '〈': '〉' };
  const closes = [];
  let result = '';
  for (const character of value) {
    if (Object.hasOwn(pairs, character)) {
      if (!closes.length) result += ' ';
      closes.push(pairs[character]);
    } else if (closes.length && character === closes.at(-1)) closes.pop();
    else if (!closes.length) result += character;
  }
  return normalize(result);
}

function workSubject(page) {
  if (typeof page?.title !== 'string' || typeof page.extract !== 'string') return null;
  const paragraph = page.extract.trimStart().split(/\r?\n/u)[0];
  const sentence = sourceSentences(paragraph)[0] || normalize(paragraph);
  const aliases = [page.title, stripDisambiguation(page.title), ...(page.redirects || [])
    .filter((redirect) => redirect && (redirect.ns === undefined || redirect.ns === 0) &&
      !redirect.fragment && typeof redirect.title === 'string')
    .flatMap((redirect) => [redirect.title, stripDisambiguation(redirect.title)])];
  let remaining;
  let name;
  const quote = { '『': '』', '「': '」', '“': '”', '"': '"' }[sentence[0]];
  if (quote) {
    const end = sentence.indexOf(quote, 1);
    if (end < 0 || !aliases.some((alias) => subjectTitleKey(alias) === subjectTitleKey(sentence.slice(1, end)))) return null;
    name = sentence.slice(1, end);
    remaining = sentence.slice(end + 1);
  } else {
    const alias = [...aliases].sort((a, b) => b.length - a.length).find((candidate) =>
      new RegExp(`^${aliasPattern(candidate).source}`, 'iu').test(sentence));
    if (!alias) return null;
    const matched = sentence.match(new RegExp(`^${aliasPattern(alias).source}`, 'iu'));
    name = matched[0];
    remaining = sentence.slice(matched[0].length);
  }
  const readingNotes = [];
  remaining = skipReading(remaining, readingNotes);
  const topic = remaining?.match(/^(?:と)?は\s*[、,]?\s*/u);
  if (!topic) return null;
  // References to another book, a parent's title, or a reading annotation cannot
  // establish this article's type. Classification uses the unquoted predicate.
  return { name, readingNotes, predicate: removeReferenceSpans(remaining.slice(topic[0].length)) };
}

function workDefinition(page) {
  return workSubject(page)?.predicate || null;
}

function matchesWorkType(page, kind) {
  if (!getKind(kind) || !Object.hasOwn(TYPE_INDICATORS, kind)) return false;
  if (typeof page?.title !== 'string' || GENERIC_ARTICLE_TITLES.has(normalize(page.title))) return false;
  const predicate = workDefinition(page);
  // Category membership is a discovery hint, never sufficient evidence. Fail
  // closed unless the opening sentence defines this named article as a work.
  return Boolean(predicate && TYPE_INDICATORS[kind].test(predicate) &&
    !NON_WORK_DEFINITION.test(predicate) && !PLANNED_WORK.test(predicate) &&
    !FICTIONAL_WORK.test(predicate));
}

function authoredWorkMatches(page, expectedAuthors) {
  if (!Array.isArray(expectedAuthors) || !expectedAuthors.length ||
      expectedAuthors.some((author) => typeof author !== 'string' || !normalize(author))) return false;
  // A source book's author is not the creator of its adaptation. Remove the
  // bounded source clause while retaining the resulting work's own credits.
  const predicate = workDefinition(page)?.replace(/\s+/gu, '')
    .replace(/(?:^|[、,])[^、,。]*?(?:を原作と(?:する|した)|を原作に(?:した|する)|を題材に(?:した|する)|を(?:もと|元|基)に(?:した|する)|のリメイクで(?:ある|あり))[、,]?/gu, '');
  if (!predicate) return false;
  const modifiers = '(?:長編|長篇|短編|短篇|掌編|中編|中篇|推理|SF|ミステリー|ミステリ|サスペンス|恋愛|官能|百合|青春|学園|歴史|児童|幻想|冒険|恐怖|ホラー|連作|日本|監督|作詞|作曲|脚本|演出|の|・){0,8}';
  return expectedAuthors.some((author) => {
    const name = normalize(author).replace(/[\p{P}\p{S}\s]/gu, '');
    if (!name) return false;
    const pattern = [...name].map(escapeRegExp).join('[\\p{P}\\p{S}\\s]*');
    return new RegExp(`${pattern}` +
      `(?:による|が(?:著した|書いた|執筆した|作曲した)|[・,:]?(?:著|作詞|作曲|作|文|画|監督|演出|脚本)(?=[・、,。の]|による|$)|の?\\d+(?:作目|枚目|(?:st|nd|rd|th))(?:の)?(?:シングル(?:曲|作品)?|(?:フル[・-]?)?アルバム)(?=。|$|で(?:ある|あり))|の${modifiers}(?:小説|童話|文学作品|エッセイ|随筆|詩集|漫画|映画|アニメ|ゲーム|楽曲|シングル|(?:フル[・-]?)?アルバム|絵画|彫刻|著作|書籍|作品))`, 'iu').test(predicate);
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function aliasPattern(alias) {
  // NFKC handles full-width spelling; optional spacing handles title typography.
  return new RegExp([...normalize(alias).replace(/\s+/gu, '')]
    .map(escapeRegExp).join('\\s*'), 'giu');
}

function containsTitle(text, aliases) {
  const normalized = normalize(text);
  return aliases.some((alias) => aliasPattern(alias).test(normalized));
}

function redactTitle(text, aliases) {
  let masked = normalize(text);
  for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
    masked = masked.replace(aliasPattern(alias), '■■■');
  }
  return masked;
}

function extractPlotSection(extract) {
  if (typeof extract !== 'string') throw new Error('記事の本文がありません');
  const lines = extract.split(/\r?\n/u);
  let start = -1;
  let depth = 0;
  let section = '';
  const paragraphs = [];
  const ancestors = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].trim().match(/^(={2,6})\s*(.*?)\s*\1$/u);
    if (heading) {
      while (ancestors.length && ancestors.at(-1).depth >= heading[1].length) ancestors.pop();
      const excluded = EXCLUDED_HEADINGS.test(heading[2]) || ancestors.some((parent) => parent.excluded);
      ancestors.push({ depth: heading[1].length, excluded });
    }
    if (start < 0) {
      if (heading && !ancestors.at(-1).excluded && /^(?:あらすじ|ストーリー|物語|梗概|プロット)(?:\s*[（(:：].*)?$/u.test(heading[2])) {
        start = index;
        depth = heading[1].length;
        section = heading[2];
      }
      continue;
    }
    if (heading && heading[1].length <= depth) break;
    const line = lines[index].trim();
    const subheading = line.length <= 40 && !/[。！？]/u.test(line) &&
      /^(?:プロローグ|エピローグ|オープニング|序章|序盤|中盤|終盤|鉱山街|[一二三四五六七八九十]+、.*)$/u.test(line);
    const editorialNote = /^[（(].*(?:草稿|章番号|校訂|全集|回想の要約).*[）)]$/u.test(line);
    if (!heading && !subheading && !editorialNote && !ancestors.some((parent) => parent.excluded)) paragraphs.push(lines[index]);
  }
  const text = normalize(paragraphs.join('\n'));
  if (start < 0 || text.length < MIN_LENGTH) {
    throw new Error('十分な長さのあらすじ・ストーリー節がありません');
  }
  assertStandalonePlot(text);
  return { section, text };
}

const DESCRIPTION_HEADINGS = /^(?:概要|概説|内容|内容紹介|解説|作品概要|作品紹介|特徴|構成|主題|作風|楽曲解説|曲の解説)(?:\s*[（(:：].*)?$/u;
const EXCLUDED_HEADINGS = /歌詞|収録曲|トラックリスト|曲目|目次|参加ミュージシャン|スタッフ|出演者|キャスト|クレジット|ディスコグラフィ|出版情報|書誌|(?:詩|歌|作品)の(?:本文|全文|原文)|^(?:本文|全文|原文)$/u;
const CONTENT_DESCRIPTION = /描[くいたかき]|題材|扱[うっいわ]|表現|主題|テーマ|物語|ストーリー|主人公|舞台(?:は|に|として)|登場|特徴|特色|構成|構造|旋律|メロディ|リズム|拍子|調性|和声|音色|歌唱|歌詞(?:は|の意味|の内容|に)|曲調|楽章|編曲|サウンド|奏法|構図|色彩|画面|造形|筆致|絵画技法|詩形|詩行|韻|叙情|抒情|情景|論じ|分析|考察|検証|説明|解説|ルール|プレイヤー|操作|ゲーム内|演出|番組内|紹介する|紹介して/u;

function descriptionSections(extract) {
  const lines = extract.split(/\r?\n/u);
  const candidates = [];
  const firstHeading = lines.findIndex((line) => /^\s*={2,6}/u.test(line));
  const intro = normalize(lines.slice(0, firstHeading < 0 ? lines.length : firstHeading).join('\n'));
  const ancestors = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].trim().match(/^(={2,6})\s*(.*?)\s*\1$/u);
    if (!heading) continue;
    while (ancestors.length && ancestors.at(-1).depth >= heading[1].length) ancestors.pop();
    const excluded = EXCLUDED_HEADINGS.test(heading[2]) || ancestors.some((parent) => parent.excluded);
    ancestors.push({ depth: heading[1].length, excluded });
    if (excluded || !DESCRIPTION_HEADINGS.test(heading[2])) continue;
    const paragraphs = [];
    let suppressedDepth = null;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const nested = lines[cursor].trim().match(/^(={2,6})\s*(.*?)\s*\1$/u);
      if (nested && nested[1].length <= heading[1].length) break;
      if (nested) {
        if (suppressedDepth !== null && nested[1].length <= suppressedDepth) suppressedDepth = null;
        if (EXCLUDED_HEADINGS.test(nested[2])) suppressedDepth = nested[1].length;
        continue;
      }
      if (suppressedDepth === null) paragraphs.push(lines[cursor]);
    }
    candidates.push({ section: heading[2], text: normalize(paragraphs.join('\n')) });
  }
  candidates.push({ section: '冒頭紹介', text: intro });
  return candidates;
}

function descriptionSentences(text, aliases, kind = null) {
  return sourceSentences(text).filter((sentence) => {
    const quoted = sentence.match(/^[『「]([^』」]+)[』」]/u);
    if (quoted && !aliases.some((alias) => subjectTitleKey(alias) === subjectTitleKey(quoted[1]))) return false;
    if (/^(?:前作|次作|続編|姉妹作|関連作品)(?:の)?[『「]/u.test(sentence)) return false;
    if (/^(?:歌詞|詩の本文|全文|収録曲|トラックリスト|目次)[：:]/u.test(sentence)) return false;
    // Quote-only lines are primary lyrics/poem text, not commentary about it.
    if (/^[「『“"].*[」』”"](?:。)?$/u.test(sentence)) return false;
    if (['song', 'album', 'music-work', 'poem'].includes(kind) &&
        /^(?:私|僕|俺|わたし|わたしたち|君|あなた)/u.test(sentence)) return false;
    return CONTENT_DESCRIPTION.test(removeReferenceSpans(sentence));
  });
}

function extractDescription(extract, aliases, kind = null) {
  for (const candidate of descriptionSections(extract)) {
    const excerpts = descriptionSentences(candidate.text, aliases, kind);
    if (excerpts.join('').length < MIN_LENGTH) continue;
    try {
      const summary = summarizeExtractively(excerpts.join(''));
      return { ...candidate, ...summary, allowedSentences: excerpts, contentType: 'description' };
    } catch {
      // Another section may contain sufficient complete descriptive sentences.
    }
  }
  throw new Error('作品自身の内容が分かる十分な紹介文がありません');
}

function extractWorkContent(page, kind, aliases) {
  if (getKind(kind).contentMode === 'story') {
    try {
      const plot = extractPlotSection(page.extract);
      const summary = summarizeExtractively(plot.text);
      return { ...plot, ...summary, allowedSentences: sourceSentences(plot.text), contentType: 'synopsis' };
    } catch {
      // An overview is labelled as a description; no plot is invented for it.
    }
  }
  return extractDescription(page.extract, aliases, kind);
}

function assertStandalonePlot(text) {
  const beginning = sourceSentences(text).slice(0, 2);
  const adaptationComparison = /(?:映画|原作|小説|アニメ|漫画|ドラマ)(?:版)?(?:と(?:ほぼ)?(?:同じ|同様)|との(?:違い|相違|差異)|との差異|に(?:ほぼ)?準拠)|原作とは(?:異な|違)/u;
  const dependentReference = /(?:詳しい|詳細な|基本的な)?(?:あらすじ|ストーリー|筋書き).{0,35}(?:を参照|項目を参照|そちらを参照|後述を参照)/u;
  const productionOnly = /^(?:プロデューサー|監督|脚本家|制作陣|製作陣|原作者|作者|スタッフ).*(?:映画化|映画版|原作|製作費|上映時間|許諾|交渉|説得|脚本執筆|制作過程)/u;
  if (beginning.some((sentence) => adaptationComparison.test(sentence) ||
      dependentReference.test(sentence) || productionOnly.test(sentence))) {
    throw new Error('独立した筋書きではなく、他媒体との比較・制作情報の節です');
  }
}

function sourceSentences(text) {
  const source = normalize(text);
  const sentences = [];
  const closingQuotes = { '「': '」', '『': '』', '“': '”' };
  const openQuotes = [];
  let beginning = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (Object.hasOwn(closingQuotes, character)) openQuotes.push(closingQuotes[character]);
    else if (character === openQuotes.at(-1)) openQuotes.pop();
    if (/[。!?！？]/u.test(character) && !openQuotes.length) {
      while (/[。!?！？]/u.test(source[index + 1] || '')) index++;
      sentences.push(source.slice(beginning, index + 1));
      beginning = index + 1;
    }
  }
  // A trailing fragment is deliberately omitted rather than cut mid-dialogue.
  return sentences.map((sentence) => sentence.trim()).filter((sentence) =>
    !/上映形式|部構成とする見方|下記のような注意書き|章番号|校訂/u.test(sentence));
}

function summarizeExtractively(text, { minLength = MIN_LENGTH, maxLength = MAX_LENGTH } = {}) {
  const sentences = sourceSentences(text).filter(introductionSentenceIsUsable);
  maxLength = Math.min(maxLength, MAX_LENGTH);
  const selected = [];
  let length = 0;
  for (const sentence of sentences) {
    const excerpt = sentence.trim();
    if (excerpt.length > maxLength) continue;
    if (length + excerpt.length > maxLength) break;
    selected.push(excerpt);
    length += excerpt.length;
    if (length >= Math.min(TARGET_LENGTH, maxLength) || selected.length >= MAX_SENTENCES) break;
  }
  if (length < minLength) throw new Error('文を途中で切らずに出題できるあらすじがありません');
  return { synopsis: selected.join(''), excerpts: selected };
}

function validateWikipediaUrl(value, title) {
  let url;
  try { url = new URL(value); } catch { throw new Error('出典URLが不正です'); }
  if (url.protocol !== 'https:' || url.hostname !== 'ja.wikipedia.org' ||
      url.username || url.password || url.port || !url.pathname.startsWith('/wiki/') ||
      normalizedTitle(decodeURIComponent(url.pathname.slice('/wiki/'.length))) !== normalizedTitle(title) ||
      url.search || url.hash) {
    throw new Error('出典URLが登録済み作品と一致しません');
  }
  return url.href;
}

async function retrieveArticle(entry, fetchImpl) {
  titleAliases(entry);
  const url = new URL(WIKIPEDIA_API);
  url.search = new URLSearchParams({
    action: 'query', prop: 'extracts|info|revisions|categories|pageprops|redirects',
    explaintext: '1', exsectionformat: 'wiki', inprop: 'url', rvprop: 'ids',
    cllimit: 'max', rdlimit: 'max', rdnamespace: '0', rdshow: '!fragment',
    formatversion: '2', format: 'json', titles: entry.title,
  }).toString();
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetchImpl(url.href, {
      signal: AbortSignal.timeout(20000), redirect: 'error',
      headers: { 'User-Agent': 'TitleKakkoKariQuestionGenerator/1.0 (source-backed party-game questions)' },
    });
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Number(response.headers?.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : 5000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!response.ok) throw new Error(`出典を取得できませんでした (${response.status})`);
  const data = await response.json();
  const pages = data?.query?.pages;
  if (!Array.isArray(pages) || pages.length !== 1) throw new Error('作品記事を一意に確認できません');
  const page = pages[0];
  if (!Number.isSafeInteger(page.pageid) || page.pageid <= 0 || page.ns !== 0 ||
      Object.hasOwn(page, 'missing') || Object.hasOwn(page, 'redirect') ||
      Object.hasOwn(page.pageprops || {}, 'disambiguation') || typeof page.title !== 'string' ||
      normalizedTitle(page.title) !== normalizedTitle(entry.title)) {
    throw new Error('登録した作品の記事ではありません');
  }
  if (typeof page.extract !== 'string') throw new Error('作品本文がありません');
  if (!matchesWorkType(page, entry.kind)) {
    throw new Error('記事を登録した作品種別として確認できません');
  }
  const revisionId = page.revisions?.[0]?.revid;
  if (!Number.isSafeInteger(revisionId) || revisionId <= 0 ||
      (page.lastrevid !== undefined && page.lastrevid !== revisionId)) {
    throw new Error('取得した記事の版を確認できません');
  }
  return { ...page, revisionId, sourceUrl: validateWikipediaUrl(page.canonicalurl || page.fullurl, page.title) };
}

async function generateQuestion(entry, { fetchImpl = global.fetch, localAI = null,
  expectedAuthors = null, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('取得関数がありません');
  requirePlayableTitle(entry.title, entry.kind);
  const page = await retrieveArticle(entry, fetchImpl);
  if (expectedAuthors !== null && !authoredWorkMatches(page, expectedAuthors)) {
    throw new Error('紹介元の著作者とWikipediaの作品定義が一致しません');
  }
  const realTitle = requirePlayableTitle(entry.realTitle || stripDisambiguation(page.title), entry.kind);
  const aliases = [...new Set([...retrievedTitleAliases(entry, page), realTitle])];
  const plot = extractWorkContent(page, entry.kind, aliases);
  const sourceId = `wikipedia-ja-${page.pageid}-${page.revisionId}`;
  let generated;
  let generationMethod = 'extractive-v1';
  if (localAI) {
    generated = await localAI({ sourceId, text: plot.text, contentType: plot.contentType,
      minLength: MIN_LENGTH, maxLength: MAX_LENGTH });
    const sentences = plot.allowedSentences;
    if (!generated || typeof generated.synopsis !== 'string' || !Array.isArray(generated.excerpts) ||
        !generated.excerpts.length || generated.excerpts.some((excerpt) =>
          typeof excerpt !== 'string' || !sentences.includes(normalize(excerpt)))) {
      throw new Error('AIの出力に出典本文と一致する完全な文がありません');
    }
    const excerpts = generated.excerpts.map(normalize);
    const positions = excerpts.map((excerpt) => sentences.indexOf(excerpt));
    if (normalize(generated.synopsis) !== excerpts.join('') ||
        positions.some((position, index) => index && position <= positions[index - 1])) {
      throw new Error('AIのあらすじに原文の改変・追加または順序の変更があります');
    }
    // The model selects complete sentences; display never uses invented prose.
    // Extracted sentences still depend on the source's truth and surrounding context.
    generated = { synopsis: excerpts.join(''), excerpts };
    generationMethod = 'local-ai-v1';
  } else {
    generated = { synopsis: plot.synopsis, excerpts: plot.excerpts };
  }
  const synopsis = redactTitle(generated.synopsis, aliases);
  const usefulLength = synopsis.replace(/■■■/gu, '').length;
  if (synopsis.length < MIN_LENGTH || synopsis.length > MAX_LENGTH || usefulLength < MIN_LENGTH ||
      sourceSentences(generated.synopsis).length > MAX_SENTENCES ||
      !sourceSentences(generated.synopsis).every(introductionSentenceIsUsable) ||
      containsTitle(synopsis, aliases) || /https?:\/\/|\[\[|\]\]/iu.test(synopsis)) {
    throw new Error('題名を伏せた出題文の検査に合格しませんでした');
  }
  const retrievedAt = now().toISOString();
  const revisionUrl = new URL(page.sourceUrl);
  revisionUrl.searchParams.set('oldid', String(page.revisionId));
  return {
    id: entry.id,
    realTitle,
    aliases, kind: entry.kind, synopsis, contentType: plot.contentType,
    sources: [{
      label: `Wikipedia「${page.title}」${plot.section}`,
      url: revisionUrl.href, license: LICENSE, licenseUrl: LICENSE_URL,
      revisionId: page.revisionId, retrievedAt,
    }],
    generationMethod,
    evidence: {
      sourceId, section: plot.section,
      sourceTextSha256: createHash('sha256').update(plot.text).digest('hex'),
      excerpts: generated.excerpts.map(normalize),
    },
  };
}

async function generateBank(catalog, options = {}) {
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('作品カタログが空です');
  const questions = [];
  const rejected = [];
  const seen = new Set();
  for (const [index, entry] of catalog.entries()) {
    const delay = options.throttleMilliseconds ?? 1200;
    if (index && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (seen.has(entry.id)) throw new Error('作品IDが重複しています');
    seen.add(entry.id);
    try { questions.push(await generateQuestion(entry, options)); }
    catch (error) { rejected.push({ id: entry.id, title: entry.title, error: error.message }); }
  }
  return { questions, rejected };
}

module.exports = {
  generateQuestion, generateBank, retrieveArticle, extractPlotSection, summarizeExtractively,
  redactTitle, containsTitle, titleAliases, retrievedTitleAliases, matchesWorkType,
  validateWikipediaUrl, stripDisambiguation, sourceSentences, assertStandalonePlot, workDefinition,
  authoredWorkMatches, descriptionSections, descriptionSentences, extractDescription, extractWorkContent,
};

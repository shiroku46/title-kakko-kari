const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateQuestion, generateBank, extractPlotSection, summarizeExtractively,
  redactTitle, containsTitle, titleAliases, matchesWorkType, authoredWorkMatches, extractDescription,
} = require('../server/src/questions/generator');
const { createOllamaGenerator, validateOllamaUrl, parseArgs } = require('../server/scripts/generate-questions.cjs');

test('bundled real-source bank is usable by the gameplay loader', () => {
  const bank = require('../server/src/questions/bank.json');
  const { questionIsValid, prepareQuestion } = require('../server/src/questions/validation');
  assert.equal(bank.schemaVersion, 1);
  assert.ok(bank.questions.length >= 20, 'Bundled bank must support a 20-round CPU game');
  assert.equal(new Set(bank.questions.map((q) => q.id)).size, bank.questions.length);
  assert.equal(new Set(bank.questions.map((q) => q.realTitle)).size, bank.questions.length);
  for (const stored of bank.questions) {
    const question = prepareQuestion(stored);
    assert.ok(question && questionIsValid(question), `Gameplay rejects generated question ${question.id}`);
    const sourceTitle = decodeURIComponent(new URL(question.sources[0].url).pathname.slice('/wiki/'.length))
      .replace(/_/gu, ' ').normalize('NFKC');
    assert.ok(question.aliases.includes(sourceTitle), `Source is not registered for ${question.id}`);
  }
});

const entry = { id: 'novel-verified', title: '確認作品 (小説)', realTitle: '確認作品', kind: 'novel', aliases: ['ＡＢＣ物語'] };
const first = '海辺の町で暮らす若者は、長く連絡が途絶えていた友人から届いた手紙をきっかけに、見知らぬ港へ向かう。';
const second = 'そこで出会った老人から町に伝わる古い約束を聞いた若者は、残された仲間とともに手紙の差出人を探し始める。';
const third = '嵐によって帰り道を失いながらも、彼らは互いに助け合い、隠されていた家族の出来事を少しずつ知ることになる。';
const plot = `${first}${second}${third}`;
const musicDescription = '本作の旋律はゆったりとした歩みに合わせて進み、静かな伴奏と伸びやかな歌唱を組み合わせた構成になっている。' +
  '歌詞の主題は遠く離れた友人への思いであり、繰り返されるメロディによって再会を待つ時間の長さを表現している。' +
  '編曲では弦楽器とピアノの音色を重ね、場面ごとにリズムを変化させることで、希望と不安が交互に現れる特徴を持つ。';
const artDescription = '本作の画面には海辺で並んで座る二人の人物が描かれ、遠景の明るい空と手前の暗い地面が対照的な構図になっている。' +
  '色彩は青と白を中心に構成され、人物の視線と背後の広がりによって、出発を待つ時間の静けさを表現している。' +
  '画面の筆致には細かな重なりが見られ、光の移り変わりを扱うとともに、人と自然の距離を主題として描いている。';
const bookDescription = '本書は港町の暮らしと産業の変化を主題とし、住民への聞き取りと過去の記録を合わせて地域の歴史を分析している。' +
  '各章では土地の利用や家族の仕事がどのように変化したかを論じ、個々の事例と社会全体の仕組みを結び付けて解説する。' +
  '構成は地域の成立から現在の課題へと進み、異なる世代の経験を扱うことで、都市と海の関係について考察している。';
const poemDescription = 'この詩の主題は遠い故郷への思いであり、夕暮れの空と町の静けさを重ねることで、帰る場所を探す話者の情景を描いている。' +
  '詩行は一定の長さに近づくよう構成され、繰り返される音と韻によって、行き交う人々の歩みを表現している。' +
  '作品の後半では主題が個人の記憶から共同体へと広がり、抒情的な語りの形式を通して、人と土地の結び付きが示される。';

async function genreQuestion(kind, definition, body, options = {}) {
  const candidate = { id: `genre-${kind}`, title: '検証タイトル', kind, aliases: [] };
  const page = article({ title: candidate.title, canonicalurl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(candidate.title)}`,
    extract: `『検証タイトル』は、${definition}。\n${body}` });
  return generateQuestion(candidate, { fetchImpl: async () => Response.json({ query: { pages: [page] } }), ...options });
}
function article(overrides = {}) {
  return {
    pageid: 123, ns: 0, title: entry.title, lastrevid: 456, revisions: [{ revid: 456 }],
    canonicalurl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(entry.title)}`,
    extract: `『確認作品』は日本の小説である。\n\n== あらすじ ==\n${plot}\n\n== 評価 ==\n作品の受賞歴。`,
    ...overrides,
  };
}
function sourceFetch(page = article()) {
  return async (url) => {
    const query = new URL(url);
    assert.equal(query.hostname, 'ja.wikipedia.org');
    assert.equal(query.searchParams.get('titles'), entry.title);
    assert.equal(query.searchParams.has('redirects'), false);
    assert.equal(query.searchParams.get('prop').split('|').includes('redirects'), true);
    assert.equal(query.searchParams.get('rdnamespace'), '0');
    assert.equal(query.searchParams.get('rdlimit'), 'max');
    assert.equal(query.searchParams.get('explaintext'), '1');
    return Response.json({ query: { pages: [page] } });
  };
}

test('uses a real plot section, not article introduction or neighboring metadata', () => {
  assert.deepEqual(extractPlotSection(article().extract), { section: 'あらすじ', text: plot });
  assert.equal(extractPlotSection(`概説\n== ストーリー ==\n${first}\n=== 第一章 ===\n${second}${third}\n== 登場人物 ==\n人物一覧`).text, `${first} ${second}${third}`);
  assert.throws(() => extractPlotSection(`小説の解説。${plot}`), /あらすじ・ストーリー節/);
  assert.throws(() => extractPlotSection('== あらすじ ==\n短い説明。'), /十分な長さ/);
});

test('rejects adaptation comparisons and production notes rather than calling them a plot', async () => {
  const liveComparison = 'おおまかなあらすじは映画と同じだが、最後の母との再会の場面は原作にはなく、連絡を絶っていた母・豊子と再会する直前で終わる。' +
    'その時、照恵は、介護する豊子の尻をたたいて、「死ぬまでにおぼえてよ、ひとの愛しかたを」と叫ぶ自分自身を想像する。' +
    'プロデューサーの木村典代は、映画版の結末を原作の下田に4時間説得して受け入れさせた。';
  for (const comparison of [liveComparison, `原作との違いを以下に記す。${plot}`,
    `詳しいあらすじは映画版の項目を参照されたい。${plot}`,
    `プロデューサーは原作者と映画化の許諾を巡って交渉し、長い説得によって脚本変更を受け入れてもらった。${plot}`]) {
    await assert.rejects(generateQuestion(entry, { fetchImpl: sourceFetch(article({
      extract: `『確認作品』は日本の小説。\n== あらすじ ==\n${comparison}`,
    })) }), /独立した筋書き|作品自身の内容/);
  }
  const filmmakerStory = `若い映画監督は作品を完成させるため仲間を探す。${plot}`;
  assert.equal(extractPlotSection(`== あらすじ ==\n${filmmakerStory}`).text, filmmakerStory);
});

test('extractive generation uses complete source sentences with title aliases masked', async () => {
  const question = await generateQuestion(entry, { fetchImpl: sourceFetch(), now: () => new Date('2026-10-01T00:00:00Z') });
  assert.equal(question.realTitle, '確認作品');
  assert.equal(question.kind, 'novel');
  assert.equal(question.synopsis, plot);
  assert.equal(question.generationMethod, 'extractive-v1');
  assert.equal(question.contentType, 'synopsis');
  assert.equal(question.sources[0].revisionId, 456);
  assert.equal(new URL(question.sources[0].url).searchParams.get('oldid'), '456');
  assert.equal(question.sources[0].retrievedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(question.sources[0].license, 'CC BY-SA 4.0');
  assert.match(question.evidence.sourceTextSha256, /^[a-f0-9]{64}$/);
  assert.equal(question.evidence.excerpts.join(''), plot);
  assert.equal(summarizeExtractively(`${plot}${plot}${plot}`).synopsis.length <= 450, true);
  assert.throws(() => summarizeExtractively('途中で切れない長い文'.repeat(80)), /途中で切らず/);
  const dialogue = '老人は「遠くへ行くのだ。友人を探すのだ」と語った。';
  const quoted = summarizeExtractively(`${first}${second}${dialogue}${third}`, { maxLength: 200 });
  assert.equal((quoted.synopsis.match(/「/gu) || []).length, (quoted.synopsis.match(/」/gu) || []).length);
});

test('normalizes canonical titles, disambiguation suffixes, fullwidth spelling and spaces', () => {
  const aliases = titleAliases(entry);
  const masked = redactTitle('確認作品 (小説)、確認作品、ＡＢＣ物語、A B C 物語が登場する。', aliases);
  assert.equal(masked, '■■■、■■■、■■■、■■■が登場する。');
  assert.equal(containsTitle(masked, aliases), false);
  assert.equal(containsTitle('abc物語', aliases), true);
  assert.equal(redactTitle('確認\u200b作品とＡ\u202eＢＣ物語', aliases), '■■■と■■■');
  assert.equal(containsTitle('確認\u200b作品', aliases), true);
  assert.throws(() => titleAliases({ ...entry, realTitle: '捏造作品' }), /一致しません/);
});

test('discovers and masks verified redirect aliases without a manual title list', async () => {
  const automaticEntry = { ...entry, aliases: [] };
  const source = `${plot}短題とＦＲＥＥ　ＳＴＯＲＹは、町に昔から伝わる呼び名だった。`;
  const question = await generateQuestion(automaticEntry, { fetchImpl: sourceFetch(article({
    redirects: [
      { pageid: 901, ns: 0, title: '短題 (文学)' },
      { pageid: 902, ns: 0, title: 'Free Story' },
      { pageid: 903, ns: 0, title: '他の作品の人物', fragment: '登場人物' },
      { pageid: 904, ns: 14, title: 'Category:関係のない題名' },
    ],
    extract: `『確認作品』は日本の小説。\n== あらすじ ==\n${source}`,
  })) });
  assert.equal(question.aliases.includes('短題 (文学)'), true);
  assert.equal(question.aliases.includes('短題'), true);
  assert.equal(question.aliases.includes('Free Story'), true);
  assert.equal(question.aliases.includes('他の作品の人物'), false);
  assert.equal(question.aliases.includes('Category:関係のない題名'), false);
  assert.equal(question.synopsis.includes('短題'), false);
  assert.equal(containsTitle(question.synopsis, question.aliases), false);
  assert.match(question.synopsis, /■■■と■■■は/u);
  assert.equal(question.realTitle, '確認作品');
  assert.equal(new URL(question.sources[0].url).searchParams.get('oldid'), '456');
  assert.equal(question.evidence.excerpts.join(''), source.normalize('NFKC'));
});

test('masks readings and original names from the verified lead subject without harvesting other annotations', async () => {
  for (const [title, kind, definition, sourceText, expected] of [
    ['Lemon', 'song', '「Lemon」(レモン)は、日本の歌手による楽曲。',
      `${musicDescription}タイトルや歌詞に用いられた「レモン」は、曲の主題と結び付いている。`, ['レモン']],
    ['ゲルニカ', 'artwork', '『ゲルニカ』(スペイン語: Guernica [ɡeɾˈnika])は、パブロ・ピカソによる絵画。',
      `${artDescription}原語名のGuernica [ɡeɾˈnika]も、この作品の主題と結び付いている。`, ['Guernica', 'ɡeɾˈnika']],
    ['鋼の錬金術師', 'manga', '『鋼の錬金術師』(はがねのれんきんじゅつし、英題: FULLMETAL ALCHEMIST)は、日本の漫画作品。',
      `${plot}FULLMETAL ALCHEMISTという呼び名が町に伝わっている。`, ['はがねのれんきんじゅつし', 'FULLMETAL ALCHEMIST']],
    ['ファイナルファンタジーVII', 'game', '『ファイナルファンタジーVII』(ファイナルファンタジーセブン、FINAL FANTASY VII、略称: FFVII、FF7)は、スクウェアが発売したコンピュータRPG。',
      `${plot}FFVIIとFF7、FINAL FANTASY VIIという呼び名が町に伝わっている。`,
      ['ファイナルファンタジーセブン', 'FINAL FANTASY VII', 'FFVII', 'FF7']],
  ]) {
    const candidate = { id: `reading-${kind}`, title, kind, aliases: [] };
    const page = article({ title, canonicalurl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      extract: `${definition}\n== ${['game', 'manga'].includes(kind) ? 'ストーリー' : '解説'} ==\n${sourceText}` });
    const question = await generateQuestion(candidate, { fetchImpl: async () => Response.json({ query: { pages: [page] } }) });
    for (const alias of expected) {
      assert.ok(question.aliases.includes(alias), `${title}: ${alias}`);
      assert.equal(containsTitle(question.synopsis, [alias]), false);
    }
    assert.ok(question.synopsis.length <= 280);
    for (const excerpt of question.evidence.excerpts) assert.ok(sourceText.includes(excerpt));
    assert.equal(question.sources[0].revisionId, 456);
  }
  const extra = await generateQuestion(entry, { fetchImpl: sourceFetch(article({
    extract: `『確認作品』(かくにんさくひん、2001年、日本)は、甲乙(英: Other Creator)による小説。\n== あらすじ ==\n${plot}`,
  })) });
  assert.ok(extra.aliases.includes('かくにんさくひん'));
  for (const invalid of ['日本', '2001年', 'Other Creator']) assert.equal(extra.aliases.includes(invalid), false);
});

test('requires a definition of the named work and never accepts a category alone', async () => {
  const collection = article({ extract: `『確認作品』は日本の短編小説集である。\n== あらすじ ==\n${plot}` });
  assert.equal((await generateQuestion(entry, { fetchImpl: sourceFetch(collection) })).kind, 'novel');
  const categorized = article({
    extract: `『確認作品』は架空の出来事を描いた刊行物。\n== あらすじ ==\n${plot}`,
    categories: [{ ns: 14, title: 'Category:日本の小説' }, { ns: 14, title: 'Category:2026年の刊行物' }],
  });
  await assert.rejects(generateQuestion(entry, { fetchImpl: sourceFetch(categorized) }), /作品種別/);
  assert.equal(matchesWorkType(article({ extract: '『確認作品』は、小説家の山田太郎による長編小説。' }), 'novel'), true);
  assert.equal(matchesWorkType(article({ extract: '『確認作品』は、架空の世界を舞台とした日本の小説である。' }), 'novel'), true);
  assert.equal(matchesWorkType(article({ extract: '『確認作品』は、2004年に出版された短編小説集。', categories: [] }), 'novel'), true);
});

test('accepts actual animation, documentary, nested readings and decorated source titles', () => {
  for (const definition of [
    '『確認作品』(かくにんさくひん、英: Verified Work)は、2001年に公開された日本のアニメーション映画。',
    '「確認作品」は、1998年に公開されたドキュメンタリー映画である。',
    '確認作品 (かくにん(別名)) は、映画制作会社によって2007年に公開された日本の映画。',
  ]) assert.equal(matchesWorkType(article({ extract: definition }), 'film'), true, definition);
  assert.equal(matchesWorkType(article({ extract: '『確認作品♥』(かくにんさくひん)は、日本の長編小説である。' }), 'novel'), true);
  assert.equal(matchesWorkType(article({ extract: '『他作品』は、日本の小説である。' }), 'novel'), false);
  assert.equal(matchesWorkType(article({ extract: '『確認作品』は、日本の映画である。' }), 'novel'), false);
  assert.equal(matchesWorkType(article({ extract: '『確認作品』は、日本の小説である。' }), 'film'), false);
});

for (const [kind, definition, description] of [
  ['novel', '甲乙による長編小説', null],
  ['short-story', '甲乙による短編小説', null],
  ['literary-work', '甲乙による文学作品', null],
  ['film', '2020年に公開された日本の映画', null],
  ['manga', '甲乙による日本の漫画シリーズ', null],
  ['anime', '2020年に放送されたテレビアニメシリーズ', null],
  ['game', '2020年に発売されたロールプレイングゲーム', null],
  ['play', '甲乙による戯曲', null],
  ['drama', '2020年に放送されたテレビドラマ', null],
  ['song', '日本の歌手、甲乙の楽曲', musicDescription],
  ['album', '日本のバンド、甲乙のスタジオアルバム', musicDescription],
  ['music-work', '作曲家、甲乙による交響曲', musicDescription],
  ['poem', '詩人、甲乙による詩作品', poemDescription],
  ['artwork', '画家、甲乙による絵画作品', artDescription],
  ['nonfiction', '甲乙によるノンフィクション書籍', bookDescription],
  ['other-work', '2020年に放送されたテレビ番組', bookDescription],
]) {
  test(`${kind} uses verified ${description ? 'description' : 'plot'} sentences and genre-appropriate labeling`, async () => {
    const sourceText = description || plot;
    const body = `== ${description ? '解説' : 'あらすじ'} ==\n${sourceText}`;
    const question = await genreQuestion(kind, definition, body);
    assert.equal(question.kind, kind);
    assert.equal(question.contentType, description ? 'description' : 'synopsis');
    assert.equal(question.evidence.section, description ? '解説' : 'あらすじ');
    assert.equal(question.synopsis, sourceText);
    assert.ok(question.synopsis.length <= 280);
    for (const excerpt of question.evidence.excerpts) assert.ok(sourceText.includes(excerpt));
    assert.equal(new URL(question.sources[0].url).searchParams.get('oldid'), '456');
  });
}

test('falls back to a labeled work description instead of inventing a missing plot', async () => {
  const question = await genreQuestion('manga', '甲乙による漫画作品', `== 概要 ==\n${artDescription}`);
  assert.equal(question.contentType, 'description');
  assert.equal(question.evidence.section, '概要');
  assert.equal(question.synopsis, artDescription);
  const intro = await genreQuestion('song', '甲乙の楽曲', musicDescription);
  assert.equal(intro.contentType, 'description');
  assert.equal(intro.evidence.section, '冒頭紹介');
  assert.equal(intro.synopsis, musicDescription);
});

test('accepts an actual released computer RPG definition while rejecting the general genre', async () => {
  const intro = '『ファイナルファンタジーVII』(ファイナルファンタジーセブン、FINAL FANTASY VII、略称: FFVII、FF7)は、スクウェア(現スクウェア・エニックス)が発売したコンピュータRPG。';
  assert.equal(matchesWorkType({ title: 'ファイナルファンタジーVII', extract: intro }, 'game'), true);
  assert.equal(matchesWorkType({ title: 'コンピュータRPG', extract: 'コンピュータRPGは、コンピュータゲームである。' }, 'game'), false);
  assert.equal(matchesWorkType({ title: '検証タイトル', extract: '『検証タイトル』は、コンピュータRPGのジャンルである。' }, 'game'), false);
  const question = await genreQuestion('game', '2020年に発売されたコンピュータRPG', `== あらすじ ==\n${plot}`);
  assert.equal(question.contentType, 'synopsis');
  assert.equal(question.synopsis, plot);
});

test('does not use lyrics, poem full text, track lists, indexes or forbidden child headings', async () => {
  for (const [parent, child] of [
    ['歌詞', '内容'], ['全文', '解説'], ['収録曲', '概要'], ['目次', '作品紹介'],
  ]) {
    await assert.rejects(genreQuestion('song', '甲乙の楽曲', `== ${parent} ==\n=== ${child} ===\n${musicDescription}`), /十分な紹介文/);
  }
  await assert.rejects(genreQuestion('poem', '甲乙の詩作品', `== 本文 ==\n${poemDescription}`), /十分な紹介文/);
  assert.throws(() => extractDescription(`== 内容紹介 ==\n「${musicDescription}」。`, ['検証タイトル'], 'song'), /十分な紹介文/);
  const lyrics = '私は物語の舞台を歩き、君に会いたい気持ちを夜の空へ描いていた。'.repeat(5);
  await assert.rejects(genreQuestion('song', '甲乙の楽曲', `== 解説 ==\n${lyrics}`), /十分な紹介文/);
});

test('plot extraction excludes lyrics and full text subtrees while retaining narrative siblings', async () => {
  for (const [parent, child] of [['あらすじ', '歌詞'], ['ストーリー', '全文'], ['歌詞', 'あらすじ']]) {
    await assert.rejects(genreQuestion('film', '公開された映画', `== ${parent} ==\n=== ${child} ===\n${plot}`), /十分な紹介文/);
  }
  const text = `== あらすじ ==\n${first}\n=== 歌詞 ===\n${musicDescription}\n==== 内容 ====\n${artDescription}\n=== 結末 ===\n${second}${third}`;
  assert.equal(extractPlotSection(text).text, `${first} ${second}${third}`);
});

test('rejects metadata-only descriptions and descriptions of another titled work', async () => {
  const metadata = '2020年3月3日に出版社から発売され、初版は一万部印刷されて全国の書店へ配送された。'.repeat(4);
  await assert.rejects(genreQuestion('album', '甲乙のアルバム', `== 概要 ==\n${metadata}`), /十分な紹介文/);
  const neighbor = `『別の作品』は、${musicDescription.replaceAll('。', '。\n『別の作品』は、')}`;
  await assert.rejects(genreQuestion('song', '甲乙の楽曲', `== 解説 ==\n${neighbor}`), /十分な紹介文/);
});

test('author validation binds creator names and a creation relation to the article definition', async () => {
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、宮部みゆきの長編推理小説である。' }), ['宮部みゆき']), true);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、成田空子・著、CHIRAN・画の小説である。' }), ['成田空子']), true);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、Mr.Childrenの楽曲である。' }), ['mrchildren']), true);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、神代辰巳監督の日本の映画である。' }), ['神代辰巳']), true);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、別の作者による小説である。宮部みゆきはこの作品を紹介した。' }), ['宮部みゆき']), false);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、宮部みゆきの生涯を描いた小説である。' }), ['宮部みゆき']), false);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、『宮部みゆき』を題材にした小説である。' }), ['宮部みゆき']), false);
  const body = `== あらすじ ==\n${plot}`;
  const good = await genreQuestion('novel', '宮部みゆきの小説', body, { expectedAuthors: ['宮部みゆき'] });
  assert.equal(good.kind, 'novel');
  await assert.rejects(genreQuestion('novel', '別人の小説', body, { expectedAuthors: ['宮部みゆき'] }), /著作者/);
  await assert.rejects(genreQuestion('novel', '宮部みゆきの小説', body, { expectedAuthors: [] }), /著作者/);
});

test('author evidence accepts real ordinal music credits and excludes an adaptation source author', () => {
  assert.equal(authoredWorkMatches({ title: 'あぁ', extract: '「あぁ」は、2011年6月29日に発売されたSuperflyの13作目のシングル。' }, ['superfly']), true);
  assert.equal(authoredWorkMatches({ title: '嗚呼', extract: '『嗚呼』(ああ)は、森山直太朗9枚目のフル・アルバム。' }, ['森山直太朗']), true);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、Other Artistの13thシングル。' }), ['Other Artist']), true);
  const adaptation = article({ extract: '『確認作品』は、甲乙による同名の小説を原作とする丙丁監督の映画である。' });
  assert.equal(matchesWorkType(adaptation, 'film'), true);
  assert.equal(authoredWorkMatches(adaptation, ['甲乙']), false);
  assert.equal(authoredWorkMatches(adaptation, ['丙丁']), true);
  const remake = article({ extract: '『確認作品』は、甲乙監督の映画を原作とした丙丁監督による映画である。' });
  assert.equal(authoredWorkMatches(remake, ['甲乙']), false);
  assert.equal(authoredWorkMatches(remake, ['丙丁']), true);
  assert.equal(authoredWorkMatches(article({ extract: '『確認作品』は、Superflyの生涯を題材とする別人の楽曲。' }), ['superfly']), false);
});

test('all accepted work families reject fictional works but allow fictional settings', () => {
  for (const [kind, type] of [
    ['novel', '小説'], ['short-story', '短編小説'], ['literary-work', '文学作品'], ['film', '映画'],
    ['manga', '漫画シリーズ'], ['anime', 'テレビアニメ'], ['game', 'アクションゲーム'], ['play', '戯曲'],
    ['drama', 'テレビドラマ'], ['song', '楽曲'], ['album', 'アルバム'], ['music-work', '交響曲'],
    ['poem', '詩作品'], ['artwork', '絵画作品'], ['nonfiction', '書籍'], ['other-work', 'テレビ番組'],
  ]) {
    for (const definition of [`架空の${type}である`, `別の作品に登場する${type}である`]) {
      assert.equal(matchesWorkType(article({ extract: `『確認作品』は、${definition}。` }), kind), false, `${kind}: ${definition}`);
      assert.equal(matchesWorkType(article({ extract: `『確認作品』は、${definition}。` }), 'other-work'), false, `other-work: ${definition}`);
    }
    assert.equal(matchesWorkType(article({ extract: `『確認作品』は、架空の世界を題材とする${type}である。` }), kind), true, kind);
  }
});

test('new kinds still reject performers, institutions, concepts and fictional/planned works', () => {
  for (const predicate of ['日本の歌手である', '日本のバンドである', '日本の作曲家である', '音楽のジャンルである',
    '日本のレコードレーベルである', '日本の漫画家である', '日本の美術館である', '日本の映画制作会社である',
    '2030年公開予定のアニメ作品である', '2028年に発売する予定のアルバムである',
    '別の映画に登場する架空のビデオゲームである']) {
    const page = article({ extract: `『確認作品』は、${predicate}。` });
    for (const kind of ['song', 'album', 'music-work', 'manga', 'anime', 'artwork', 'other-work', 'game']) {
      assert.equal(matchesWorkType(page, kind), false, `${kind}: ${predicate}`);
    }
  }
});

test('rejects explicit non-works even with a misleading work category', () => {
  const falseCategories = [{ ns: 14, title: 'Category:日本の小説' }, { ns: 14, title: 'Category:日本の映画' }];
  for (const predicate of [
    '日本の島である', '日本の小説家である', '小説家・俳人、教育者', '日本の映画制作会社である',
    '日本の出版社である', '日本の映画館である', '毎年開催される映画祭である',
    '日本の小説の一覧である', '文学の形式の一つである', '映画のジャンルである',
    '小説が多数所蔵されている図書館である', '日本の人物であり、日本の小説',
    '日本の島であり、日本の映画作品',
  ]) {
    const page = article({ extract: `確認作品は、${predicate}。`, categories: falseCategories });
    assert.equal(matchesWorkType(page, 'novel'), false, predicate);
    assert.equal(matchesWorkType(page, 'film'), false, predicate);
  }
});

test('rejects another work mention, future releases and fictional in-universe works', () => {
  for (const predicate of [
    '『日本の小説。』の舞台となった島である。',
    '「長編小説。」で知られる日本の人物である。',
    '別の人物が書いた『長編小説。』に登場する場所である。',
    '2028年に刊行される予定の小説である。',
    '2030年公開予定の日本の映画である。',
    'まだ構想段階の映画作品である。',
    '別の映画に登場する架空の小説である。',
    '架空の作品であり、日本の小説。',
    'ある小説に登場する映画である。',
  ]) {
    const page = article({ extract: `『確認作品』は、${predicate}`, categories: [{ ns: 14, title: 'Category:日本の小説' }] });
    assert.equal(matchesWorkType(page, 'novel'), false, predicate);
    assert.equal(matchesWorkType(page, 'film'), false, predicate);
  }
});

for (const [name, overrides] of [
  ['different article', { title: '別の作品' }],
  ['redirect', { redirect: true }],
  ['missing article', { missing: true }],
  ['disambiguation', { pageprops: { disambiguation: '' } }],
  ['non-work article', { extract: `島についての記事。\n== ストーリー ==\n${plot}` }],
  ['novelist rather than novel', { extract: `日本の小説家についての記事。\n== ストーリー ==\n${plot}` }],
  ['work mentions after the definition', { extract: `日本の島である。後に日本の小説。\n== ストーリー ==\n${plot}` }],
  ['work used as location', { extract: `日本の島は小説で描かれた場所である。\n== ストーリー ==\n${plot}` }],
  ['related person category', { extract: `日本の人物。\n== ストーリー ==\n${plot}`, categories: [{ ns: 14, title: 'Category:日本の小説家' }] }],
  ['work-topic category', { extract: `日本の島。\n== ストーリー ==\n${plot}`, categories: [{ ns: 14, title: 'Category:小説を題材とした作品' }] }],
  ['nested topic category', { extract: `日本の人物。\n== ストーリー ==\n${plot}`, categories: [{ ns: 14, title: 'Category:日本の小説/登場人物' }] }],
  ['category supplied in article namespace', { extract: `日本の島。\n== ストーリー ==\n${plot}`, categories: [{ ns: 0, title: 'Category:日本の小説' }] }],
  ['wrong revision', { lastrevid: 457 }],
  ['no revision', { revisions: [] }],
  ['external source', { canonicalurl: 'https://attacker.example/wiki/確認作品_(小説)' }],
  ['different source page', { canonicalurl: 'https://ja.wikipedia.org/wiki/別作品' }],
  ['HTTP source', { canonicalurl: `http://ja.wikipedia.org/wiki/${encodeURIComponent(entry.title)}` }],
  ['missing plot', { extract: `『確認作品』は小説。\n== 評価 ==\n${plot}` }],
]) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(generateQuestion(entry, { fetchImpl: sourceFetch(article(overrides)) }));
  });
}

test('rejects failed upstream requests and a title-only synopsis', async () => {
  await assert.rejects(generateQuestion(entry, { fetchImpl: async () => new Response('', { status: 503 }) }), /取得できません/);
  await assert.rejects(generateQuestion(entry, { fetchImpl: sourceFetch(article({
    extract: `『確認作品』は日本の小説。\n== あらすじ ==\n${'確認作品'.repeat(40)}。`,
  })) }), /検査に合格/);
});

test('local AI retains deterministic source metadata and must supply exact source evidence', async () => {
  const question = await generateQuestion(entry, {
    fetchImpl: sourceFetch(),
    localAI: async ({ sourceId, text }) => {
      assert.equal(sourceId, 'wikipedia-ja-123-456');
      assert.equal(text, plot);
      return { synopsis: plot, excerpts: [first, second, third] };
    },
  });
  assert.equal(question.generationMethod, 'local-ai-v1');
  assert.equal(question.realTitle, '確認作品');
  assert.equal(question.synopsis, plot);
  await assert.rejects(generateQuestion(entry, {
    fetchImpl: sourceFetch(), localAI: async () => ({ synopsis: plot, excerpts: ['資料には存在しない設定と出来事です。'] }),
  }), /出典本文と一致/);
  await assert.rejects(generateQuestion(entry, {
    fetchImpl: sourceFetch(), localAI: async () => ({ synopsis: '火星に住む宇宙人の発明で地球が消えた。'.repeat(8), excerpts: [first, second, third] }),
  }), /原文の改変・追加/);
  await assert.rejects(generateQuestion(entry, {
    fetchImpl: sourceFetch(), localAI: async () => ({ synopsis: plot, excerpts: [first.slice(3), second, third] }),
  }), /完全な文/);
  await assert.rejects(generateQuestion(entry, {
    fetchImpl: sourceFetch(), localAI: async () => ({ synopsis: `${third}${second}${first}`, excerpts: [third, second, first] }),
  }), /順序の変更/);
});

test('Ollama is loopback only, uses structured output, and never downloads models', async () => {
  let calls = 0;
  const ai = createOllamaGenerator('installed-japanese-model', 'http://127.0.0.1:11434', async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'installed-japanese-model');
    assert.equal(payload.stream, false);
    assert.equal(payload.format.type, 'object');
    assert.match(payload.prompt, /資料にない人物・設定・出来事を補ってはいけません/);
    return Response.json({ response: JSON.stringify({ synopsis: plot, excerpts: [first] }) });
  });
  assert.deepEqual(await ai({ text: plot, sourceId: 'source', minLength: 120, maxLength: 450 }), { synopsis: plot, excerpts: [first] });
  assert.equal(calls, 1);
  for (const url of ['https://api.paid.example', 'http://remote.example:11434', 'http://127.0.0.1.attacker.example', 'http://user:pass@localhost:11434']) {
    assert.throws(() => validateOllamaUrl(url), /ローカルループバック/);
  }
  assert.equal(parseArgs([]).model, null);
  assert.throws(() => parseArgs(['--minimum', '0']), /1以上/);
});

test('structured local AI selects only complete ordered introduction sentences for music', async () => {
  const excerpts = musicDescription.match(/[^。]+。/gu);
  const ai = createOllamaGenerator('installed-model', 'http://localhost:11434', async (url, options) => {
    assert.equal(url, 'http://localhost:11434/api/generate');
    const payload = JSON.parse(options.body);
    assert.match(payload.prompt, /作品紹介文/u);
    assert.match(payload.prompt, /筋書きを作ったり、歌詞・詩の全文・収録曲一覧・目次を選んだりしてはいけません/u);
    assert.doesNotMatch(payload.prompt, /筋書きが分かる文/u);
    return Response.json({ response: JSON.stringify({ synopsis: musicDescription, excerpts }) });
  });
  const question = await genreQuestion('song', '甲乙の楽曲', `== 解説 ==\n${musicDescription}`, { localAI: ai });
  assert.equal(question.contentType, 'description');
  assert.equal(question.generationMethod, 'local-ai-v1');
  assert.equal(question.synopsis, musicDescription);
  assert.deepEqual(question.evidence.excerpts, excerpts);
  await assert.rejects(genreQuestion('song', '甲乙の楽曲', `== 解説 ==\n${musicDescription}`, {
    localAI: async () => ({ synopsis: '宇宙人が地球を救う。'.repeat(20), excerpts }),
  }), /原文の改変・追加/u);
  await assert.rejects(genreQuestion('song', '甲乙の楽曲', `== 解説 ==\n${musicDescription}`, {
    localAI: async () => ({ synopsis: [...excerpts].reverse().join(''), excerpts: [...excerpts].reverse() }),
  }), /順序の変更/u);
});

test('bank generation excludes invalid questions and rejects duplicate IDs', async () => {
  const missingEntry = { ...entry, id: 'novel-missing', title: '未取得作品' };
  const fetchImpl = async (url) => {
    if (new URL(url).searchParams.get('titles') === entry.title) return Response.json({ query: { pages: [article()] } });
    return new Response('', { status: 404 });
  };
  const result = await generateBank([entry, missingEntry], { fetchImpl, throttleMilliseconds: 0 });
  assert.equal(result.questions.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].id, missingEntry.id);
  await assert.rejects(generateBank([entry, entry], { fetchImpl, throttleMilliseconds: 0 }), /重複/);
});

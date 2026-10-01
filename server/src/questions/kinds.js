// Discovery configuration describes genres, never a fixed list of work titles.
// A discovered article must still pass the generator's independent work checks.
const WORK_KINDS = Object.freeze({
  novel: {
    label: '小説', contentMode: 'story',
    roots: ['Category:日本の小説', 'Category:小説'],
    searchQueries: ['小説 あらすじ', '小説 物語'],
  },
  'short-story': {
    label: '短編小説', contentMode: 'story',
    roots: ['Category:短編小説', 'Category:日本の短編小説'],
    searchQueries: ['短編小説 あらすじ', '短編小説 作品'],
  },
  'literary-work': {
    label: '文学作品', contentMode: 'story',
    roots: ['Category:文学作品', 'Category:児童文学'],
    searchQueries: ['文学作品 物語', '児童文学 あらすじ'],
  },
  film: {
    label: '映画', contentMode: 'story',
    roots: ['Category:日本のドラマ映画', 'Category:映画作品'],
    searchQueries: ['映画 あらすじ', '映画 ストーリー'],
  },
  manga: {
    label: '漫画', contentMode: 'story',
    roots: ['Category:日本の漫画作品', 'Category:漫画作品'],
    searchQueries: ['漫画 あらすじ', '漫画作品 ストーリー'],
  },
  anime: {
    label: 'アニメ', contentMode: 'story',
    roots: ['Category:日本のアニメ作品', 'Category:アニメ作品'],
    searchQueries: ['アニメ あらすじ', 'アニメ作品 ストーリー'],
  },
  game: {
    label: 'ゲーム', contentMode: 'story',
    roots: ['Category:コンピュータゲーム作品', 'Category:コンピュータゲーム'],
    searchQueries: ['ゲーム作品 ストーリー', 'コンピュータゲーム 概要'],
  },
  play: {
    label: '戯曲・舞台', contentMode: 'story',
    roots: ['Category:戯曲', 'Category:日本の戯曲'],
    searchQueries: ['戯曲 あらすじ', '舞台作品 ストーリー'],
  },
  drama: {
    label: 'ドラマ', contentMode: 'story',
    roots: ['Category:日本のテレビドラマ', 'Category:テレビドラマ'],
    searchQueries: ['テレビドラマ あらすじ', 'ラジオドラマ 作品'],
  },
  song: {
    label: '楽曲・歌曲', contentMode: 'description',
    roots: ['Category:日本の楽曲', 'Category:楽曲'],
    searchQueries: ['楽曲 シングル', '歌曲 作品'],
  },
  album: {
    label: 'アルバム', contentMode: 'description',
    roots: ['Category:日本のアルバム', 'Category:アルバム'],
    searchQueries: ['アルバム 収録曲', 'アルバム 作品'],
  },
  'music-work': {
    label: '音楽作品', contentMode: 'description',
    roots: ['Category:音楽作品', 'Category:器楽曲'],
    searchQueries: ['交響曲 作品', '協奏曲 作品'],
  },
  poem: {
    label: '詩', contentMode: 'description',
    roots: ['Category:詩', 'Category:日本の詩'],
    searchQueries: ['詩 作品', '詩集 作品'],
  },
  artwork: {
    label: '美術作品', contentMode: 'description',
    roots: ['Category:美術作品', 'Category:絵画'],
    searchQueries: ['絵画 作品', '彫刻 作品'],
  },
  nonfiction: {
    label: 'ノンフィクション・書籍', contentMode: 'description',
    roots: ['Category:ノンフィクション', 'Category:書籍'],
    searchQueries: ['ノンフィクション 書籍', '随筆 書籍'],
  },
  'other-work': {
    label: 'その他の作品', contentMode: 'description',
    roots: ['Category:作品', 'Category:創作物'],
    searchQueries: ['作品 発表', '創作物 作品'],
  },
});

const KIND_IDS = Object.freeze(Object.keys(WORK_KINDS));
for (const definition of Object.values(WORK_KINDS)) {
  Object.freeze(definition.roots);
  Object.freeze(definition.searchQueries);
  Object.freeze(definition);
}

function getKind(kind) {
  return Object.hasOwn(WORK_KINDS, kind) ? WORK_KINDS[kind] : null;
}

function getDefaultRoots() {
  return KIND_IDS.flatMap((kind) => WORK_KINDS[kind].roots.map((category) => ({ category, kind })));
}

module.exports = { WORK_KINDS, KIND_IDS, getKind, getDefaultRoots };

const { shuffle } = require('./utils/shuffle');

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const genericWords = new Set(['作品', '物語', '主人公', 'あらすじ', '紹介', '舞台', '彼女', '彼ら', '自身', '人々', '一人', '二人']);

// shortcut: local word-and-phrase generation; use a language model only if richer title writing is required.
function generateComputerTitles(synopsis, count) {
  if (!count) return [];
  const words = [...new Set([...segmenter.segment(synopsis)]
    .map(({ segment }) => segment)
    .filter((word) => /^(?:[\p{Script=Han}]{2,10}|[\p{Script=Katakana}ー]{2,15}|[月星海空夢夜雨花島町旅恋])$/u.test(word) && !genericWords.has(word)))].slice(0, 12);
  const keywords = words.length ? words : ['物語'];
  const candidates = keywords.flatMap((word, index) => {
    const other = keywords[(index + 1) % keywords.length];
    return [
      ...(word !== other ? [`${word}の${other}`, `${word}と${other}`] : []),
      `${word}の向こう側`, `${word}が消えた日`, `${word}を探して`,
      `最後の${word}`, `${word}の記憶`,
    ];
  });
  return shuffle([...new Set(candidates)]).slice(0, count);
}

module.exports = { generateComputerTitles };

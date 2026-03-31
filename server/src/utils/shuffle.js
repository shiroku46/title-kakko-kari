/**
 * Fisher-Yates アルゴリズムによる配列シャッフル
 * 元の配列を変更せず、シャッフルされた新しい配列を返す
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { shuffle };

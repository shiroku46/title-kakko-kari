// Shared by source extraction and the saved-question loader. Keep the rules
// independent of any particular publisher, shop, title or year of publication.
const MIN_LENGTH = 120;
const MAX_LENGTH = 280;
const TARGET_LENGTH = 200;
const MAX_SENTENCES = 12;
const EXCLUDED_SECTION = /著者紹介|著者略歴|プロフィール|レビュー|口コミ|感想|評価|受賞|ランキング|おすすめ|関連作品|関連商品|購入|通販|販売情報|商品情報|書誌|出版情報|目次|収録曲|歌詞|スタッフ|キャスト|クレジット|(?:詩|歌|作品)の(?:本文|全文|原文)|^(?:本文|全文|原文)$/iu;
const NON_CONTENT = /https?:\/\/|<\/?[a-z][^>]*>|\[\[|\]\]|取扱説明書|こちらのタイトルには|含まれておりません|言語をサポート|動作環境|推奨環境|ISBN|IMDb|興行収入|興収|送料無料|税込|税別|カートに|お買い求め|購入はこちら|予約受付|予約購入|無料お試し|期間限定無料|無料版|有料版|試し読み|クリックして|ログイン|会員登録|Cookie|プライバシーポリシー|無断転載|著作権|All rights reserved/iu;
const METADATA = /^(?:著者|作者|監督|出演|出版社|発売日|刊行日|判型|頁数|ページ数|定価|価格|内容細目|目次|レビュー|口コミ|評価|関連(?:商品|作品)|おすすめ)[\s：:]|^第[一二三四五六七八九十\d]+章[\s：:]|(?:\d+円|\d+ページ|\d+頁)(?:[。\s]|$)|(?:読んだ|読んでみた|読んでの|読後の)感想|おすすめします|星[一二三四五1-5]つ|レビューを投稿/u;
const EDITORIAL = /^(?:ここからは|この記事では|本記事では)|あらすじを(?:ざっくり|紹介|解説)|いかがでしたか/u;
const PERSON_PROFILE = /^(?:著者|作者|作家|筆者|監督)は.{0,100}(?:生まれ|卒業|在住|デビュー|受賞)/u;
const PROMOTION = /賞受賞(?:の|した)?(?:作家|著者|気鋭)|受賞後(?:初|最初)の|初の単行本|累計.{0,10}(?:万部|百万部)|(?:万部|百万部)突破|好評発売|ベストセラー|最高傑作|大ヒット|絶賛|最新作|待望の|前作.{0,100}完結|全ての人に届け|ここに開幕|限定特典|特典イラスト|カラーページ|読んでもらいたい|巻末には|こちらの商品|ゲーム化にあたり|新規OP|新規ED|メディアミックス展開/u;
const OLD_KANA = /[ゐゑヰヱゝゞ]|(?:[てで]ゐ|思[ひふ]|と(?:言ふ|いふ|云ふ)|やうに|さうして|かうして|でせう|ませう|けふ|だつた|であつた|持つて|なつて|たまふ|給ふ)/u;
const CLASSICAL_ENDING = /(?:けり|なりけり|にけり|たりけり|ざるべし|べし|ざり|らむ|なむ)[。！？]/u;

function introductionSentenceIsUsable(sentence) {
  if (typeof sentence !== 'string' || !/[。!?！？][」』”"]?$/u.test(sentence.trim())) return false;
  if (NON_CONTENT.test(sentence) || EDITORIAL.test(sentence) || METADATA.test(sentence) || PERSON_PROFILE.test(sentence) || PROMOTION.test(sentence) || OLD_KANA.test(sentence) || CLASSICAL_ENDING.test(sentence)) return false;
  // Primary dialogue/lyrics are not a work introduction. A synopsis may still
  // contain a short quotation within a sentence explaining the story.
  if (/^[「『“"].*[」』”"](?:。)?$/u.test(sentence.trim())) return false;
  // Latin work names in quotations do not turn Japanese prose into English.
  const languageText = sentence.replace(/[「『][A-Za-z0-9][A-Za-z0-9 ;:_.,&'()\-]*[」』]/gu, '');
  const letters = languageText.match(/\p{L}/gu) || [];
  const japanese = languageText.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || [];
  return japanese.length >= 5 && japanese.length / Math.max(1, letters.length) >= 0.5;
}

module.exports = { MIN_LENGTH, MAX_LENGTH, TARGET_LENGTH, MAX_SENTENCES, EXCLUDED_SECTION,
  introductionSentenceIsUsable };

// Shared by source extraction and the saved-question loader. Keep the rules
// independent of any particular publisher, shop, title or year of publication.
const MIN_LENGTH = 120;
const MAX_LENGTH = 280;
const TARGET_LENGTH = 200;
const MAX_SENTENCES = 12;
const EXCLUDED_SECTION = /著者紹介|著者略歴|プロフィール|レビュー|口コミ|感想|評価|書評|受賞|ランキング|おすすめ|関連作品|関連商品|購入|通販|販売情報|商品情報|書誌|出版情報|目次|収録曲|歌詞|スタッフ|キャスト|クレジット|AI生成コンテンツ|生成AIの利用|操作方法|操作説明|制作経緯|制作のきっかけ|資金の使い道|スタッフ募集|早期アクセス|開発者から|システム要件|(?:詩|歌|作品)の(?:本文|全文|原文)|^(?:本文|全文|原文)$/iu;
const NON_CONTENT = /https?:\/\/|\bwww\.[a-z\d-]+(?:\.[a-z\d-]+)+|<\/?[a-z][^>]*>|\[\[|\]\]|※|視聴期限|通常配信|限定公開機能|先行視聴|リターン(?:内容|として|の|も必ず)|支援プラン|全て詰め込み|取扱説明書|こちらのタイトルには|含まれておりません|言語をサポート|動作環境|推奨環境|ISBN|IMDb|興行収入|興収|送料無料|税込|税別|カートに|お買い求め|購入はこちら|予約受付|予約購入|無料お試し|期間限定無料|無料版|有料版|試し読み|クリックして|ログイン|会員登録|Cookie|プライバシーポリシー|無断転載|著作権|All rights reserved/iu;
const METADATA = /^(?:著者|作者|監督|出演|出版社|発売日|刊行日|判型|頁数|ページ数|定価|価格|内容細目|目次|レビュー|口コミ|評価|関連(?:商品|作品)|おすすめ)[\s：:]|^読了時間[\s：:]|^早期アクセス(?:[。\s：:]|$)|矢印キー|WASD|[A-Z]で(?:一手|フロア|リセット)|(?:[A-Z]|キーボード|コントローラー)キーで|(?:VR|PC|Mac|Linux|Windows).{0,40}(?:遊べます|プレイできます|プレイ可能)|Steamワークショップ|クラウドもアカウントも不要|AI生成コンテンツの使用について|^第[一二三四五六七八九十\d]+章[\s：:]|(?:\d+円|\d+ページ|\d+頁)(?:[。\s]|$)|(?:読んだ|読んでみた|読んでの|読後の)感想|おすすめします|星[一二三四五1-5]つ|レビューを投稿|開発元|パブリッシャー|リリース日|書評より(?:抜粋|引用)|早期アクセスのゲーム|開発プロセスに参加|ゲームの開発に参加/u;
const EDITORIAL = /^(?:ここからは|この記事では|本記事では)|あらすじを(?:ざっくり|紹介|解説)|いかがでしたか/u;
const PERSON_PROFILE = /^(?:著者|作者|作家|筆者|監督)は.{0,100}(?:生まれ|卒業|在住|デビュー|受賞)/u;
const PROMOTION = /賞受賞(?:の|した)?(?:作家|著者|気鋭)|芥川賞作家|直木賞作家|受賞後(?:初|最初)の|初の単行本|累計.{0,10}(?:万部|百万部)|(?:万部|百万部)突破|好評発売|ベストセラー|最高傑作|大ヒット|絶賛|最新作|待望の|前作.{0,100}完結|全ての人に届け|ここに開幕|限定特典|特典イラスト|カラーページ|読んでもらいたい|巻末には|こちらの商品|ゲーム化にあたり|新規OP|新規ED|メディアミックス展開/u;
const OLD_KANA = /[ゐゑヰヱゝゞ]|(?:[てで]ゐ|思[ひふ]|と(?:言ふ|いふ|云ふ)|やうに|さうして|かうして|でせう|ませう|けふ|だつた|であつた|持つて|なつて|たまふ|給ふ)/u;
const CLASSICAL_ENDING = /(?:けり|なりけり|にけり|たりけり|ざるべし|べし|ざり|らむ|なむ)[。！？]/u;
// Crowdfunding pages often mix story prose with the creators' progress report.
// Retain the actual story sentences, but never use that report as the question.
const PRODUCTION_PROCESS = /物語で描くことは|^しないと後悔する|ファンディング|目標金額|(?:ご|皆様の|制作への)支援|支援(?:金|募集)|支援を(?:お願い|募る|募集)|支援者(?:への|向けの)(?:リターン|特典)|資金(?:調達|の使い道)|撮影(?:支援|資金)|スタッフ(?:募集|を集め)|(?:映画|撮影|制作).{0,80}(?:人|メンバー)を集め|四苦八苦|プロジェクトの(?:始まり|開始|目標|きっかけ)|初めての(?:映画|映像|ゲーム|作品)?制作|制作する短編映画|映像作品を.{0,30}制作したい|大学在学中に制作|それぞれができること|(?:監督|企画|脚本).{0,60}(?:務め|担当)|(?:自主制作|自主製作).{0,30}(?:完成|制作)|制作(?:費|資金|支援|メンバー|スタッフ)/u;
const CREATOR_REPORT = /進捗をご報告|作品制作.{0,70}進めております|お知らせ(?:致します|いたします)|^今回が初めて|撮影.{0,35}(?:始まりました|残り|準備|終了|完了)|(?:学年|学科|メンバー).{0,80}(?:集ま|創って|取り組)|プロジェクト.{0,50}(?:支援|達成|目標)|支援して(?:くださ|いただ)|描いていきたい|作品を通して.{0,80}(?:伝えたい|考えてもらいたい)|テーマで描くことに|(?:知りました|考えています|取り組んでまいりました|嬉しいです|よろしくお願いいたします)[。！!]/u;

// Unlabelled reviews may immediately follow a short plot. Once the prose turns
// to the reviewer's judgement, later sentences must not pad that plot.
const REVIEW_COMMENTARY = /(?:作画|演出|脚本|描写|映像|疾走感).{0,40}(?:素晴らし|見事|際立|傑作|圧巻)|素晴らしいのひと言|(?:本作|この作品).{0,30}(?:傑作|おすすめ|必見)|筆者(?:は|の)|個人的(?:には|に)/u;

function introductionSentenceIsUsable(sentence) {
  if (typeof sentence !== 'string' || !/[。!?！？][」』”"]?$/u.test(sentence.trim())) return false;
  if (/三題噺|投稿作|(?:約)?[\d,]+文字|^この度は|^さあ働け|支援を募(?:る|り)/u.test(sentence)) return false;
  if (NON_CONTENT.test(sentence) || REVIEW_COMMENTARY.test(sentence) || EDITORIAL.test(sentence) || METADATA.test(sentence) || PERSON_PROFILE.test(sentence) || PROMOTION.test(sentence) || PRODUCTION_PROCESS.test(sentence) || CREATOR_REPORT.test(sentence) || OLD_KANA.test(sentence) || CLASSICAL_ENDING.test(sentence)) return false;
  // Primary dialogue/lyrics are not a work introduction. A synopsis may still
  // contain a short quotation within a sentence explaining the story.
  if (/^[「『“"].*[」』”"](?:。)?$/u.test(sentence.trim())) return false;
  // Latin work names in quotations do not turn Japanese prose into English.
  const languageText = sentence.replace(/[「『][A-Za-z0-9][A-Za-z0-9 ;:_.,&'()\-]*[」』]/gu, '');
  const letters = languageText.match(/\p{L}/gu) || [];
  const japanese = languageText.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || [];
  const kana = languageText.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || [];
  return kana.length >= 2 && japanese.length >= 5 && japanese.length / Math.max(1, letters.length) >= 0.5;
}

function selectIntroductionSentences(sentences) {
  const excluded = new Set();
  const reviewStart = sentences.findIndex(sentence => REVIEW_COMMENTARY.test(sentence));
  if (reviewStart >= 0) for (let i = reviewStart; i < sentences.length; i++) excluded.add(i);
  for (let i = 0; i < sentences.length; i++) {
    if (!CREATOR_REPORT.test(sentences[i])) continue;
    // Creators' rhetorical questions can be split at '?' before "伝えたい".
    // Remove that connected question chain together with its progress report,
    // instead of turning the remaining fragments into a story introduction.
    for (let j = i - 1; j >= 0 && /[?？][」』”"]?$/u.test(sentences[j]); j--) excluded.add(j);
  }
  return sentences.filter((s, i) => !excluded.has(i) && introductionSentenceIsUsable(s));
}

module.exports = { MIN_LENGTH, MAX_LENGTH, TARGET_LENGTH, MAX_SENTENCES, EXCLUDED_SECTION,
  introductionSentenceIsUsable, selectIntroductionSentences };

# タイトルカッコカリ｜UI再制作・実装正本

最終更新：2026-10-01

Version：POP-UI v1.2

Status：**ユーザー指定を反映した実装基準**

## 0. この文書の役割

本書は、ゲーム『タイトルカッコカリ』のUIの実装基準である。2026-09-30にユーザーが採用した**ポップな2DゲームUI案**を基に、2026-10-01のゲーム名、ホーム再制作、読みやすい文字への変更を反映する。

正式名は「タイトルカッコカリ」、画像ロゴの表記は「タイトル（仮）」とする。名前、共通ロゴ、同梱フォントの基準を保ち、今回のホームには採用した3段階の見本、暖かい背景、広い紙の余白を反映する。待機・最終結果の狭い画面での重なりと、エラー・退出・人が抜けたときの操作も直す。他画面の見た目や採点方法は保つ。ホームの詳しい方針は [TITLE_SCREEN.md](TITLE_SCREEN.md) に記録する。

対象は次の9画面と、そのロール・進行状態の差分である。

1. ホーム
2. ルーム待機
3. あらすじ確認／既知宣言
4. 偽タイトル入力
5. 投票
6. ラウンド結果
7. 最終順位
8. 遊び方
9. 接続設定

本書は、旧「机上の紙コラージュ」「写実的な文具」「文芸誌だけに寄せた静的UI」を採用しない。現行RepositoryにはポップUIへの部分移行が入っているが、**現在の実装を完成形とは扱わない**。画面判断が食い違う場合は、次の順に優先する。

1. 2026-10-01のユーザー指定と、今回の名前・ホーム・文字の方針
2. 本書と `TITLE_SCREEN.md`
3. ホーム以外の、ユーザーが採用した9画面ポップUIモック
4. 現行ゲーム仕様とSocket.IO契約
5. 現行クライアント実装
6. 過去の紙・文具UI仕様

関連：GitHub Issue #47（当初の9画面案）、[Issue #51](https://github.com/shiroku46/title-kakko-kari/issues/51)（名前・ロゴ・文字）、[Issue #55](https://github.com/shiroku46/title-kakko-kari/issues/55)（採用したホームの見本と操作の修正）。過去の資料名や引用元の名前は当時の記録として保持する。

---

## 1. 目的

### 1.1 達成すること

- 初見で「複数人で遊ぶタイトル当てゲーム」だと分かる。
- 各フェーズで、読む・考える・選ぶ・待つ・結果を見る行為が迷わず分かる。
- PCとスマートフォンで同じ視覚文法を維持する。
- 画面を見ただけで、現在のラウンド、役割、進行状況、次の操作が把握できる。
- AI生成UIにありがちなSaaSテンプレート感、過剰カード、意味のない装飾を排除する。
- 既存のゲーム進行、採点、イベント契約を変更せず、表示層だけを再制作する。

### 1.2 達成しないこと

- 新しいゲームモードの追加
- アカウント、履歴、チャット、観戦、再接続復帰の追加
- Server、DB、Socket.IO payloadの変更
- UIを理由にしたルール・得点・人数条件の変更
- 写真、木目、コーヒー、実物の紙束を使う雰囲気再現

---

## 2. Visual concept

### 2.1 一文定義

**「言葉を考えて、みんなで見抜く」が即座に伝わる、日本製パーティーゲームのポップな2D UI。**

### 2.2 視覚の核

- 濃紺の太い輪郭
- クリーム色の読み物面
- 赤の主要アクション
- 黄の選択・注目
- 水色の待機・情報
- ピンクの注意・遊び
- 平面的な紙片、テープ、罫線、吹き出し
- 太く短い日本語見出し
- 1画面1目的
- 1画面1主要CTA

紙やノートは**現実物の再現ではなく、ゲーム画面上の平面記号**として使う。紙の繊維、写真風の影、斜めに積まれた紙、机の小物は使用しない。

### 2.3 署名的モチーフ

画面を『タイトルカッコカリ』固有のものにするため、次の要素を共通して使う。

- `GameLogo`：画像生成した「タイトル（仮）」のロゴ。読み上げには正式名「タイトルカッコカリ」を使う
- 太い濃紺枠と、内側1pxの明るいハイライト
- ラウンド表示の短い黄色ラベル
- 右下または欄外に置く、小さな平面紙片
- タイトル候補の横長選択行
- 重要語を1箇所だけ赤で強調
- 猫マスコット：ホームは、白い物語カード3枚と濃紺の猫1体を描いた `home-cat.png`。他画面へ新たな絵を広げる作業は別途扱う

マスコットは1画面1体まで。操作の意味を代替せず、文字情報を隠さない。

---

## 3. AIテンプレート化を防ぐ規則

次のパターンは、採用モックに存在しない限り禁止する。

- 紫～青のグラデーションを主役にする
- ガラスモーフィズム
- すべてを同じ角丸カードへ入れる
- 3枚カードを等間隔に並べるだけの説明構成
- 英語のkicker、badge、pillを意味なく追加する
- `JOIN THE GAME`、`FINAL RESULT`等を日本語見出しより目立たせる
- 絵文字を主要アイコンにする
- ぼかした巨大円、発光、ネオン、過剰なドロップシャドウ
- 架空の統計、実績、レビュー、プレイヤー数を加える
- 意味のない「設定」「通知」「プロフィール」アイコンを増やす
- 全画面を同じ左右2カラムへ押し込む
- 写真、木目、コーヒー、観葉植物、ペンを背景へ置く
- 物理的な紙コラージュを再現する
- 実装都合で採用モックをSaaSフォームへ戻す

ホームは英語のkickerや補助の英語ロゴを置かない。操作、エラー、進行説明は日本語を正とする。

---

## 4. 機能境界

### 4.1 維持するNavigation

- `Home`
- `Lobby`
- `Game`
- `Result`
- `Rules`

設定は新しいRouteにせず、ホーム上のモーダル、ドロワー、または折りたたみ面として扱う。

### 4.2 維持するGame phase

- `confirming`
- `selecting`
- `submitting`
- `voting`
- `revealed`

### 4.3 変更しない契約

- Socket.IOイベント名
- イベントpayload
- 4～6人のproduction人数条件
- プレイヤー出題／CPU出題
- 正解1点
- 偽タイトルへ入った票数分の得点
- プレイヤー出題時のMVP1点
- ラウンド進行
- 自分の偽タイトルへの投票禁止
- 重複提出・重複投票・MVP二重加点の拒否

---

## 5. Golden Screen

### 5.1 基準画面

最初に完成させるGolden Screenは**ホーム画面**とする。

検証ビューポート：

- Desktop：1440 × 900
- 採用見本の大きさ：1586 × 992
- Compact desktop：1024 × 768
- Mobile：390 × 844
- 狭いMobile：320 × 740
- Tablet：768 × 1024

ホームを採用品質まで完成させる前に、全画面へ色・枠・ボタンを横展開しない。

### 5.2 Desktopの構成

暖かいクリーム色 `#FFF1D6` の開いた背景に、短い説明と見本、参加面を左右に置く。幅1200px以上を対象にし、ヒーロー全体を濃紺の角丸面へ入れない。

- 外側余白：画面幅の3.6%ずつ
- 最大幅：1586px
- 上部ヘッダー：最小60px
- 左側ヒーロー：参加面と間隔を除いた残りの幅
- 右側参加面：内容幅の30%。左に34pxの余白と細い境界線
- ヒーローと参加面の間：24px

左側には画像ロゴ、短い説明、濃紺の猫と白い物語カードの画像、ジャンルを切り替えられる3段階の見本を置く。右側にはニックネームと作成／参加操作をまとめる。見本は一つの小さな面に収め、あらすじの紙には十分な余白を取る。ノートPC高さで主要CTAが見切れないこと。

### 5.3 Mobile／Tabletの構成

- 幅1200px未満では縦に並べる
- 左右余白：20px。幅360px未満では16px
- 上部：正式名＋遊び方／接続設定
- ロゴ／短い説明／ロゴ横の小さい猫
- 参加面
- 縦に並ぶ3段階の見本
- フッター

Mobileでも名前入力と作成／参加をすぐ見つけられるようにする。猫を小さくし、参加面を見本より先に置いて、部屋の作成を画面下へ追いやらない。

---

## 6. Design tokens

`client/src/theme/tokens.js`を実装上の正本とする。値を変更する場合は、本書と同一PRで更新する。

### 6.1 Color

| Token | Value | 用途 |
|---|---:|---|
| `navy` | `#0B2D4D` | 主輪郭、見出し、濃色面 |
| `navyDeep` | `#071F36` | 最深背景、押下状態 |
| `navySoft` | `#163F66` | 補助濃色面 |
| `cream` | `#FFF7E8` | 参加面、説明面 |
| `paper` | `#FFFCF5` | 本文面、選択行 |
| `canvas` | `#EAF4F6` | 通常背景 |
| `sky` | `#D9F0F4` | 待機・情報背景 |
| `cyan` | `#4FC4D4` | 待機、説明、補助装飾 |
| `blue` | `#2F87D7` | 参加、副操作のアクセント |
| `yellow` | `#FFD45B` | 選択、注目、MVP |
| `red` | `#EB4057` | 赤い線、通知、軽い強調 |
| `redDark` | `#C92F45` | 主要ボタン背景 |
| `pink` | `#FF9DBB` | 注意、遊びの装飾 |
| `green` | `#68BE86` | 成功、完了 |
| `ink` | `#13263D` | 本文 |
| `muted` | `#65778A` | 補助文 |
| `border` | `#B9CBD7` | 弱い境界 |
| `white` | `#FFFFFF` | 反転文字、明るい面 |

ホーム全体の背景は暖かいクリーム `#FFF1D6` とする。見本・副ボタン・設定の面には明るい `cream` `#FFF7E8`、あらすじと題名の紙には白を使う。生成された見本画像の紙のざらつきや色むらを、実際の背景画像として持ち込まない。`canvas` はホーム以外の通常背景として維持する。

### 6.2 Color semantics

- 主要確定CTA：`redDark`背景＋`white`
- 今回のホームの主要CTA：生成見本の `red` `#EB4057` 背景＋`white`。文字は縦並び22px／Desktop26px、実際のBold（700）とし、大きい太字の基準で3:1以上の色の差を確保する
- 副CTA：`navy`背景＋`white`、または`paper`背景＋`navy`
- 選択中：`yellow`背景＋`navy`
- 待機：`sky`背景＋`navy`
- 成功：`green`は面全体ではなく、完了記号・短い通知へ使う
- 正解：`navy`の大面＋`yellow`または`white`、赤い補助印
- エラー：`redDark`＋白、または淡いピンク背景＋`navy`

`red`と`blue`の上へ小さい白文字を直接置かない。通常サイズの白文字ボタンには`redDark`または`navy`を使う。本文はホームでも4.5:1以上を基準にする。

### 6.3 Spacing

- `2, 4, 8, 12, 16, 24, 32, 48`
- 画面外側：Mobile 16／Tablet 24／Desktop 48
- パネル内側：Mobile 16～20／Desktop 20～28
- 入力とラベル：6～8
- 同一グループ：8～12
- 異なる情報群：20～32

今回のホームの外側余白は、幅1200px未満で20px（幅360px未満は16px）、幅1200px以上で画面幅の3.6%とする。他画面の既存の余白は維持する。

### 6.4 Geometry

- 小要素：6～10px
- ボタン・入力：12～14px
- 主要パネル：18～20px
- ヒーロー面：24～28px
- 状態pill：完全なpillを許可
- 主枠：2px `navy`
- 結果・選択強調：3pxまで

全要素を20px以上の大角丸へしない。選択肢、スコア表、本文面は角丸を小さくし、主要パネルとの差を作る。

### 6.5 Shadow

影は情報階層を表す場合だけ使う。

- 通常パネル：0～4px下、opacity 0.10～0.12
- 主要操作面：0～8px下、opacity 0.16～0.18
- 選択肢行：未選択では影なし
- ボタン：押せることが分かる弱い影
- 背景装飾：影なし

---

## 7. Typography

### 7.1 Font stack

文字ファイルはアプリに同梱し、外部のフォント配信への接続を必須にしない。

- 本文、見出し、ボタン、入力欄：`Noto Sans JP` のRegular（400）とBold（700）
- 数字・コード：UIと同じ。monospaceへしない
- ロゴ：画像生成した `GameLogo` 専用画像。画像に操作文字を含めない
- Web：同梱のWOFF2、iOS / Android：同梱のTrueType
- 読み込み失敗時：端末のsans-serifを使ってゲームを開く

以前集めたMochiy Pop One、Zen Maru Gothic、Yusei Magicなどは収集済みの別案として保持し、今回の表示用には読み込まない。字体の出所、利用条件、変換方法は [FONTS.md](FONTS.md) に記録する。

### 7.2 Scale

| Role | Desktop | Mobile | Weight |
|---|---:|---:|---:|
| Logo full | 親の幅に収める画像 | 親の幅に収める画像 | 元画像の比率を維持 |
| Page title | 32～40 | 26～32 | 700 |
| Phase title | 24～30 | 21～26 | 700 |
| Panel title | 18～22 | 17～20 | 700 |
| Body | 15～17 | 14～16 | 400 |
| Button | 16～18 | 15～17 | 700 |
| Label | 12～13 | 11～12 | 700 |
| Caption | 10～12 | 10～11 | 400または700 |
| Room code | 38～48 | 30～38 | 700 |

今回のホームの作成／参加ボタンは、縦並び22px／Desktop26px、Bold（700）を使う。

本文は行間1.55～1.75。あらすじは1行45文字前後を上限にし、PCでも横長一行へ伸ばさない。

### 7.3 Copy rules

- 見出しは短くする。
- 主要ボタンは動詞から始める。
- 待機中は「誰を待っているか」「何が起きれば進むか」を書く。
- エラーは原因と次の行動を1～2文で書く。
- ホームの説明と操作は日本語のみ。
- 感嘆符は1画面1箇所以内を目安にする。

---

## 8. Icon and illustration

### 8.1 Icon

- 太さ2～2.5px相当
- 角はやや丸い
- outlineとfillを同じ画面で混在させすぎない
- `+`, `×`, `→`, `?`など単純な文字記号は使用可能
- OS依存の絵文字は使用しない
- アイコンだけで意味を伝えず、重要操作には文字を併記する

新しいアイコン依存を追加する場合は、実装Issueで別途承認する。既存依存だけで不足する場合は、小さなcode-native icon componentを作る。

### 8.2 Logo

`GameLogo`は次を満たす。

- 表示：「タイトル（仮）」
- 正式名／読み上げ名：「タイトルカッコカリ」
- 濃紺を中心に、赤と黄の差し色を使う生成画像
- 素材：`client/assets/brand/title-logo.png`
- full／compactの2種
- 縦横比を保ち、親の幅に合わせて収める
- Mobileで潰れない
- 画像化する場合も、画面内の操作文字は画像へ含めない

### 8.3 Mascot

猫マスコットは次の3状態を想定する。

- neutral：ホーム、説明
- thinking：待機、入力
- celebrate：正解、最終結果

透明背景PNGまたは同等の独立素材とする。生成・採用前は仮アイコンで量産せず、マスコットなしでも画面が成立する構造にする。

今回のホームでは `client/assets/brand/home-cat.png` を使い、濃紺の猫1体と白い物語カード3枚を一つの絵として置く。カードは中央の「？」と左右の線で表し、扱う作品を一つの種類に限定しない。ロゴとイラストは別の素材として扱う。以前の `title-cards.png` は保存するが、ホームでは使わない。

### 8.4 Background assets

`PopBackdrop`は写真を使わない。今回のホームでは、無地の `#FFF1D6` 背景を使い、既存の背景装飾を重ねない。

- 大きな淡色の面：最大3個
- 小さな紙片・ライン：最大5個
- 背景コントラストは本文面より十分弱くする
- 画面ごとにランダム配置しない
- ゲーム中画面はホームより装飾密度を下げる

---

## 9. Canonical component system

### 9.1 Migration naming

現行の次の名前は旧紙UI由来である。

- `PaperPanel`
- `StationeryButton`
- `StickyNote`
- `Stamp`

新規実装では次を正本名とする。

- `GamePanel`
- `GameButton`
- `InfoTag`
- `ResultMark`

移行時は旧exportを互換aliasとして残してよい。全画面移行後、別PRで旧名を削除する。見た目変更と大規模renameを同じ変更単位に混ぜない。

### 9.2 `GamePanel`

Variants：

- `surface`：一般情報
- `cream`：入力・参加
- `sky`：待機・情報
- `yellow`：注目・MVP
- `navy`：正解・強い結果
- `danger`：エラー

Props：`tone`, `elevation`, `padding`, `role`。ネストは原則1階層まで。

### 9.3 `GameButton`

Variants：

- `primary`：赤、確定
- `secondary`：濃紺、参加・副主要操作
- `choice`：白／黄、選択
- `neutral`：白、再取得・戻る
- `ghost`：補助導線
- `danger`：退出等。常用しない

States：default / pressed / focus / disabled / loading。

- 高さ：Mobile 52以上、Desktop 50以上
- `pressed`は2px下へ移動し、影を弱くする
- `disabled`は透明度だけに頼らず、背景・文字・ラベルで示す
- loading時もボタン幅を変えない

### 9.4 `GameLogo`

- full：ホーム
- compact：ヘッダー
- dark surface用のlight variant
- `accessible`な文字ラベルを持つ

### 9.5 `PlayerTile`

States：

- host
- me
- ready
- waiting
- submitted
- voted
- disconnected
- empty slot

名前の頭文字を使う場合も、色だけで人物を区別しない。名前、ホスト記号、状態文を併用する。

### 9.6 `RoundHUD`

表示：

- 現在ラウンド／総ラウンド
- 現在フェーズ
- 出題者
- 自分の役割
- 必要時のみ進行数

Mobileでは2段にし、横一列へ圧縮しない。

### 9.7 `SynopsisBoard`

- 本文幅を制限
- 長文scroll
- タイトルを含まないことを視覚上保証する
- CPU確認時だけホストへ確定・再取得を表示
- 回答者の既知宣言は本文下へ置く

### 9.8 `TitleEntry`

States：empty / typing / invalid / submitting / submitted。

- 文字数
- 送信後の内容
- 他プレイヤーに見えない説明
- Enterだけで誤送信しない

### 9.9 `VoteChoice`

States：default / hover / selected / disabled / confirmed。

- 1行全体を押せる
- 選択中は黄背景＋太い濃紺枠
- 確定後は変更不可であることを文言表示
- 自分の案はdisabled理由を示す

### 9.10 `ScoreTable`

- ランク、名前、今回点、合計点
- 数字を右揃え
- 1位、本人、MVPを別々の記号で示す
- 色だけで順位を示さない

### 9.11 `MascotIllustration`

- 非インタラクティブ
- 装飾としてAccessibility treeから外す
- 画面の主情報より弱い

---

## 10. Screen specification

## 10.1 Home

### Purpose

ゲーム内容を短い見本で理解し、名前を入力して、作成または参加へ進む。

この節は [Issue #55](https://github.com/shiroku46/title-kakko-kari/issues/55) の採用見本を反映する。詳しい素材と操作の基準は [TITLE_SCREEN.md](TITLE_SCREEN.md) に記録する。

### Hierarchy

1. ヘッダー：正式名、遊び方、接続設定
2. `GameLogo`、小さい猫、「ウソを考えて、本物を当てる。」
3. 「遊びの見本」：映画・小説・漫画・ゲームのタブ
4. 「1 あらすじ」→「2 ウソをつくる」→「3 本物はどれ？」
5. 「4〜6人で遊べる ・ 知らなくても遊べる」
6. 参加面：「ゲームをはじめる」、ニックネーム、「部屋をつくる」／「部屋に入る」
7. 遊び方を見る、折りたたんだ接続設定
8. 正式名と「言葉で、あそぶ。」のフッター

ロゴと猫以外は実際のText／TextInput／buttonで組む。長い説明やジャンル別の見本を何段も置かない。タブは紹介用の見本を切り替えるもので、本番の問題のジャンルを選ぶ機能ではない。英語は、ありそうなウソの題名の見本に使う。操作と答えの説明は日本語にする。

初めの映画のあらすじは「車のタイムマシンで30年前へ行った高校生。両親の出会いを邪魔してしまい、自分が生まれない未来を変えようとする。」。ウソの紙に `BACK TO TOMORROW`、候補に「タイム・リターン」「バック・トゥ・ザ・フューチャー」「BACK TO TOMORROW」を同じ見た目で並べる。押す前から本物を強調しない。

候補を押すと短い答えを表示する。自分が書いたものとして示したウソは選択先にせず、選べない理由を知らせる。タブの切り替えで選択と答えを消す。部屋や得点には触れない。

### Desktop

- 幅1200px以上で左右に分ける。最大幅1586px、左右の余白は画面幅の3.6%
- 左：画像ロゴ、短い説明、`home-cat.png`、3段階の見本
- 右：内容幅の30%の参加面。左に34pxの余白と細い境界線
- 背景：無地の `#FFF1D6`。見本と副ボタンは `#FFF7E8`。大きな濃紺パネルで囲まない
- 見本の幅が700px以上なら3段階を横に並べ、それより狭ければ縦にする
- 白いあらすじの紙は左右24px／上下22pxの余白を取り、18px／行間29pxの本文を詰め込まない
- CTAは縦2個。主ボタンは赤と白い太字、副ボタンは明るいクリームと濃紺の文字

### Mobile

- 正式名と遊び方／接続設定
- ロゴ、短い説明、ロゴ横の小さい猫
- 名前入力と作成／参加
- 縦に並ぶ3段階の見本
- フッター

幅1200px未満はTabletもこの順にする。左右の余白は20px、幅360px未満は16px、内容幅は最大720px。名前入力と作成／参加へすぐ進めることを優先する。見本の紙は内側に22pxの余白を取り、本文は16px／行間27px。

主なボタンの最小高さは縦並び56px／Desktop72px、入力欄は縦並び54px／Desktop64px。

### States

- genre example selected
- example answer and feedback
- create selection
- join selection
- health check
- server waking
- socket connecting
- entry cancelled
- response timed out
- input error
- connection error
- settings expanded

入力の間違いと接続失敗は画面内に表示する。接続中は二重送信を防ぎ、「やめる」で入力に戻れるようにする。起動待ちは最大90秒、Socket接続と部屋作成・参加の返事待ちは各10秒。取り消した要求の遅い返事で部屋へ進まない。

### Acceptance

- 320×740、390×844、768×1024、1024×768、1440×900、1586×992で文字や操作が横にはみ出さない
- 名前入力と作成／参加ボタンが見本の長さに押し下げられない
- クリームの背景と、あらすじの紙の十分な余白が採用見本に合う
- `Home`だけを見て4～6人ゲームだと理解できる
- 4つのタブと見本の題名を操作でき、切り替え後に古い答えが残らない
- 接続設定が通常利用の主導線を邪魔しない
- 生成ロゴの読み上げ名は正式名、イラストは装飾として読み上げ対象から外れる
- 作成／参加、遊び方、接続設定を操作でき、空欄・不正なコード・接続失敗・返事なしからもう一度試せる
- 文字の読み込みに失敗しても端末の文字で開き、操作を続けられる

## 10.2 Lobby

### Purpose

コード共有、参加状況確認、ホスト設定、開始。

### Hierarchy

1. ルームコード
2. 参加人数
3. 6枠の参加者
4. ホスト設定またはゲスト待機
5. 開始状態
6. 退出

### Host

- プレイヤー出題／CPU出題
- CPU時のみラウンド数
- 最低人数未達時は開始disabled
- 「あとN人」を明示

### Guest

- 自分が参加済みであること
- ホスト設定待ち
- 画面を閉じない説明

### Exceptional state

- ホスト交代
- 参加者離脱
- 6人満員
- 接続切断

### Acceptance

- 空席を含む6枠が一覧できる
- ホストと本人が色以外でも判別できる
- コードは読み上げ可能で、文字間隔が狭すぎない

## 10.3 CPU synopsis confirmation (`confirming`)

### Host

- loading：取得中
- ready：あらすじ確認
- failure：再取得
- confirm：このあらすじで進む

### Guest

- 「ホストがあらすじを確認しています」
- 不要な空入力面を表示しない

### Acceptance

- ホストの主要操作は確定／再取得の2つだけ
- 取得失敗を一般エラーと混同しない
- あらすじが最も大きい面を占める

## 10.4 Player synopsis and knowledge declaration (`selecting`)

### Questioner before presentation

- 本物タイトル
- あらすじ
- 提示

### Answerer after presentation

- あらすじ
- 「知ってる」
- 「知らない」
- 宣言後の待機

### Questioner after declarations

- 全員未知：提出開始
- 既知あり：作品を選び直す
- 宣言待ち：人数進行

### Disconnected questioner

- ホストへスキップ導線
- 他プレイヤーへ状況説明

### Acceptance

- 「知ってる／知らない」を誤って逆に押しにくい
- 既知者がいる場合、提出開始を表示しない
- あらすじ、本物タイトル入力を回答者へ漏らさない

## 10.5 Fake title submission (`submitting`)

### Answerer

- あらすじ
- タイトル入力
- 文字数
- 提出
- 提出後内容と待機

### Questioner

- 提出済み人数／総人数
- 内容は見えない
- 待機説明

### Acceptance

- 入力欄と提出が画面の主役
- 提出前後が明確に変わる
- 自分の提出内容は確認できる
- 他人の案は投票開始まで表示しない

## 10.6 Voting (`voting`)

### Answerer

- 候補一覧
- 1件選択
- 確定
- 確定後待機

### Questioner

- 投票済み人数／総人数
- 投票内容は見えない

### Layout

- Desktop：あらすじ30～36%、候補64～70%
- Mobile：ラウンドHUD、候補、確定CTA。あらすじは折りたたみ可能

### Acceptance

- 候補は2行以上でも高さが破綻しない
- 選択状態を黄・枠・ラジオで示す
- 自分の案へ投票できない理由が分かる
- CTAは候補選択前にdisabled

## 10.7 Round result (`revealed`)

### Hierarchy

1. 正解タイトル
2. 得点した人
3. 各候補、作者、票数
4. 今回点
5. 合計順位
6. MVP
7. 次ラウンド／最終結果

### Player mode

- 出題者のみMVP選択
- MVP未選択／選択済みを明示

### CPU mode

- MVP面を表示しない
- 次ラウンドへ直接進む

### Acceptance

- 正解が1秒以内に分かる
- 誰が誰をだましたか追える
- 今回点と累計点を混同しない
- 最終ラウンドではCTA文言を「最終結果を見る」にする

## 10.8 Final result

### Hierarchy

1. 優勝者
2. 最終順位
3. 得点
4. もう一度遊ぶ
5. ホームへ戻る

### Acceptance

- 1位を大きく表示するが、全順位が同じ画面で読める
- 同点を壊さない
- winnerが欠けても画面が落ちない
- celebrate mascotは主情報を隠さない

## 10.9 Rules

### Contents

- 6ステップ
- 3種の得点
- 「知ってる」時の処理
- プレイヤー出題／CPU出題の違い
- 4～6人
- 途中切断時の注意

### Layout

Desktopは2～3列を使えるが、同じカード6枚を並べるだけにしない。前半3ステップと後半3ステップで背景帯または視線方向を変える。Mobileは縦順を維持する。

### Acceptance

- 初見ユーザーが2分以内に基本進行を理解できる
- 得点ルールが例なしでも読める
- 戻る操作を上部・下部に用意する

## 10.10 Settings

接続設定は通常ユーザー向けの主要機能ではない。

- ホームから開く
- Desktop：右側drawerまたは小モーダル
- Mobile：bottom sheetまたは折りたたみ面
- Server URL
- デフォルトへ戻す
- ローカル試遊説明

通常利用では閉じた状態を初期値とする。設定面にゲーム設定や音量など、未実装項目を追加しない。

---

## 11. Global states

すべての画面で、次の状態を専用表示する。

### Loading

- 操作対象を残したまま二重送信させない
- 何を待っているか書く
- 10秒超では補足文を変更する

### Empty

- 空欄だけを表示しない
- 誰が何をすると埋まるか書く

### Disabled

- 色、opacity、文言、`accessibilityState`を併用
- disabled理由を近接表示

### Error

- エラー名ではなく、ユーザーの次の行動を書く
- 内部URL、stack、raw errorを出さない
- 再試行可能な場合だけ再試行ボタンを出す

### Disconnect

- 進行中の切断はモーダルまたは明確な通知
- ホームへ戻る場合は理由を表示
- ホスト交代を黙って行わない

### Success

- 提出、投票、MVP、完了は短い状態変化を出す
- 自動的に消える通知だけに頼らず、画面本体へ完了状態を残す

---

## 12. Motion

### Timing

- Press：80～120ms
- Panel transition：160～220ms
- Submit／vote completion：180～260ms
- Correct reveal：300～450ms
- Final winner：450～650ms

### Allowed

- scale 0.98 → 1
- opacity
- 8～16pxの短い移動
- ResultMarkの1回だけのstamp motion
- 少量のconfetti

### Prohibited

- 常時揺れる装飾
- 無限ループ
- 背景動画
- 読み終わる前の自動遷移
- 1秒を超える操作ブロック演出

Reduce Motion時は、scaleと移動を省き、opacityだけにする。

---

## 13. Accessibility

- タップ領域44×44px以上
- 重要本文4.5:1以上
- 大きい太字以外の白文字には`redDark`または`navy`背景を使う
- 色だけで状態を示さない
- 選択肢はradio semantics
- 進行数は読み上げ可能な文にする
- Room codeは1文字ずつではなく、コード全体を読み上げるlabelを持つ
- 装飾、マスコット、confettiはAccessibility treeから外す
- Dynamic Type／文字拡大でボタン文字を切らない
- Webではfocus-visibleを消さない

---

## 14. Responsive system

### Breakpoints

- Mobile：`< 768`
- Tablet：`768–1023`
- Desktop：`>= 1024`

### Rules

- 390pxで横scrollなし
- 1024pxでDesktop専用情報配置へ移行
- 1440pxでも本文幅を広げすぎない
- `CONTENT_MAX_WIDTH`は1240～1280px
- 今回のHomeは最大1586pxとし、幅1200px未満ではTabletも縦に並べる。ロゴ横の猫を小さくし、参加面を3段階の見本より先に置く
- 主要CTAはMobileで原則full width
- 2カラムは、主作業と補助情報に意味がある画面だけ
- 画面下固定CTAはsafe areaを考慮し、本文を隠さない

### Required viewports

- 390 × 844
- 768 × 1024
- 1024 × 768
- 1440 × 900

---

## 15. Existing code migration map

| Current | Canonical direction | Action |
|---|---|---|
| `HomeScreen.js` | Golden Screen | 最初に完成させる |
| `LobbyScreen.js` | Room lobby | Home確定後に調整 |
| `GameScreen.js` | state orchestration | 見た目以外を変更しない |
| `ConfirmingPhase.js` | CPU confirmation | host／guest差分を整理 |
| `SelectingPhase.js` | synopsis／declaration | 状態を分割して整理 |
| `SubmittingPhase.js` | fake title entry | 入力を主役にする |
| `VotingPhase.js` | title choices | 候補行を正本化 |
| `RevealedPhase.js` | round result | 正解、得点、MVPを整理 |
| `ResultScreen.js` | final result | winner／rankingを整理 |
| `RulesScreen.js` | how to play | 6ステップ＋得点へ整理 |
| `PaperPanel.js` | `GamePanel` | 互換alias経由で移行 |
| `StationeryButton.js` | `GameButton` | 互換alias経由で移行 |
| `StickyNote.js` | `InfoTag` | 使用箇所を限定 |
| `Stamp.js` | `ResultMark` | 正解・MVP等だけ |
| `PopBackdrop.js` | Background system | 密度を画面別に制御 |
| `GameLogo.js` | Brand mark | full／compactを完成 |
| `tokens.js` | Token source | compatibility aliasを後で削除 |

`GameScreen.js`のstate、listener、navigationは表示移行中に変更しない。UIロジックとゲーム進行修正を同じPRへ混ぜない。

---

## 16. Implementation order

### Phase 0：Spec and audit

- 本書を正本化
- 現行スクリーンショットを4 viewportで保存
- 使用中token、component、旧紙UIモチーフを一覧化

### Phase 1：Golden Screen

- Token整理
- `GameLogo`
- `PopBackdrop`
- `GamePanel`
- `GameButton`
- Home Desktop
- Home Mobile
- Browser screenshot比較

Homeが採用品質に達するまで次へ進まない。

### Phase 2：Lobby

- Room code
- PlayerTile
- Host settings
- Guest waiting
- 4～6人状態

### Phase 3：Core game input

- RoundHUD
- CPU confirming
- Player selecting／known declaration
- TitleEntry
- VoteChoice

### Phase 4：Results

- Round result
- MVP
- ScoreTable
- Final result

### Phase 5：Support surfaces

- Rules
- Settings
- Error／disconnect／loading
- Mascot assets

### Phase 6：Cleanup

- 旧紙UI互換alias削除
- 未使用component削除
- compatibility color alias削除
- 文書同期

---

## 17. Verification

### 17.1 Functional

- public export guard
- repository validation
- Python tests
- Server Socket.IO E2E
- Expo Web build
- 4人プレイヤー出題完走
- CPU出題の主要状態

### 17.2 Visual

各画面を次で確認する。

- 390 × 844
- 1024 × 768
- 1440 × 900

最低限撮影する状態：

1. Home create
2. Home join
3. Lobby host／3人
4. Lobby host／4人
5. Lobby guest
6. CPU loading／ready／failure
7. Player questioner input
8. Answerer known declaration
9. Submission empty／submitted
10. Voting unselected／selected／confirmed
11. Round result before／after MVP
12. Final result
13. Rules
14. Settings
15. Error／disconnect

### 17.3 Fidelity ledger

各変更PRに次を記録する。

| Point | Mock requirement | Browser result | Fix／deviation |
|---|---|---|---|
| First viewport | 主要CTAまで見える |  |  |
| Typography | 太い日本語見出し |  |  |
| Palette | navy／cream／red／yellow |  |  |
| Geometry | 太枠、限定的な角丸 |  |  |
| Density | 1画面1目的 |  |  |
| Mobile | 横scrollなし |  |  |
| State | selected／disabledが明確 |  |  |

機能テスト成功だけではUI完成としない。採用モックと実装スクリーンショットを直接比較する。

---

## 18. Screen acceptance matrix

| Screen | Primary task | Main CTA | Complete when |
|---|---|---|---|
| Home | 作成／参加 | 部屋をつくる／部屋に入る | 初見でゲームと導線が分かる |
| Lobby | 集合／設定 | ゲームを開始 | コード、人数、役割が分かる |
| Confirming | CPUあらすじ確認 | このあらすじで進む | host／guest状態が明確 |
| Selecting | 提示／既知宣言 | 提示／知ってる／知らない | 役割別操作を誤らない |
| Submitting | 偽タイトル入力 | 提出する | 入力と待機が明確 |
| Voting | 本物を選ぶ | 投票する | 選択／確定／禁止が明確 |
| Round result | 正解・得点確認 | 次のラウンド | 正解と得点理由が追える |
| Final result | 最終順位確認 | もう一度遊ぶ | 優勝者と全順位が読める |
| Rules | 遊び方理解 | ホームへ戻る | 2分以内に基本ルールが分かる |
| Settings | 接続先変更 | 保存／戻す | 通常導線を邪魔しない |

---

## 19. Final definition of done

UI再制作は、次をすべて満たした時点で完了とする。

- 9画面が同じポップUIシステムで実装されている
- HomeがGolden Screenとして採用モックと整合する
- 全Game phaseのホスト／出題者／回答者差分が成立する
- 4 viewportで破綻しない
- loading、disabled、error、disconnectが専用表示を持つ
- 旧写真風・机上紙コラージュが残っていない
- 旧紙UI component名が互換aliasを除いて新規使用されていない
- Socket.IO、採点、人数、Navigationに不要な変更がない
- CI、Web build、通信E2Eが成功する
- 採用モックと最新ブラウザ画面の比較で、修正可能な視覚差分が残っていない
- ユーザーがホームGolden Screenと全画面展開を最終採用する

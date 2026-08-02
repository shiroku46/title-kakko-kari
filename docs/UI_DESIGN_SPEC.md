# UI Design Specification — 文具風レスポンシブUI

## Design concept

「文房具に囲まれたタイトル企画会議」。ユーザーが紙にタイトルを書き、候補を並べ、印を押して本物を選ぶ感覚。Webアプリとしての可読性・操作性・レスポンシブ性を優先。

---

## Color tokens (`client/src/theme/tokens.js`)

| Token | Value | Usage |
|-------|-------|-------|
| `paper` | `#FFFDF8` | カード・パネル背景 |
| `canvas` | `#F7F1E4` | 画面全体の背景 |
| `paperSubtle` | `#E9DECB` | secondary ボタン、入力背景のサブ |
| `wood` | `#D8C3A5` | 文具装飾 |
| `ink` | `#25211D` | 通常本文 |
| `navy` | `#18344B` | 補助見出し・副操作・ホスト強調 |
| `vermilion` | `#B83A2F` | 主要操作・提出・投票選択・正解・判子 |
| `green` | `#47745C` | 成功状態 |
| `blue` | `#5B86A5` | 補助情報 |
| `mustard` | `#C99A3D` | MVP・付箋 |
| `rose` | `#C88982` | 装飾・付箋 |
| `muted` | `#8E8B84` | 補助テキスト・無効状態 |
| `border` | `#D9CFC1` | 罫線・枠 |
| `white` | `#FFFFFF` | テキストの反転 |

---

## Typography (`client/src/theme/typography.js`)

| 用途 | フォントファミリー |
|------|------------------|
| タイトル・お題・正解 | iOS: `HiraMinProN-W3/W6` / Android: `serif` / Web: `BIZ UDPMincho`, `Noto Serif JP`, `serif` |
| UI見出し・本文・ボタン | iOS: `HiraginoSans-W3/W6` / Android: `sans-serif` / Web: `BIZ UDPGothic`, `Noto Sans JP`, `sans-serif` |

外部フォントのネットワーク読み込みは必須としない。システムフォントフォールバックで動作する。

---

## Responsive breakpoints

| 名称 | 幅 | レイアウト |
|------|----|----------|
| Mobile | < 768px | 1カラム |
| Tablet | 768–1023px | 2カラム |
| PC | ≥ 1024px | 2〜3カラム |

- PC最大コンテンツ幅: `1280px`
- Mobile基準: `390px`
- PC基準: `1440px`
- 主要操作の最小タップ領域: `44×44px`

`useResponsiveLayout` hook (`client/src/hooks/useResponsiveLayout.js`) で一元管理。各画面での独立した幅判定を禁止。

---

## Shared components (`client/src/components/ui/`)

### PaperPanel
- `variant: flat | elevated`
- 生成り紙色 (`#FFFDF8`)、罫線 (`#D9CFC1`)、軽い影
- 全カード・情報パネルに使用

### StationeryButton
- `variant: primary | secondary | ghost | disabled | loading`
- primary: vermilion背景・白テキスト
- secondary: paperSubtle背景・border枠・inkテキスト
- ghost: 透明背景・mutedテキスト
- 最小高さ: 44px
- `accessibilityRole="button"`, `accessibilityState={{ disabled }}`

### Stamp
- type: `仮 | 封 | 推 | 真 | 得 | 準備OK`
- 朱色丸印（`仮 封 推 真 得`）または横長印（`準備OK`）
- `animate` prop でスプリングアニメーション（提出・投票・公開の山場）
- 装飾として `accessibilityElementsHidden`

### StickyNote
- `color: blue | mustard | rose | green`
- 左border accent + 半透明背景
- 装飾用途: `accessibilityElementsHidden`

### PlayerCard
- `isMe`, `isHost`, `status: ready | submitted`
- ホストはnavyアバター
- 自分は navy枠

### TitleCard
- `variant: hidden | revealed | selected | correct | fake`
- correct時: vermilion枠 + `真` 判子
- selected時: vermilion枠 + `推` 判子
- 長いタイトルを `numberOfLines={4}` で安全に表示

### VoteOption
- `selected` 時: vermilion枠 + `推` 判子
- `accessibilityRole="radio"`, `accessibilityState={{ checked, disabled }}`

### TitleInputSheet
- お題（あらすじ）→ 罫線 → 入力欄 → 文字数 → 提出ボタン
- 提出後: `封` 判子 + 提出済みタイトル表示

### ScoreRow
- 順位・名前・増減・得点・（1位には `得` 判子）
- `isMe` で navy強調

### RoundHeader
- ラウンド数ピル（paperSubtle背景 navy文字）
- フェーズ名（大きめ）
- 出題者名（小さめ muted）

---

## Decorative components (`client/src/components/decor/StationeryDecor.js`)

- `Clip`: ダブルクリップ模倣（View 矩形+内枠）
- `MaskingTape`: 半透明帯（色・角度変更可）
- `Pencil`: 鉛筆形（mustard 長方形 + 三角tip）
- `Eraser`: 消しゴム（rose 矩形）
- `Bookmark`: しおり（vermilion 帯）

すべて `accessibilityElementsHidden`。外部画像URLに非依存。

---

## Screen layouts

### HomeScreen
**Mobile**: ロゴ（明朝）→ 付箋2枚 → PaperPanel（ニックネーム・CTA）→ ルールリンク → サーバー設定（折りたたみ）
**PC**: 左: ロゴ・説明・付箋・装飾ヒーロー領域 / 右: `width: 380px` フォームパネル

### LobbyScreen
**Mobile**: ルームコード（navy大文字）→ 参加者リスト → 設定パネル（ホストのみ）→ アクション
**PC**: 上部ルームコードカード / 左: プレイヤーグリッド（flex-wrap 3列）/ 右: 設定＋アクション

### GameScreen (ConfirmingPhase)
- ホスト: あらすじ確認 → 再取得 / 進む
- 非ホスト: 待機表示

### GameScreen (SelectingPhase)
- 出題者: あらすじ入力（Wikipedia自動取得）→ 提示 → 知ってる宣言待ち → 提出フェーズへ
- 回答者: あらすじ表示 → 知ってる！/ 知らない

### GameScreen (SubmittingPhase)
- 回答者: `TitleInputSheet` が主役
- 提出後: `封` 判子 + 提出済み表示
- 出題者: 提出数カウント表示

### GameScreen (VotingPhase)
**Mobile**: 候補縦リスト → 投票確定CTA
**PC**: 左main: あらすじ + 投票候補 / 右side: 進捗パネル
- 選択: `推` 判子 + vermilion枠

### GameScreen (RevealedPhase)
- 本物タイトル: navy背景 + `真` 判子（animate）
- PC: 左: 投票結果 + MVP / 右: 自分の得点 + スコアボード + 次ラウンドCTA
- Mobile: 縦積み同内容

### ResultScreen
- 優勝カード: `得` 判子 + 明朝大タイトル
- 全順位 ScoreRow リスト
- PC: 中央 maxWidth:600

### RulesScreen
- ノート番号付き手順（PaperPanel × セクション数）
- StickyNote で攻略ヒント
- PC: maxWidth:800 中央

---

## Motion

- StampコンポーネントのSpringアニメーション: 80ms遅延 → 1.15倍 → 1.0倍
- 全体的に 150〜300ms 以内のフェード・スプリング
- 常時揺れる装飾・背景動画なし

---

## Accessibility

- 主要 Touchable: `minHeight: 44`
- `accessibilityRole`, `accessibilityLabel`, `accessibilityState` を全ボタン・入力に付与
- 装飾要素: `accessibilityElementsHidden / importantForAccessibility="no-hide-descendants"`
- 色だけで状態を示さず、判子・枠・文言を併用
- `focusable` フォーカス枠: RN Web のデフォルト `:focus-visible` を維持

---

## Prohibited patterns

- `#FF3B5C` など旧メイン色の直書き禁止
- 外部画像URL・外部Webフォント必須化 禁止
- `server/**`, `supabase/**`, `.github/**` 変更禁止
- Socketイベント名・Navigation route名の変更禁止
- PC幅で中央にスマホ幅UIを置くだけの実装禁止

---

## Allowed paths (from Issue #3)

```
docs/UI_DESIGN_SPEC.md
client/App.js
client/src/theme/**
client/src/components/ui/**
client/src/components/decor/**
client/src/hooks/useResponsiveLayout.js
client/src/screens/HomeScreen.js
client/src/screens/LobbyScreen.js
client/src/screens/GameScreen.js
client/src/screens/ResultScreen.js
client/src/screens/RulesScreen.js
client/src/components/phases/**
```

# タイトルの名付け親は誰だ？

あらすじだけを見て「本物のタイトル」を当てるオンライン・パーティーゲームです。出題者が選んだ映画・小説・漫画などのあらすじを読み、残りのプレイヤーが本物らしい偽タイトルを考えて投票し合います。本物を見抜くことと、偽タイトルで他の参加者をだますことの両方が得点になります。

## 公開状況

- Webクライアント: `https://title-kakko-kari-46mastei-4511s-projects.vercel.app/`
- Renderサーバー: `https://title-kakko-kari.onrender.com`
- Renderの `/health` 応答とVercelの公開は確認済みです。
- 公開Vercelからの部屋作成は、Issue #11のCORS / Socket.IO接続修正が本番へ反映されるまで未確認です。現時点では「完全動作確認済み」とは扱いません。

## 対応人数

| 環境 | 最低人数 | 最大人数 |
|------|----------|----------|
| 通常（production / staging / test / その他） | **4人** | 6人 |
| ローカル開発テスト（明示opt-in） | 3人 | 6人 |

> 3人プレイはローカル開発専用です。Serverは `NODE_ENV=development` かつ `ALLOW_THREE_PLAYER_DEV=true`、Clientは開発ビルドかつ `EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV=true` の場合だけ3人開始を許可します。2人以下は常に拒否されます。

## ゲーム概要

1. ホストがルームを作成し、6桁のルームコードを参加者へ共有する
2. 4〜6人が揃ったら、ホストが出題形式を選んでゲームを開始する
3. 出題者があらすじを提示するか、CPU出題モードでWikipediaから取得する
4. 回答者が本物らしい偽タイトルを提出する
5. 本物と偽物が混ざった候補から全員が投票する
6. 正解点、欺き点、MVPボーナスを加算し、全ラウンド終了後の最多得点者が優勝する

## ローカル起動手順

### Serverの環境変数

`server/.env` に次の変数を設定します。Secretの値はリポジトリへ記録しません。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT`（省略時は3000）
- `NODE_ENV=development`
- `ALLOW_THREE_PLAYER_DEV=true`（3人テストを明示的に許可する場合だけ）

```bash
cd server
npm install
npm start
```

### Client

```bash
cd client
npm install
npx expo start
```

ブラウザで開く場合は `w` キーを押します。Server URLは現在 `client/src/config.js` のRender URLを既定値として使用し、ホーム画面の「サーバー設定」からローカルURLへ変更できます。

3人テスト用UIを有効にする場合だけ、Clientの開発環境へ次を設定します。

```text
EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV=true
```

`EXPO_PUBLIC_SERVER_URL` は現在の実装では読み込まないため、設定しても接続先は変わりません。

## Webビルド

```bash
cd client
npm ci
npm run build:web
# 出力: client/dist/
```

リポジトリルートの `vercel.json` には同じ静的ビルドとSPAフォールバックが定義されています。

## 検証

```bash
python scripts/public_export_guard.py .
python scripts/validate_repository.py
python -m unittest discover -s tests
cd client && npm ci && npm run build:web
```

GitHub ActionsではCIとUnit TestsをPull Requestの固定head SHAに対して実行します。

## デプロイ構成

| コンポーネント | ホスティング | 状況 |
|---|---|---|
| Client（Expo Web） | Vercel | 公開済み。main更新時の本番再デプロイ対象 |
| Server（Express / Socket.IO） | Render | `/health` 応答確認済み。Issue #11修正のmain反映後に再デプロイ対象 |
| データストア | Supabase | Serverの環境変数で接続 |

公開URL、未確認事項、Figma残件は [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md) にまとめています。

## デザイン

PC・スマートフォンの両方に対応した文具風レスポンシブUIを実装済みです。Figmaでは基礎デザインシステムと主要コンポーネントまで作成済みで、全画面の清書は残っていますが、コード公開のブロッカーにはしていません。

## 開発・自動化基盤

- GitHub ActionsによるCI / Unit Tests
- Claude CodeによるIssueドリブン実装
- 固定head SHAのCodexレビュー
- expected-head-SHAを使った保護付きマージ

詳細な運用規則は `AGENTS.md` と `docs/OPERATING_RULES.md` を参照してください。

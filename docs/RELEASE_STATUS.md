# Release Status

最終更新: 2026-08-02

## 実装済み

- ゲームコアロジック（Socket.io ベース）
- Supabase によるルーム・プレイヤー・ラウンド管理
- プレイヤー出題モード / CPU出題（Wikipedia）モード
- 採点・MVP選出・ゲーム終了フロー
- 文具風レスポンシブUI（モバイル・PC両対応）
- 参加人数バリデーション（Server・Client両方で実施）
  - 通常: 4〜6人
  - 開発opt-in（`NODE_ENV=development && ALLOW_THREE_PLAYER_DEV=true`）: 3〜6人
  - 2人以下: 常時拒否
- `vercel.json` による Expo Web 静的ビルド設定
- `client/package.json` の `build:web` スクリプト

## 検証済み

- Server の player count ロジック（`tests/test_player_count.py`）
- Client の MIN_PLAYERS 定数による UI 表示・判定の一致
- `vercel.json` の JSON 構文・build/output 設定
- CI / Unit Tests の通過

## 未確認事項

- Vercel 本番環境での Web ビルド・公開（人間操作が必要、下記参照）
- Render（Server）の本番稼働状況のリアルタイム確認
- Supabase 本番データベースの接続・スキーマ適用状況
- カスタムドメイン設定

## Figma 残件

- 基礎デザイントークン・主要コンポーネントは定義済み
- 全画面の清書デザインは未完了
- **Figma未完了はコード公開のブロッカーではない**（実装は既存UIで完成）

## 本番公開に必要な人間操作

### Vercel への Web 公開手順（リポジトリ側準備完了）

1. [vercel.com](https://vercel.com) にログインする
2. 「Add New Project」→ GitHub リポジトリ `shiroku46/title-kakko-kari` を選択する
3. 以下を確認する（`vercel.json` の設定が自動適用される）:
   - Build Command: `cd client && npm ci && npm run build:web`
   - Output Directory: `client/dist`
4. 必要に応じて環境変数 `EXPO_PUBLIC_SERVER_URL` を設定する（Server URL: `https://title-kakko-kari.onrender.com`）
5. 「Deploy」を実行する

> 上記の Vercel 操作はアカウント・課金に関わるため、リポジトリ側では自動化していません。

### Render（Server）の環境変数確認

- Render ダッシュボードで `SUPABASE_URL` および `SUPABASE_SERVICE_ROLE_KEY` が設定されていることを確認する
- `NODE_ENV=production` が設定されていることを確認する（未設定でも 4人必須として動作する）

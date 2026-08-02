# Release Status

最終更新: 2026-08-02

## 実装済み

- ゲームコアロジック（ラウンド進行・投票・採点）
- Socket.IO によるリアルタイム通信
- Supabase によるデータ永続化
- 文具風レスポンシブUI（PC・モバイル対応）
- プレイヤー出題モード / CPU出題モード（Wikipedia連携）
- 参加人数バリデーション（Server・Client両方）
  - 本番: 4〜6人必須
  - 開発opt-in時: 3〜6人
  - 2人以下: 常時拒否
- Expo Web静的ビルド設定（`vercel.json`、`client/package.json#build:web`）
- 製品向けREADME

## 検証済み

- CI（`ci.yml`）: パス・セキュリティ・ポリシー検査
- ユニットテスト（`unit-tests.yml`）: Pythonテスト
- ローカルServer起動
- ローカルClient起動（開発モード）
- `vercel.json` JSON形式・ビルド設定の妥当性

## 未確認

- Vercel本番デプロイ（URLの疎通・動作確認）
- Render本番Server（`https://title-kakko-kari.onrender.com`）の現在の稼働状況
- Vercel上でのExpo Webビルドの成否（CI環境外）
- モバイルネイティブ（iOS/Android）動作確認

## 本番公開に必要な人間操作

### Vercel（Clientのデプロイ）

1. [vercel.com](https://vercel.com) にログインし、このリポジトリをインポート
2. Framework Preset: `Other`
3. Root Directory: リポジトリルート（`vercel.json` が自動適用される）
4. 環境変数を設定:
   - `EXPO_PUBLIC_SERVER_URL` = 本番ServerのURL（例: `https://title-kakko-kari.onrender.com`）
   - `EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV` は**設定しない**（本番では3人プレイを許可しない）
5. デプロイ実行
6. 発行されたURLを確認・記録する

### Render（Server）

- 現在のデプロイURL: `https://title-kakko-kari.onrender.com`
- 環境変数（Render管理画面で設定済みのはず）:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NODE_ENV=production`
  - `ALLOW_THREE_PLAYER_DEV` は**設定しない**（本番では不要）

## Figma デザイン残件

- **完了**: 基礎デザインシステム（カラー・タイポグラフィ・スペーシング）、主要UIコンポーネント
- **未完了**: 全画面の清書（Figmaファイル内の全画面を高精度で仕上げること）
- **判断**: Figma全画面清書の未完了は、コードの公開ブロッカーではない。現行のコード実装UIで公開可能。

## ブロッカー

現時点でコード公開のブロッカーはありません。Vercelデプロイのみ人間操作が必要です。

# タイトルの名付け親は誰だ？

あらすじだけを見て「本物のタイトル」を当てるパーティーゲームです。出題者が選んだ映画・小説・漫画などのあらすじを読み、残りのプレイヤーがそれっぽい偽タイトルを考えて投票し合います。一番多く票を集めた偽タイトルの作者がポイントを獲得します。

## 対応人数

| 環境 | 最低人数 | 最大人数 |
|------|----------|----------|
| 通常（production / staging / test / その他） | **4人** | 6人 |
| ローカル開発テスト（明示opt-in） | 3人 | 6人 |

> **注意**: 3人プレイはローカル開発・テスト専用です。`NODE_ENV=development` かつ `ALLOW_THREE_PLAYER_DEV=true` の明示的な opt-in が必要です。2人以下での開始はすべての環境で禁止されています。

## ゲーム概要

1. ホストがルームを作成し、ルームコードを参加者に共有する
2. 4〜6人が揃ったらホストがゲームを開始する
3. 出題形式を選ぶ（プレイヤー出題 or CPU出題）
4. 出題者があらすじを提示し、回答者が偽タイトルを考えて提出する
5. 全員が投票し、本物タイトルを当てたプレイヤーと、票を集めた偽タイトル作者がポイント獲得
6. 全ラウンド終了後、最多ポイントのプレイヤーが優勝

## ローカル起動手順

### 必要な環境変数

`.env` ファイルを作成し、以下の変数名を設定してください（値はご自身の環境に合わせて設定してください。Secretを含むため値をここに記載しません）:

**Server** (`server/.env`):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT`（省略時: 3000）
- `NODE_ENV`
- `ALLOW_THREE_PLAYER_DEV`（3人プレイを許可する場合のみ `true`）

**Client** (`client/.env`):
- `EXPO_PUBLIC_SERVER_URL`（ServerのURL）
- `EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV`（3人プレイUIを有効にする場合のみ `true`）

### Server起動

```bash
cd server
npm install
npm start
```

### Client起動

```bash
cd client
npm install
npx expo start
```

ブラウザで開く場合は `w` キーを押してください。

## Webビルド手順

```bash
cd client
npm ci
npm run build:web
# 出力: client/dist/
```

または、リポジトリルートから Vercel 等の静的ホスティングへデプロイする場合は、`vercel.json` の設定に従って自動的にビルド・公開されます。

## 検証手順

```bash
# リポジトリガード・バリデーション
python scripts/public_export_guard.py .
python scripts/validate_repository.py

# ユニットテスト
python -m unittest discover -s tests

# Client依存関係のインストールとWebビルド
cd client && npm ci && npm run build:web
```

## デプロイ状況

| コンポーネント | 状況 | URL |
|--------------|------|-----|
| Server | Render にデプロイ済み | `https://title-kakko-kari.onrender.com` |
| Client（Web） | Vercel公開の準備完了（人間によるVercel Project接続が必要） | 未確認 |

> Vercel公開には Vercel アカウントでのプロジェクト接続が必要です。リポジトリ側の設定（`vercel.json`）は完了しています。詳細は `docs/RELEASE_STATUS.md` を参照してください。

## 開発・自動化基盤

- GitHub Actions による CI（`ci.yml`、`unit-tests.yml`）
- Claude Code による Issue ドリブン実装
- Supabase をデータストアとして使用

詳細なリリース状況・Figma残件・デプロイ操作手順は [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md) を参照してください。

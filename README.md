# タイトルの名付け親は誰だ？

映画・小説・アニメなどのあらすじを読み、本物のタイトルを当てるパーティーゲームです。
出題者が作品のあらすじを提示し、他のプレイヤーは「本物らしい偽タイトル」を投稿して互いに騙し合います。
本物のタイトルに投票したプレイヤーと、他プレイヤーから多く票を集めた偽タイトル作者が得点を獲得します。

## 対応人数

| 環境 | 人数 |
|------|------|
| 通常プレイ（本番） | **4〜6人** |
| ローカル開発テスト（opt-in） | **3〜6人** |

2人以下での開始は、開発環境でも禁止されています。

## ゲームの流れ

1. ホストがルームを作成し、4〜6人が参加する
2. 各プレイヤーが順番に出題者となり、作品のあらすじを提示する（プレイヤー出題モード）、またはWikipediaから自動取得（CPU出題モード）
3. 出題者以外の全員が「本物らしい偽タイトル」を投稿する
4. 全回答が表示され、各自が「本物のタイトル」だと思うものに投票する
5. 本物に投票した人と、多く票を集めた偽タイトル作者が得点を得る
6. 全ラウンド終了後、最多得点者が優勝

## ローカル起動手順

### 必要な環境変数

**Server (`server/.env`)**

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000
NODE_ENV=development
# 3人プレイを許可する場合のみ（開発用）
ALLOW_THREE_PLAYER_DEV=true
```

**Client (`client/.env.local`)**

```
EXPO_PUBLIC_SERVER_URL=http://localhost:3000
# 3人プレイを許可する場合のみ（開発用）
EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV=true
```

値やSecretをこのファイルに記載することはありません。

### Server起動

```bash
cd server
npm install
npm start
```

### Client起動（開発）

```bash
cd client
npm install
npm start
# ブラウザで開く場合: w キーを押す
```

## Webビルド手順

```bash
cd client
npm ci
npm run build:web
# 出力先: client/dist/
```

ルートの `vercel.json` により、Vercel上でも同等のビルドが実行されます。

## 検証手順

```bash
# パス・セキュリティ検査
python scripts/public_export_guard.py .
python scripts/validate_repository.py

# 自動テスト
python -m unittest discover -s tests

# クライアント依存関係・Webビルド確認
cd client && npm ci
cd client && npm run build:web
```

## デプロイ状況

| コンポーネント | 状況 |
|---------------|------|
| Server | Renderにデプロイ済み: `https://title-kakko-kari.onrender.com` |
| Client (Web) | Vercel設定ファイル準備済み。公開にはVercelプロジェクト作成とドメイン設定の手動操作が必要 |

Vercelでの公開手順（人間操作）:

1. Vercel にログインし、このリポジトリをインポートする
2. Framework Preset: `Other`
3. Root Directory: リポジトリルートのまま（`vercel.json` が自動適用される）
4. 環境変数 `EXPO_PUBLIC_SERVER_URL` に本番ServerのURLを設定する
5. デプロイ

## CI / テスト

GitHub Actionsにより以下が自動実行されます:

- `ci.yml`: パス・セキュリティ・ポリシー検査
- `unit-tests.yml`: Pythonユニットテスト

## 開発運用

このリポジトリはAI支援開発基盤を使用しています。Issue作成・`@claude` コメントによる自動実装・PR作成が可能です。詳細は `AGENTS.md` および `docs/OPERATING_RULES.md` を参照してください。

# Release Status

最終更新: 2026-08-03

## 公開URL

- Web Client: `https://title-kakko-kari-46mastei-4511s-projects.vercel.app/`
- Server: `https://title-kakko-kari.onrender.com`
- Health check: `https://title-kakko-kari.onrender.com/health`

VercelのDeployment Protectionは解除済みで、Renderの `/health` は `status: ok` を確認済みです。公開Vercelからの接続を妨げていたCORS / Socket.IO問題はIssue #11で修正され、mainへ反映済みです。部屋作成・参加を含む本番E2E確認が終わるまでは「完全動作確認済み」とは扱いません。

## 実装済み

- ゲームコアロジック（Socket.IOベース）
- Supabaseによるルーム・プレイヤー・ラウンド管理
- プレイヤー出題モード / CPU出題モード（Wikipedia連携）
- タイトル提出、投票、採点、MVP、ゲーム終了フロー
- 文具風レスポンシブUI（モバイル・PC対応）
- 公開Web接続のCORS / Socket.IO対策
- 参加人数バリデーション
  - 通常: 4〜6人
  - 開発opt-in: 3〜6人
  - 2人以下: 常時拒否
- Expo Web静的ビルドとSPAフォールバック
- 製品向けREADME

## 検証済み

- 通常環境では4人未満をClient / Serverの両方で拒否する実装
- `NODE_ENV=development` と明示opt-inの組み合わせだけ3人を許可する実装
- unset / test / staging / production / typo / その他環境は4人へfail closed
- CI / Unit Tests
- Expo Web build
- Vercel公開
- Render health check
- CORS / Socket.IO修正のmain反映

## 現在の未完了項目

### 公開環境E2E確認

残る確認は、最新mainがVercel / Renderへ反映された公開環境で次の操作が成立することです。

- Vercel originから `/health` を取得できる
- Socket.IO handshakeが成功する
- 「ルームを作る」で6桁コードを持つLobbyへ遷移する
- 別ブラウザまたは別端末から同じコードで参加する
- 4人未満では本番ゲーム開始を拒否し、4〜6人で開始できる

この確認が終わるまでは、MVPを「完全動作確認済み」とは扱いません。

## Server URLの設定方法

現在のClientは `client/src/config.js` にあるRender URLを既定値として使用します。ホーム画面の「サーバー設定」から接続先を変更できます。

`EXPO_PUBLIC_SERVER_URL` は現在の実装では読み込まないため、Vercelやローカル環境へ設定しても接続先変更には使われません。

## Figma残件

- 完了: 基礎デザイントークン、タイポグラフィ、主要UIコンポーネント
- 未完了: 全スマートフォン画面・PC画面のFigma上での高精度な清書
- 判断: Figma全画面清書はドキュメント残件であり、コード公開や部屋作成修正のブロッカーにはしない

## デプロイ後の確認項目

1. 公開URLをシークレットウィンドウで開ける
2. ニックネームを入力してルームを作成できる
3. 別ブラウザまたは別端末から6桁コードで参加できる
4. 4人未満では本番ゲームを開始できない
5. 4〜6人でプレイヤー出題 / CPU出題を開始できる
6. 提出、投票、結果発表、最終順位まで進行できる

## 人間操作が必要になる可能性がある箇所

GitHub連携によるVercel / Renderの自動デプロイが有効なら、mainへのマージ後は通常自動で反映されます。自動デプロイされない場合に限り、各サービスのダッシュボードから最新mainの再デプロイが必要です。Secret値をチャットやIssueへ記載してはいけません。

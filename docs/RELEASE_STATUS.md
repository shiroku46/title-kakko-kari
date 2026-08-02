# Release Status

最終更新: 2026-08-03

## 公開URL

- Web Client: `https://title-kakko-kari-46mastei-4511s-projects.vercel.app/`
- Server: `https://title-kakko-kari.onrender.com`
- Health check: `https://title-kakko-kari.onrender.com/health`

VercelのDeployment Protectionは解除済みで、Renderの `/health` は `status: ok` を確認済みです。公開Vercelからの部屋作成はIssue #11のCORS / Socket.IO接続修正がmainと本番へ反映された後に最終確認します。

## 実装済み

- ゲームコアロジック（Socket.IOベース）
- Supabaseによるルーム・プレイヤー・ラウンド管理
- プレイヤー出題モード / CPU出題モード（Wikipedia連携）
- タイトル提出、投票、採点、MVP、ゲーム終了フロー
- 文具風レスポンシブUI（モバイル・PC対応）
- 参加人数バリデーション
  - 通常: 4〜6人
  - 開発opt-in: 3〜6人
  - 2人以下: 常時拒否
- Expo Web静的ビルドとSPAフォールバック
- 製品向けREADME

## 検証済み

- 通常環境では4人未満をClient / Serverの両方で拒否
- `NODE_ENV=development` と明示opt-inの組み合わせだけ3人を許可
- unset / test / staging / production / typo / その他環境は4人へfail closed
- CI / Unit Tests
- Expo Web build
- Vercel公開
- Render health check

## 現在の未完了項目

### Issue #11: 公開環境からの部屋作成

原因は、Expressの通常HTTPルートへCORSミドルウェアが設定されておらず、Vercel originからのhealth fetchがブラウザで拒否されることです。Socket.IOのtransport順序と接続失敗時のエラー処理も併せて修正中です。

完了条件:

- CORS / Socket.IO修正がmainへマージされる
- Renderが最新mainを再デプロイする
- Vercel公開画面で「ルームを作る」が成功する
- 6桁ルームコードを持つLobbyへ遷移する

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

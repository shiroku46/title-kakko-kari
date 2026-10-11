# Neon 永続保存と実アカウント認証（Issue #95 作業中）

基準は公開済み PR94 の main `9f832a248452bcca2c97f2096b274f5036d5065b`（候補 head `2eef2e43d547cfd4eb6fb4d2a1a974bac036860f`）。この追加候補の公開前検証を記録する。公開状況は PR と本番 release の exact SHA で照合する。接続復帰の一時 ACK タイムアウト対策、Neon 保存、実認証を順に検証する。

所有者承認済み専用 DB: `title-kakko-kari-state` / Neon project `tiny-glade-78655721` / Oregon。無料枠だけを使用し、課金・他ゲーム保存先・既存 SUPABASE_* 設定は変更しない。Render `DATABASE_URL` は保存済み（再デプロイなし）。担当チャットで TLS 証明書検証付き SELECT 1 と旧認証情報の拒否を確認済み。

## 設定作業を担当するチャット向けの非秘密の構成

ゲームサーバー `https://title-kakko-kari.onrender.com` の Render Environment:

| 設定名 | 用途 | 現状 |
|---|---|---|
| `DATABASE_URL` | 上記専用 Neon DB の接続情報。フロントへ渡さない | 設定済み。空値は利用不可 |
| `BETTER_AUTH_URL` | 自前 Better Auth の公開ベース URL。予定値 `https://title-kakko-kari.vercel.app`、パス `/api/auth` | コードに実装済み、Render では未設定 |
| `BETTER_AUTH_SECRET` | 認証セッション署名用、32文字以上の秘密値 | 未設定。値をチャットへ貼らない |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | 所有者の Discord OAuth アプリ設定 | 未設定。新規プロバイダー登録/権限は担当チャットで確認 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | メール確認・パスワード再設定の実メール送信 | 未設定。送信元が実際に送信を許可されていることが必要 |

Discord OAuth の redirect URL 確定値は `https://title-kakko-kari.vercel.app/api/auth/callback/discord`。必要な scope は `identify` と `email`。Bot 導入やサーバー管理権限は不要。

Neon Managed Better Auth は現在 Discord に対応しないため、同じ専用 Postgres 上でメール/Discordを扱う自前 Better Auth を候補とする。Neon Auth の有効化は不要。未設定プロバイダーは利用可能にしない。メール確認・送信設定が不足した状態を「実メールログイン完成」と報告しない。

Vercel は `/api/auth/:path*` を既存 Render の同パスへ転送する実装。ブラウザー側の認証 Cookie をゲームの同じオリジンで扱い、第三者 Cookie 制限に依存させない。Vercel に DB や OAuth の秘密値は不要。ゲーム接続は引き続き既存 Socket.IO を使用する。設定名・URLはコード/実接続で検証後に確定する。

## 保存の設計と未検証境界

既存の JSON/Map 変換・保存成功後の配信・失敗巻戻しを再利用する。DB 保存中は全ルームの更新を直列化し、復帰、タイマー、CPU取得完了、退出が未保存状態を読んだり上書きしないようにする。DB の世代とコミット ID により古いサーバーの書込と応答不明時の二重適用を拒否する。起動時の DB 取得失敗や壊れた snapshot を空データで上書きしない。

現在の PR94 のファイル保存は Render インスタンス置換後の保証がない。Neon 版の実 DB 通信と公開サーバー再起動後の状態復元は未検証。単体モックの成功を本番永続保存の成功と扱わない。

## 一次資料

- [Neon Free の制限と超過動作](https://neon.com/docs/introduction/plans): 月100 CU時間、1 GB/プロジェクト、月5 GB送信。5分無操作で DB 休止、枠超過で停止。無料は無制限ではない。
- [Neon Auth roadmap](https://neon.com/docs/auth/roadmap)
- [Better Auth Discord](https://better-auth.com/docs/authentication/discord)
- [Better Auth Email/Password](https://better-auth.com/docs/authentication/email-password)
- [Better Auth Express](https://better-auth.com/docs/integrations/express)

## 起動・復帰・切戻し

`DATABASE_URL` が存在する本番では Neon 初期化・保存データ検証が終わるまで listen しない。空値や DB 障害はファイル保存へ切り替えず起動失敗とする。`GET /health` の `storage.mode=neon`、`storage.ready=true` と release を確認する。署名/SMTP/Discord が未設定なら `GET /api/auth/status` は利用不可を返し、ゲームのゲスト入室だけを提供する。

新しいサーバー起動は DB の writer ID を更新し、以前のインスタンスの保存を拒否する。旧インスタンスを再起動で復旧させる場合も同じ検証が必要。保存結果が確認できない状態では部屋の読取/変更を止め、DB を保全してサーバーを再起動する。通信断だけなら明示退出せず同じ画面で待つか、ホームの「前の部屋に戻る」を使う。席は24時間の復帰期限を持ち、本人の明示退出で失効する。

切戻しは検証済みコードへの scoped revert PR で行い、Neon テーブルや `DATABASE_URL` を削除しない。ファイル版への切戻しは DB の状態を復元できないため、運用停止と移行判断が必要。ゲーム snapshot と認証テーブルは非公開で、Cookie・復帰 token・メール・パスワード hash・DB 接続情報を公開成果物に含めない。

## 検証状況

復帰 ACK 10秒超過の実 Socket.IO 再試行、保存失敗の巻戻し、非同期保存中の順序、古い writer の拒否、コミット後の応答消失・結果不明をローカル回帰で確認。短い断線中の送信待ち操作はラウンド UUID の照合で拒否する。初期投票人数も適格な人間回答者数で通知する。

実 Better Auth の署名 Cookie、メール確認 API、ハッシュ化パスワード、記憶セッション、プロフィール変更、他 origin 拒否をローカル DB と試験メール送信先で検証。実 SMTP 配信、所有者 Discord OAuth、公開 URL のアカウントログインは設定待ちであり未完了。Managed Neon Auth を設定する必要はない。

試験では本番/開発の `DATABASE_URL` と `.env` をファイル保存用の隔離プロセスへ渡さない。Node20もサーバーの対応範囲に含む。`node:sqlite` のないNodeでは認証の実DB試験だけを明示的に skip し、Node22.5以上（今回Node24）で必ず実行する。Neon adapter試験と認証設定試験はNode20でも実行する。

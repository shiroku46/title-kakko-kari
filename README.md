# タイトルたほいや（仮）

あらすじだけを見て「本物のタイトル」を当てるオンライン・パーティーゲームです。出題者が選んだ作品のあらすじを読み、回答者が本物らしい偽タイトルを提出して投票します。

仕様・制作方針の正本は Notion「タイトルたほいや｜命名クイズゲーム制作」、実装状態の正本はこのリポジトリです。

## 現在の構成

- Client: Expo Web / React Native、公開先はVercel。
- Server: Express / Socket.IO、公開先はRender。
- ゲーム中の部屋、参加者、ラウンド、提出、投票、得点はサーバーのメモリで管理します。**Supabase、データベースの接続設定、新しい保存サービスは不要です。**
- **サーバーは1プロセス・1インスタンスで運用します。再起動・休止・再デプロイ時には部屋と得点が消えるため、部屋を作り直してください。** 最後の参加者が切断した部屋は削除します。
- 途中切断後の本人確認付き復帰、履歴保存、複数インスタンスでの状態共有は未対応です。現行クライアントと同様、切断後はホームへ戻り、新しい接続として扱います。

移行理由・責務の棚卸し・検証範囲は [移行記録](docs/SUPABASE_REMOVAL.md)、公開版との区別は [Release Status](docs/RELEASE_STATUS.md) を参照してください。

## 対応人数

| 環境 | 最低人数 | 最大人数 |
|---|---|---|
| 通常（production / staging / test / その他） | **4人** | 6人 |
| ローカル開発テスト（明示opt-in） | 3人 | 6人 |

3人プレイはServerが `NODE_ENV=development` かつ `ALLOW_THREE_PLAYER_DEV=true`、Clientが開発ビルドかつ `EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV=true` の場合だけ有効です。2人以下は常に拒否します。

## 遊び方

1. ホストが部屋を作り、6桁コードを共有する。
2. 4〜6人でプレイヤー出題またはCPU出題を開始する。
3. プレイヤー出題は、あらすじを提示し、全員の「知らない」宣言後に進む。「知ってる」があれば選び直す。CPU出題はホストがWikipediaのあらすじを確認する。
4. 回答者が偽タイトルを提出し、本物と混ざった候補から投票する。出題者は回答・投票を行わない。
5. 正解に1点、偽タイトルに投票された数だけ加点する。プレイヤー出題では出題者がMVPに1点を贈れる。
6. プレイヤー出題は全員1回ずつ、CPU出題は指定ラウンドを終えたら最終順位を表示する。

## ローカル起動

Node.js 20〜24を使用します。データベースの準備は不要です。

```bash
cd server
npm ci
npm start
```

`server/.env` は任意です。使える設定は `PORT`（既定3000）、`NODE_ENV`、`ALLOW_THREE_PLAYER_DEV`、`ALLOWED_ORIGINS`（カンマ区切りのWeb origin）です。公開運用では `ALLOWED_ORIGINS` にClientのURLを指定してください。古いSupabaseの環境変数は読み込みません。Secret値をリポジトリへ記録しないでください。

別のターミナルでClientを起動します。

```bash
cd client
npm ci
npm run web
```

ホームの「サーバー設定」で接続先を `http://localhost:3000` に変更してください。スマートフォン実機ではPCのLAN上のIPを指定します。既定の接続先は `client/src/config.js` のRender URLです。`EXPO_PUBLIC_SERVER_URL` は読み込みません。

## 検証とWebビルド

```bash
python scripts/public_export_guard.py .
python scripts/validate_repository.py
python -m unittest discover -s tests
npm ci --prefix server
npm ci --prefix client
npm test --prefix server
npm run build:web --prefix client
```

通信テストは実際のExpress / Socket.IOサーバーを起動し、4・5・6人の両出題モードを最終順位まで検証します。CPUのWikipedia応答だけは固定データに差し替えます。Socket.IOテストクライアントは既存のClient依存を使うため、両方の `npm ci` が必要です。

Web出力は `client/dist/` です。VercelのProject Root Directoryは `client`。単一Renderサーバーへの接続とWebSocket / polling双方の許可が必要です。

## 公開版

- [Web Client](https://title-kakko-kari-46mastei-4511s-projects.vercel.app/)
- [Server health](https://title-kakko-kari.onrender.com/health)

Supabase撤去版の公開反映・公開環境E2Eは未完了です。ローカル検証成功を公開版完成とは扱いません。Issue #37は公開環境で最終順位まで確認するまで継続します。

## デザイン・開発運用

PC・スマートフォンに対応した文具風UIを継続使用します。Figma全画面清書は残件ですが、今回の移行を止める条件ではありません。開発運用は `AGENTS.md` と `docs/OPERATING_RULES.md` を参照してください。

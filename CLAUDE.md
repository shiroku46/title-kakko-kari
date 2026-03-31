# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

命名系クイズゲーム「タイトルカッコカリ」のスマートフォン向けマルチプレイアプリ。
実在するマイナーな作品のあらすじから本物タイトルを当てるゲーム。偽タイトルで他人を欺き、本物を見抜いた数でポイントを競う。

## 技術スタック

- **フロントエンド**: React Native (Expo) ※未実装
- **バックエンド**: Node.js + Express + Socket.io (`server/`)
- **データベース**: Supabase (PostgreSQL)
- **リアルタイム通信**: Socket.io WebSocket

## サーバーの起動コマンド

```bash
cd server
cp .env.example .env   # 初回のみ：Supabase の URL と key を記入
npm install            # 初回のみ
npm run dev            # 開発（--watch で自動再起動）
npm start              # 本番
```

## サーバーのファイル構成

```
server/src/
├── index.js                  # Express + Socket.io の起動
├── db/supabase.js            # Supabase クライアント（service_role キー使用）
├── utils/shuffle.js          # Fisher-Yates シャッフル
└── socket/
    ├── index.js              # Socket.io 接続・切断管理
    ├── roomHandlers.js       # room:create / room:join / room:get_state
    └── gameHandlers.js       # ゲーム進行ロジック全般
```

## ゲームのフェーズと Socket.io イベント

### フェーズ遷移

```
waiting → playing
  └─ Round: selecting → submitting → voting → revealed
       └─ 全ラウンド終了 → finished
```

### クライアント → サーバー

| イベント | 送信者 | 内容 |
|---|---|---|
| `room:create` | 誰でも | `{ nickname }` |
| `room:join` | 誰でも | `{ code, nickname }` |
| `game:start` | ホストのみ | - |
| `round:submit_synopsis` | 出題者 | `{ synopsis, realTitle }` |
| `round:declare_known` | 回答者 | - |
| `round:reselect` | 出題者 | - |
| `round:start_submitting` | 出題者 | - |
| `round:submit_fake` | 回答者 | `{ title }` |
| `round:submit_vote` | 回答者 | `{ answerId }` |
| `game:next_round` | 出題者 or ホスト | - |

### サーバー → クライアント（全員 or 特定ソケット）

| イベント | 内容 |
|---|---|
| `room:player_joined` | 新プレイヤー参加 |
| `room:player_disconnected` | プレイヤー切断 |
| `game:started` | ゲーム開始・出題順 |
| `game:round_started` | 次ラウンド開始 |
| `round:synopsis_presented` | あらすじ提示（realTitle は含まない） |
| `round:known_declared` | タイトル知ってる宣言 |
| `round:reselect_started` | 作品選び直し開始 |
| `round:submitting_started` | 偽タイトル提出フェーズ開始 |
| `round:fake_submitted` | 偽タイトル進捗（出題者のみ） |
| `round:choices_presented` | 全選択肢提示（is_real 含まない） |
| `round:vote_progress` | 投票進捗（全員） |
| `round:revealed` | 正解・投票・スコア全公開 |
| `game:finished` | ゲーム終了・最終スコア |

## データベース設計の重要ポイント

- `rounds.real_title` はサーバー内部のみで参照し、フロントへは絶対に送らない
- `answers` テーブルは偽タイトル（各回答者1件）＋ 本物タイトル（`is_real=true`, `player_id=null`）の両方を格納する
- 本物タイトルは `round:start_submitting` → `submitting` 完了時に `transitionToVoting()` の中で挿入する
- スコア計算は Supabase の `calculate_and_apply_round_scores(p_round_id)` RPC で行う
  - 正解ポイント: 本物タイトルに投票した回答者 +1pt
  - 欺きポイント: 自分の偽タイトルへの投票数と同数 +Npt
- ルームコードは `generate_room_code()` RPC で生成（紛らわしい文字を除外した6桁）

## スコアリングルール

基本ルール:
- 本物タイトルに投票できた回答者: **+1pt**
- 自分の偽タイトルに投票された数: **+N pt**（N = 投票人数）

アレンジルール（settings JSONB で管理、v2以降実装予定）:
- 単独正解ボーナス: 一人だけ正解で +1pt
- 計略家ボーナス: 全員が自分の偽タイトルに投票で +2pt
- 完全試合ボーナス: 上記両立でそのラウンドのポイント×2
- MVPボーナス: 一番好きな偽タイトル投票で +1pt

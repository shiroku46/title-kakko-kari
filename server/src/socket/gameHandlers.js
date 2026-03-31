const supabase = require('../db/supabase');
const { shuffle } = require('../utils/shuffle');

// ============================================================
// 宣言トラッキング（インメモリ）
// roundId -> { known: Set<playerId>, unknown: Set<playerId> }
// ============================================================
const roundDeclarations = new Map();

// ============================================================
// ゲームイベントハンドラー
// ============================================================

function registerGameHandlers(io, socket) {
  // ----------------------------------------------------------
  // ゲーム開始（ホストのみ）
  // ----------------------------------------------------------
  socket.on('game:start', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const { data: room, error } = await supabase
        .from('rooms')
        .select('*, players(*)')
        .eq('code', roomCode)
        .single();
      if (error) throw error;

      // ホスト確認
      const me = room.players.find((p) => p.id === playerId);
      if (!me?.is_host) throw new Error('ゲーム開始はホストのみ操作できます');
      if (room.status !== 'waiting') throw new Error('すでにゲームが開始しています');

      const connectedPlayers = room.players.filter((p) => p.is_connected);
      if (connectedPlayers.length < 2) throw new Error('最低2人が必要です（推奨4〜6人）');

      // 出題順をシャッフルして turn_order を割り当て
      const shuffledPlayers = shuffle(connectedPlayers);
      for (let i = 0; i < shuffledPlayers.length; i++) {
        await supabase
          .from('players')
          .update({ turn_order: i + 1 })
          .eq('id', shuffledPlayers[i].id);
      }

      const totalRounds = shuffledPlayers.length;

      // ルームをゲーム中に更新
      await supabase
        .from('rooms')
        .update({ status: 'playing', current_round: 1, total_rounds: totalRounds })
        .eq('id', room.id);

      // 第1ラウンドを作成
      const firstQuestioner = shuffledPlayers[0];
      const { data: round, error: roundError } = await supabase
        .from('rounds')
        .insert({
          room_id: room.id,
          round_number: 1,
          questioner_id: firstQuestioner.id,
          status: 'selecting'
        })
        .select()
        .single();
      if (roundError) throw roundError;

      const playerOrder = shuffledPlayers.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        turnOrder: p.turn_order ?? shuffledPlayers.indexOf(p) + 1
      }));

      console.log(`[Game] 開始: ${roomCode} / ${totalRounds}ラウンド`);
      io.to(roomCode).emit('game:started', {
        totalRounds,
        currentRound: 1,
        questioner: { id: firstQuestioner.id, nickname: firstQuestioner.nickname },
        round,
        playerOrder
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[game:start]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // あらすじ提出（出題者）
  // クライアント送信: { synopsis: string, realTitle: string }
  //
  // ※ realTitle はこのサーバーのみが保持し、フロントへは送らない
  // ----------------------------------------------------------
  socket.on('round:submit_synopsis', async ({ synopsis, realTitle }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'selecting') throw new Error('現在この操作はできません');
      if (!synopsis?.trim()) throw new Error('あらすじを入力してください');
      if (!realTitle?.trim()) throw new Error('本物のタイトルを入力してください');

      // あらすじと本物タイトルをDBに保存（real_title はフロントに送出しない）
      await supabase
        .from('rounds')
        .update({ synopsis: synopsis.trim(), real_title: realTitle.trim() })
        .eq('id', round.id);

      // 回答者へはあらすじのみ送信
      io.to(roomCode).emit('round:synopsis_presented', {
        roundId: round.id,
        synopsis: synopsis.trim()
      });

      console.log(`[Round] あらすじ提示: ${roomCode} R${round.round_number}`);
      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:submit_synopsis]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // タイトルを知っている宣言（回答者）
  // ----------------------------------------------------------
  socket.on('round:declare_known', async (_, callback) => {
    try {
      const { playerId, nickname, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者はこの操作を行えません');
      if (round.status !== 'selecting') throw new Error('あらすじが提示されていません');
      if (!round.synopsis) throw new Error('あらすじが提示されていません');

      // 宣言を記録
      if (!roundDeclarations.has(round.id)) {
        roundDeclarations.set(round.id, { known: new Set(), unknown: new Set() });
      }
      const decl = roundDeclarations.get(round.id);
      decl.unknown.delete(playerId);
      decl.known.add(playerId);

      io.to(roomCode).emit('round:known_declared', { player: { id: playerId, nickname } });

      console.log(`[Round] 知ってる宣言: ${nickname} / ${roomCode}`);
      callback?.({ ok: true });

      await checkAllDeclared(io, roomCode, round);
    } catch (err) {
      console.error('[round:declare_known]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // タイトルを知らない宣言（回答者）
  // 全員が宣言し終わったら round:all_declared を emit
  // ----------------------------------------------------------
  socket.on('round:declare_unknown', async (_, callback) => {
    try {
      const { playerId, nickname, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者はこの操作を行えません');
      if (round.status !== 'selecting') throw new Error('あらすじが提示されていません');
      if (!round.synopsis) throw new Error('あらすじが提示されていません');

      // 宣言を記録
      if (!roundDeclarations.has(round.id)) {
        roundDeclarations.set(round.id, { known: new Set(), unknown: new Set() });
      }
      const decl = roundDeclarations.get(round.id);
      decl.known.delete(playerId);
      decl.unknown.add(playerId);

      io.to(roomCode).emit('round:unknown_declared', { player: { id: playerId, nickname } });

      console.log(`[Round] 知らない宣言: ${nickname} / ${roomCode}`);
      callback?.({ ok: true });

      await checkAllDeclared(io, roomCode, round);
    } catch (err) {
      console.error('[round:declare_unknown]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 作品の選び直し（出題者）
  // 宣言があった場合に出題者がトリガーする
  // ----------------------------------------------------------
  socket.on('round:reselect', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'selecting') throw new Error('現在この操作はできません');

      // あらすじと本物タイトルをリセット・宣言状態もリセット
      await supabase
        .from('rounds')
        .update({ synopsis: null, real_title: null })
        .eq('id', round.id);

      roundDeclarations.delete(round.id);

      io.to(roomCode).emit('round:reselect_started', {
        message: '出題者が新しい作品を選んでいます...'
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:reselect]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 偽タイトル提出フェーズへ移行（出題者）
  // 宣言が誰もなかったことを確認してから呼ぶ
  // ----------------------------------------------------------
  socket.on('round:start_submitting', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'selecting') throw new Error('現在この操作はできません');
      if (!round.synopsis || !round.real_title) throw new Error('あらすじが設定されていません');

      // 「知ってる」宣言者がいたら進めない
      const decl = roundDeclarations.get(round.id);
      if (decl && decl.known.size > 0) {
        throw new Error('「知ってる！」宣言をしたプレイヤーがいます。作品を選び直してください');
      }

      await supabase
        .from('rounds')
        .update({ status: 'submitting' })
        .eq('id', round.id);

      io.to(roomCode).emit('round:submitting_started', {
        roundId: round.id
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:start_submitting]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 偽タイトル提出（回答者）
  // クライアント送信: { title: string }
  // 全員提出完了で自動的に投票フェーズへ移行する
  // ----------------------------------------------------------
  socket.on('round:submit_fake', async ({ title }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者は偽タイトルを提出できません');
      if (round.status !== 'submitting') throw new Error('現在この操作はできません');
      if (!title?.trim()) throw new Error('タイトルを入力してください');

      // 偽タイトルをDBに保存
      const { error } = await supabase
        .from('answers')
        .insert({
          round_id: round.id,
          player_id: playerId,
          title: title.trim(),
          is_real: false
        });
      if (error) {
        // UNIQUE制約エラー = すでに提出済み
        if (error.code === '23505') throw new Error('すでに偽タイトルを提出しています');
        throw error;
      }

      // 提出済み件数と必要件数をカウント
      const { data: room } = await supabase
        .from('rooms')
        .select('players(*)')
        .eq('code', roomCode)
        .single();
      const { data: submittedAnswers } = await supabase
        .from('answers')
        .select('id', { count: 'exact' })
        .eq('round_id', round.id)
        .eq('is_real', false);

      const answererCount = room.players.filter(
        (p) => p.id !== round.questioner_id && p.is_connected
      ).length;
      const submittedCount = submittedAnswers.length;

      // 出題者に進捗を通知（回答者には件数のみ。内容は非公開）
      const { data: questioner } = await supabase
        .from('players')
        .select('socket_id')
        .eq('id', round.questioner_id)
        .single();
      if (questioner?.socket_id) {
        io.to(questioner.socket_id).emit('round:fake_submitted', {
          submittedCount,
          totalCount: answererCount
        });
      }

      // 全員提出完了 → 投票フェーズへ自動移行
      if (submittedCount >= answererCount) {
        await transitionToVoting(io, roomCode, round);
      }

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:submit_fake]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 投票（回答者）
  // クライアント送信: { answerId: string }
  // 全員投票完了で自動的に結果公開へ移行する
  // ----------------------------------------------------------
  socket.on('round:submit_vote', async ({ answerId }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者は投票できません');
      if (round.status !== 'voting') throw new Error('現在投票フェーズではありません');

      // 投票をDBに保存
      const { error } = await supabase
        .from('votes')
        .insert({ round_id: round.id, voter_id: playerId, answer_id: answerId });
      if (error) {
        if (error.code === '23505') throw new Error('すでに投票しています');
        throw error;
      }

      // 投票済み件数をカウント
      const { data: room } = await supabase
        .from('rooms')
        .select('players(*)')
        .eq('code', roomCode)
        .single();
      const { data: votes } = await supabase
        .from('votes')
        .select('id', { count: 'exact' })
        .eq('round_id', round.id);

      const answererCount = room.players.filter(
        (p) => p.id !== round.questioner_id && p.is_connected
      ).length;
      const votedCount = votes.length;

      // 全員に投票進捗を通知
      io.to(roomCode).emit('round:vote_progress', {
        votedCount,
        totalCount: answererCount
      });

      // 全員投票完了 → 結果公開
      if (votedCount >= answererCount) {
        await revealRound(io, roomCode, round);
      }

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:submit_vote]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // MVP選出（出題者のみ）
  // クライアント送信: { answerId: string }
  // 一番気に入った偽タイトルに +1pt を贈る（任意・1回限り）
  // ----------------------------------------------------------
  socket.on('round:submit_mvp', async ({ answerId }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'revealed') throw new Error('結果公開フェーズ以外では操作できません');

      // 対象の回答が「このラウンドの偽タイトル」かを確認
      const { data: answer, error: answerError } = await supabase
        .from('answers')
        .select('id, title, player_id, players(id, nickname)')
        .eq('id', answerId)
        .eq('round_id', round.id)
        .eq('is_real', false)
        .single();
      if (answerError || !answer) throw new Error('選択した回答が見つかりません');
      if (!answer.player_id) throw new Error('本物タイトルにはMVPを贈れません');

      // +1pt（現在のスコアを取得してインクリメント）
      const { data: targetPlayer } = await supabase
        .from('players')
        .select('score')
        .eq('id', answer.player_id)
        .single();
      await supabase
        .from('players')
        .update({ score: (targetPlayer.score ?? 0) + 1 })
        .eq('id', answer.player_id);

      // 更新後の全スコアを取得
      const { data: room } = await supabase
        .from('rooms')
        .select('id')
        .eq('code', roomCode)
        .single();
      const { data: players } = await supabase
        .from('players')
        .select('id, nickname, score')
        .eq('room_id', room.id)
        .order('score', { ascending: false });

      console.log(`[Round] MVP: ${answer.players.nickname} / ${roomCode}`);
      io.to(roomCode).emit('round:mvp_selected', {
        answerId: answer.id,
        answerTitle: answer.title,
        playerNickname: answer.players.nickname,
        playerId: answer.player_id,
        playerScores: players,
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:submit_mvp]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 次のラウンドへ（現在の出題者またはホストが操作）
  // 結果確認後にトリガーする
  // ----------------------------------------------------------
  socket.on('game:next_round', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const { data: room } = await supabase
        .from('rooms')
        .select('*, players(*)')
        .eq('code', roomCode)
        .single();

      // 現在の出題者またはホストのみ操作可能
      const currentQuestioner = await getCurrentQuestioner(roomCode);
      const me = room.players.find((p) => p.id === playerId);
      if (currentQuestioner?.id !== playerId && !me?.is_host) {
        throw new Error('次のラウンドへの移行は出題者またはホストのみ操作できます');
      }

      // 全ラウンド終了チェック
      if (room.current_round >= room.total_rounds) {
        await endGame(io, roomCode, room);
        return callback?.({ ok: true });
      }

      // 次のラウンドを作成
      const nextRoundNumber = room.current_round + 1;
      const nextQuestioner = room.players.find((p) => p.turn_order === nextRoundNumber);

      await supabase
        .from('rooms')
        .update({ current_round: nextRoundNumber })
        .eq('id', room.id);

      const { data: nextRound, error: roundError } = await supabase
        .from('rounds')
        .insert({
          room_id: room.id,
          round_number: nextRoundNumber,
          questioner_id: nextQuestioner.id,
          status: 'selecting'
        })
        .select()
        .single();
      if (roundError) throw roundError;

      console.log(`[Game] ラウンド ${nextRoundNumber} 開始: ${roomCode}`);
      io.to(roomCode).emit('game:round_started', {
        currentRound: nextRoundNumber,
        totalRounds: room.total_rounds,
        questioner: { id: nextQuestioner.id, nickname: nextQuestioner.nickname },
        round: nextRound
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[game:next_round]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });
}

// ============================================================
// 内部ヘルパー関数
// ============================================================

/**
 * 全員が知ってる/知らないを宣言したか確認し、完了なら round:all_declared を emit
 */
async function checkAllDeclared(io, roomCode, round) {
  const { data: room } = await supabase
    .from('rooms')
    .select('players(*)')
    .eq('code', roomCode)
    .single();

  const answerers = room.players.filter(
    (p) => p.id !== round.questioner_id && p.is_connected
  );

  const decl = roundDeclarations.get(round.id);
  if (!decl) return;

  const declaredCount = decl.known.size + decl.unknown.size;
  const knownList = [...decl.known];

  if (declaredCount >= answerers.length) {
    io.to(roomCode).emit('round:all_declared', {
      knownPlayerIds: knownList,
      declaredCount,
      totalCount: answerers.length,
    });
    console.log(`[Round] 全員宣言完了: ${roomCode} known=${knownList.length}/${answerers.length}`);
  }
}

/**
 * 現在進行中のラウンドを取得する
 */
async function getCurrentRound(roomCode) {
  const { data: room } = await supabase
    .from('rooms')
    .select('id, current_round')
    .eq('code', roomCode)
    .single();

  const { data: round, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('room_id', room.id)
    .eq('round_number', room.current_round)
    .single();

  if (error || !round) throw new Error('現在のラウンドが見つかりません');
  return round;
}

/**
 * 現在の出題者プレイヤーを取得する
 */
async function getCurrentQuestioner(roomCode) {
  const round = await getCurrentRound(roomCode);
  const { data: questioner } = await supabase
    .from('players')
    .select('id, nickname, socket_id, is_host')
    .eq('id', round.questioner_id)
    .single();
  return questioner;
}

/**
 * 全員の偽タイトルが揃ったら投票フェーズへ移行する
 *
 * 処理内容:
 *   1. 本物タイトルを answers テーブルに挿入
 *   2. 全選択肢（偽 + 本物）をシャッフルして display_order を付与
 *   3. ラウンドのステータスを 'voting' に変更
 *   4. フロント全員に選択肢を送信（is_real / player_id は含めない）
 */
async function transitionToVoting(io, roomCode, round) {
  // DB から最新の real_title を取得（提出後に別の round オブジェクトが渡される可能性があるため）
  const { data: currentRound } = await supabase
    .from('rounds')
    .select('real_title')
    .eq('id', round.id)
    .single();

  // 本物タイトルを answers テーブルに追加
  await supabase.from('answers').insert({
    round_id: round.id,
    player_id: null,        // null = 本物タイトルを示す
    title: currentRound.real_title,
    is_real: true
  });

  // 全選択肢を取得してシャッフル
  const { data: allAnswers } = await supabase
    .from('answers')
    .select('id, title')
    .eq('round_id', round.id);

  const shuffled = shuffle(allAnswers);

  // display_order を一括更新
  for (let i = 0; i < shuffled.length; i++) {
    await supabase
      .from('answers')
      .update({ display_order: i + 1 })
      .eq('id', shuffled[i].id);
  }

  // ラウンドを voting フェーズへ
  await supabase.from('rounds').update({ status: 'voting' }).eq('id', round.id);

  // フロントには id と title と表示順のみ送信（is_real・作者情報は含めない）
  const choices = shuffled.map((a, i) => ({
    id: a.id,
    title: a.title,
    displayOrder: i + 1
  }));

  console.log(`[Round] 投票フェーズへ移行: ${roomCode} R${round.round_number}`);
  io.to(roomCode).emit('round:choices_presented', {
    roundId: round.id,
    choices
  });
}

/**
 * 全員の投票が完了したらラウンド結果を公開する
 *
 * 処理内容:
 *   1. DBの calculate_and_apply_round_scores 関数でスコアを更新
 *   2. 回答・投票の全情報（正解・偽タイトル作者）を公開
 *   3. 全プレイヤーの累計スコアを送信
 */
async function revealRound(io, roomCode, round) {
  // スコア計算 & players.score を DB 上で更新（1回の RPC 呼び出しで完結）
  const { data: roundScores, error: scoreError } = await supabase.rpc(
    'calculate_and_apply_round_scores',
    { p_round_id: round.id }
  );
  if (scoreError) throw scoreError;

  // ラウンドを revealed フェーズへ
  await supabase.from('rounds').update({ status: 'revealed' }).eq('id', round.id);

  // スコア更新後の最新プレイヤー情報を取得
  const { data: room } = await supabase
    .from('rooms')
    .select('id')
    .eq('code', roomCode)
    .single();
  const { data: players } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('room_id', room.id)
    .order('score', { ascending: false });

  // 全回答情報（is_real・作者情報を含む）を取得して公開
  const { data: answers } = await supabase
    .from('answers')
    .select('id, title, is_real, display_order, player_id, players(id, nickname)')
    .eq('round_id', round.id)
    .order('display_order');

  // 投票情報（誰が何に投票したか）を取得
  const { data: votes } = await supabase
    .from('votes')
    .select('voter_id, answer_id')
    .eq('round_id', round.id);

  // real_title を取得して公開
  const { data: finalRound } = await supabase
    .from('rounds')
    .select('real_title')
    .eq('id', round.id)
    .single();

  console.log(`[Round] 結果公開: ${roomCode} R${round.round_number}`);
  io.to(roomCode).emit('round:revealed', {
    roundId: round.id,
    realTitle: finalRound.real_title,
    // 選択肢の全情報（is_real と作者名を含む）
    answers: answers.map((a) => ({
      id: a.id,
      title: a.title,
      isReal: a.is_real,
      displayOrder: a.display_order,
      author: a.players ? { id: a.players.id, nickname: a.players.nickname } : null
    })),
    // 誰が何番の選択肢に投票したか
    votes: votes.map((v) => ({
      voterId: v.voter_id,
      answerId: v.answer_id
    })),
    // ラウンド獲得ポイントの内訳（correct_pts + deceive_pts = total_pts）
    roundScores,
    // 全員の累計スコア（スコアボード用）
    playerScores: players
  });
}

/**
 * 全ラウンド終了後のゲーム終了処理
 */
async function endGame(io, roomCode, room) {
  await supabase.from('rooms').update({ status: 'finished' }).eq('id', room.id);

  const { data: players } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('room_id', room.id)
    .order('score', { ascending: false });

  console.log(`[Game] 終了: ${roomCode} / 優勝: ${players[0]?.nickname}`);
  io.to(roomCode).emit('game:finished', {
    finalScores: players,
    winner: players[0]
  });
}

module.exports = { registerGameHandlers, transitionToVoting, revealRound, checkAllDeclared };

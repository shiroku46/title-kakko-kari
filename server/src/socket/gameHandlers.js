const supabase = require('../db/supabase');
const { shuffle } = require('../utils/shuffle');

// ============================================================
// 宣言トラッキング（インメモリ）
// roundId -> { known: Set<playerId>, unknown: Set<playerId> }
// ============================================================
const roundDeclarations = new Map();

// ============================================================
// Wikipedia からランダム記事を取得するヘルパー
// ============================================================
async function fetchWikipediaSynopsis() {
  for (let i = 0; i < 5; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://ja.wikipedia.org/api/rest_v1/page/random/summary', { signal: controller.signal });
      const data = await res.json();
      const title = (data.title || '').trim();
      const synopsis = (data.extract || '').trim();
      if (synopsis.length < 100) continue;
      // タイトル文字列をマスク（ネタバレ防止）
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const masked = synopsis.replace(new RegExp(escaped, 'g'), '■■■');
      return { title, synopsis: masked };
    } catch (_) {
      // リトライ
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

// ============================================================
// ゲームイベントハンドラー
// ============================================================

function registerGameHandlers(io, socket) {
  // ----------------------------------------------------------
  // ゲーム開始（ホストのみ）
  // payload: { mode: 'player'|'cpu', totalRounds?: number }
  // ----------------------------------------------------------
  socket.on('game:start', async (payload, callback) => {
    try {
      const { playerId, roomCode } = socket.data;
      const mode = payload?.mode ?? 'player';
      const requestedRounds = payload?.totalRounds ?? 5;

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

      if (mode === 'cpu') {
        // ── CPU出題モード ────────────────────────────────────────
        const totalRounds = Math.min(Math.max(requestedRounds, 1), 20);

        await supabase
          .from('rooms')
          .update({ status: 'playing', current_round: 1, total_rounds: totalRounds })
          .eq('id', room.id);

        // 第1ラウンド作成（questioner_id = null がCPUモードの印）
        const { data: round, error: roundError } = await supabase
          .from('rounds')
          .insert({ room_id: room.id, round_number: 1, questioner_id: null, status: 'selecting' })
          .select()
          .single();
        if (roundError) throw roundError;

        console.log(`[Game] 開始(CPU): ${roomCode} / ${totalRounds}ラウンド`);
        io.to(roomCode).emit('game:started', {
          totalRounds,
          currentRound: 1,
          questioner: null,
          round,
          playerOrder: [],
          mode: 'cpu',
        });

        callback?.({ ok: true });

        // Wikipedia 取得（非同期でホストにだけ送信）
        const work = await fetchWikipediaSynopsis();
        if (work) {
          await supabase
            .from('rounds')
            .update({ synopsis: work.synopsis, real_title: work.title })
            .eq('id', round.id);
          const host = connectedPlayers.find((p) => p.is_host);
          if (host?.socket_id) {
            io.to(host.socket_id).emit('round:synopsis_fetched', {
              roundId: round.id,
              synopsis: work.synopsis,
            });
          }
        }
      } else {
        // ── プレイヤー出題モード ──────────────────────────────────
        const shuffledPlayers = shuffle(connectedPlayers);
        for (let i = 0; i < shuffledPlayers.length; i++) {
          await supabase
            .from('players')
            .update({ turn_order: i + 1 })
            .eq('id', shuffledPlayers[i].id);
        }

        const totalRounds = shuffledPlayers.length;

        await supabase
          .from('rooms')
          .update({ status: 'playing', current_round: 1, total_rounds: totalRounds })
          .eq('id', room.id);

        const firstQuestioner = shuffledPlayers[0];
        const { data: round, error: roundError } = await supabase
          .from('rounds')
          .insert({ room_id: room.id, round_number: 1, questioner_id: firstQuestioner.id, status: 'selecting' })
          .select()
          .single();
        if (roundError) throw roundError;

        const playerOrder = shuffledPlayers.map((p) => ({
          id: p.id,
          nickname: p.nickname,
          turnOrder: p.turn_order ?? shuffledPlayers.indexOf(p) + 1,
        }));

        console.log(`[Game] 開始(Player): ${roomCode} / ${totalRounds}ラウンド`);
        io.to(roomCode).emit('game:started', {
          totalRounds,
          currentRound: 1,
          questioner: { id: firstQuestioner.id, nickname: firstQuestioner.nickname },
          round,
          playerOrder,
          mode: 'player',
        });

        callback?.({ ok: true });
      }
    } catch (err) {
      console.error('[game:start]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // あらすじ確定（ホストのみ・CPU出題モード）
  // confirming フェーズから submitting へ移行する
  // ----------------------------------------------------------
  socket.on('round:confirm_synopsis', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const { data: room } = await supabase.from('rooms').select('players(*)').eq('code', roomCode).single();
      const me = room.players.find((p) => p.id === playerId);
      if (!me?.is_host) throw new Error('ホストのみ操作できます');

      const round = await getCurrentRound(roomCode);
      if (round.status !== 'selecting') throw new Error('確認フェーズ以外では操作できません');
      if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
      if (!round.synopsis) throw new Error('あらすじがまだ取得されていません');

      await supabase.from('rounds').update({ status: 'submitting' }).eq('id', round.id);

      io.to(roomCode).emit('round:submitting_started', { roundId: round.id });

      console.log(`[Round] CPU あらすじ確定: ${roomCode} R${round.round_number}`);
      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:confirm_synopsis]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // あらすじ再取得（ホストのみ・CPU出題モード）
  // ----------------------------------------------------------
  socket.on('round:reroll_synopsis', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const { data: room } = await supabase.from('rooms').select('players(*)').eq('code', roomCode).single();
      const me = room.players.find((p) => p.id === playerId);
      if (!me?.is_host) throw new Error('ホストのみ操作できます');

      const round = await getCurrentRound(roomCode);
      if (round.status !== 'selecting') throw new Error('確認フェーズ以外では操作できません');
      if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');

      callback?.({ ok: true });

      // 新しい Wikipedia 記事を取得してホストにのみ送信
      const work = await fetchWikipediaSynopsis();
      if (work) {
        await supabase
          .from('rounds')
          .update({ synopsis: work.synopsis, real_title: work.title })
          .eq('id', round.id);
        const host = room.players.find((p) => p.is_host && p.is_connected);
        if (host?.socket_id) {
          io.to(host.socket_id).emit('round:synopsis_fetched', {
            roundId: round.id,
            synopsis: work.synopsis,
          });
        }
      }
    } catch (err) {
      console.error('[round:reroll_synopsis]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // あらすじ提出（出題者・プレイヤー出題モードのみ）
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

      await supabase
        .from('rounds')
        .update({ synopsis: synopsis.trim(), real_title: realTitle.trim() })
        .eq('id', round.id);

      io.to(roomCode).emit('round:synopsis_presented', {
        roundId: round.id,
        synopsis: synopsis.trim(),
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
  // ----------------------------------------------------------
  socket.on('round:declare_unknown', async (_, callback) => {
    try {
      const { playerId, nickname, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者はこの操作を行えません');
      if (round.status !== 'selecting') throw new Error('あらすじが提示されていません');
      if (!round.synopsis) throw new Error('あらすじが提示されていません');

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
  // ----------------------------------------------------------
  socket.on('round:reselect', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'selecting') throw new Error('現在この操作はできません');

      await supabase
        .from('rounds')
        .update({ synopsis: null, real_title: null })
        .eq('id', round.id);

      roundDeclarations.delete(round.id);

      io.to(roomCode).emit('round:reselect_started', {
        message: '出題者が新しい作品を選んでいます...',
      });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:reselect]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 偽タイトル提出フェーズへ移行（出題者・プレイヤー出題モードのみ）
  // ----------------------------------------------------------
  socket.on('round:start_submitting', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'selecting') throw new Error('現在この操作はできません');
      if (!round.synopsis || !round.real_title) throw new Error('あらすじが設定されていません');

      const decl = roundDeclarations.get(round.id);
      if (decl && decl.known.size > 0) {
        throw new Error('「知ってる！」宣言をしたプレイヤーがいます。作品を選び直してください');
      }

      await supabase
        .from('rounds')
        .update({ status: 'submitting' })
        .eq('id', round.id);

      io.to(roomCode).emit('round:submitting_started', { roundId: round.id });

      callback?.({ ok: true });
    } catch (err) {
      console.error('[round:start_submitting]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });

  // ----------------------------------------------------------
  // 偽タイトル提出（回答者）
  // 全員提出完了で自動的に投票フェーズへ移行する
  // ----------------------------------------------------------
  socket.on('round:submit_fake', async ({ title }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者は偽タイトルを提出できません');
      if (round.status !== 'submitting') throw new Error('現在この操作はできません');
      if (!title?.trim()) throw new Error('タイトルを入力してください');

      const { error } = await supabase
        .from('answers')
        .insert({ round_id: round.id, player_id: playerId, title: title.trim(), is_real: false });
      if (error) {
        if (error.code === '23505') throw new Error('すでに偽タイトルを提出しています');
        throw error;
      }

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

      // CPU モードは questioner_id = null なので全員が回答者になる
      const answererCount = room.players.filter(
        (p) => p.id !== round.questioner_id && p.is_connected
      ).length;
      const submittedCount = submittedAnswers.length;

      // プレイヤー出題モードのみ出題者に進捗通知
      if (round.questioner_id) {
        const { data: questioner } = await supabase
          .from('players')
          .select('socket_id')
          .eq('id', round.questioner_id)
          .single();
        if (questioner?.socket_id) {
          io.to(questioner.socket_id).emit('round:fake_submitted', {
            submittedCount,
            totalCount: answererCount,
          });
        }
      }

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
  // 全員投票完了で自動的に結果公開へ移行する
  // ----------------------------------------------------------
  socket.on('round:submit_vote', async ({ answerId }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id === playerId) throw new Error('出題者は投票できません');
      if (round.status !== 'voting') throw new Error('現在投票フェーズではありません');

      const { error } = await supabase
        .from('votes')
        .insert({ round_id: round.id, voter_id: playerId, answer_id: answerId });
      if (error) {
        if (error.code === '23505') throw new Error('すでに投票しています');
        throw error;
      }

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

      io.to(roomCode).emit('round:vote_progress', { votedCount, totalCount: answererCount });

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
  // MVP選出（出題者のみ・プレイヤー出題モード）
  // ----------------------------------------------------------
  socket.on('round:submit_mvp', async ({ answerId }, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const round = await getCurrentRound(roomCode);
      if (round.questioner_id !== playerId) throw new Error('出題者のみ操作できます');
      if (round.status !== 'revealed') throw new Error('結果公開フェーズ以外では操作できません');

      const { data: answer, error: answerError } = await supabase
        .from('answers')
        .select('id, title, player_id, players(id, nickname)')
        .eq('id', answerId)
        .eq('round_id', round.id)
        .eq('is_real', false)
        .single();
      if (answerError || !answer) throw new Error('選択した回答が見つかりません');
      if (!answer.player_id) throw new Error('本物タイトルにはMVPを贈れません');

      const { data: targetPlayer } = await supabase
        .from('players')
        .select('score')
        .eq('id', answer.player_id)
        .single();
      await supabase
        .from('players')
        .update({ score: (targetPlayer.score ?? 0) + 1 })
        .eq('id', answer.player_id);

      const { data: roomRow } = await supabase.from('rooms').select('id').eq('code', roomCode).single();
      const { data: players } = await supabase
        .from('players')
        .select('id, nickname, score')
        .eq('room_id', roomRow.id)
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
  // ----------------------------------------------------------
  socket.on('game:next_round', async (_, callback) => {
    try {
      const { playerId, roomCode } = socket.data;

      const { data: room } = await supabase
        .from('rooms')
        .select('*, players(*)')
        .eq('code', roomCode)
        .single();

      // questioner_id が null の場合は CPU モード
      const currentRound = await getCurrentRound(roomCode);
      const mode = currentRound.questioner_id === null ? 'cpu' : 'player';

      // 現在の出題者またはホストのみ操作可能
      const currentQuestioner = await getCurrentQuestioner(roomCode);
      const me = room.players.find((p) => p.id === playerId);
      if (currentQuestioner?.id !== playerId && !me?.is_host) {
        throw new Error('次のラウンドへの移行は出題者またはホストのみ操作できます');
      }

      if (room.current_round >= room.total_rounds) {
        await endGame(io, roomCode, room);
        return callback?.({ ok: true });
      }

      const nextRoundNumber = room.current_round + 1;

      await supabase
        .from('rooms')
        .update({ current_round: nextRoundNumber })
        .eq('id', room.id);

      if (mode === 'cpu') {
        // ── CPU出題モード ────────────────────────────────────────
        const { data: nextRound, error: roundError } = await supabase
          .from('rounds')
          .insert({ room_id: room.id, round_number: nextRoundNumber, questioner_id: null, status: 'selecting' })
          .select()
          .single();
        if (roundError) throw roundError;

        console.log(`[Game] CPU ラウンド ${nextRoundNumber} 開始: ${roomCode}`);
        io.to(roomCode).emit('game:round_started', {
          currentRound: nextRoundNumber,
          totalRounds: room.total_rounds,
          questioner: null,
          round: nextRound,
          mode: 'cpu',
        });

        callback?.({ ok: true });

        // Wikipedia 取得してホストに送信
        const work = await fetchWikipediaSynopsis();
        if (work) {
          await supabase
            .from('rounds')
            .update({ synopsis: work.synopsis, real_title: work.title })
            .eq('id', nextRound.id);
          const connectedPlayers = room.players.filter((p) => p.is_connected);
          const host = connectedPlayers.find((p) => p.is_host);
          if (host?.socket_id) {
            io.to(host.socket_id).emit('round:synopsis_fetched', {
              roundId: nextRound.id,
              synopsis: work.synopsis,
            });
          }
        }
      } else {
        // ── プレイヤー出題モード ──────────────────────────────────
        const nextQuestioner = room.players.find((p) => p.turn_order === nextRoundNumber);

        const { data: nextRound, error: roundError } = await supabase
          .from('rounds')
          .insert({ room_id: room.id, round_number: nextRoundNumber, questioner_id: nextQuestioner.id, status: 'selecting' })
          .select()
          .single();
        if (roundError) throw roundError;

        console.log(`[Game] ラウンド ${nextRoundNumber} 開始: ${roomCode}`);
        io.to(roomCode).emit('game:round_started', {
          currentRound: nextRoundNumber,
          totalRounds: room.total_rounds,
          questioner: { id: nextQuestioner.id, nickname: nextQuestioner.nickname },
          round: nextRound,
          mode: 'player',
        });

        callback?.({ ok: true });
      }
    } catch (err) {
      console.error('[game:next_round]', err.message);
      callback?.({ ok: false, error: err.message });
    }
  });
}

// ============================================================
// 内部ヘルパー関数
// ============================================================

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

async function getCurrentQuestioner(roomCode) {
  const round = await getCurrentRound(roomCode);
  if (!round.questioner_id) return null; // CPU モード
  const { data: questioner } = await supabase
    .from('players')
    .select('id, nickname, socket_id, is_host')
    .eq('id', round.questioner_id)
    .single();
  return questioner;
}

async function transitionToVoting(io, roomCode, round) {
  const { data: currentRound } = await supabase
    .from('rounds')
    .select('real_title')
    .eq('id', round.id)
    .single();

  await supabase.from('answers').insert({
    round_id: round.id,
    player_id: null,
    title: currentRound.real_title,
    is_real: true,
  });

  const { data: allAnswers } = await supabase
    .from('answers')
    .select('id, title')
    .eq('round_id', round.id);

  const shuffled = shuffle(allAnswers);

  for (let i = 0; i < shuffled.length; i++) {
    await supabase
      .from('answers')
      .update({ display_order: i + 1 })
      .eq('id', shuffled[i].id);
  }

  await supabase.from('rounds').update({ status: 'voting' }).eq('id', round.id);

  const choices = shuffled.map((a, i) => ({ id: a.id, title: a.title, displayOrder: i + 1 }));

  console.log(`[Round] 投票フェーズへ移行: ${roomCode} R${round.round_number}`);
  io.to(roomCode).emit('round:choices_presented', { roundId: round.id, choices });
}

async function revealRound(io, roomCode, round) {
  const { data: roundScores, error: scoreError } = await supabase.rpc(
    'calculate_and_apply_round_scores',
    { p_round_id: round.id }
  );
  if (scoreError) throw scoreError;

  await supabase.from('rounds').update({ status: 'revealed' }).eq('id', round.id);

  const { data: roomRow } = await supabase.from('rooms').select('id').eq('code', roomCode).single();
  const { data: players } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('room_id', roomRow.id)
    .order('score', { ascending: false });

  const { data: answers } = await supabase
    .from('answers')
    .select('id, title, is_real, display_order, player_id, players(id, nickname)')
    .eq('round_id', round.id)
    .order('display_order');

  const { data: votes } = await supabase
    .from('votes')
    .select('voter_id, answer_id')
    .eq('round_id', round.id);

  const { data: finalRound } = await supabase
    .from('rounds')
    .select('real_title')
    .eq('id', round.id)
    .single();

  console.log(`[Round] 結果公開: ${roomCode} R${round.round_number}`);
  io.to(roomCode).emit('round:revealed', {
    roundId: round.id,
    realTitle: finalRound.real_title,
    answers: answers.map((a) => ({
      id: a.id,
      title: a.title,
      isReal: a.is_real,
      displayOrder: a.display_order,
      author: a.players ? { id: a.players.id, nickname: a.players.nickname } : null,
    })),
    votes: votes.map((v) => ({ voterId: v.voter_id, answerId: v.answer_id })),
    roundScores,
    playerScores: players,
  });
}

async function endGame(io, roomCode, room) {
  await supabase.from('rooms').update({ status: 'finished' }).eq('id', room.id);

  const { data: players } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('room_id', room.id)
    .order('score', { ascending: false });

  console.log(`[Game] 終了: ${roomCode} / 優勝: ${players[0]?.nickname}`);
  io.to(roomCode).emit('game:finished', { finalScores: players, winner: players[0] });
}

module.exports = { registerGameHandlers, transitionToVoting, revealRound, checkAllDeclared };

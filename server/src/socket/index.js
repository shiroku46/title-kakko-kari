const supabase = require('../db/supabase');
const { registerRoomHandlers } = require('./roomHandlers');
const { registerGameHandlers, transitionToVoting, revealRound, checkAllDeclared } = require('./gameHandlers');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] 接続: ${socket.id}`);

    registerRoomHandlers(io, socket);
    registerGameHandlers(io, socket);

    socket.on('disconnect', async () => {
      console.log(`[Socket] 切断: ${socket.id}`);
      await handleDisconnect(io, socket);
    });
  });
}

async function handleDisconnect(io, socket) {
  const { playerId, roomCode, nickname } = socket.data ?? {};
  if (!playerId || !roomCode) return;

  await supabase
    .from('players')
    .update({ is_connected: false, socket_id: null })
    .eq('id', playerId);

  io.to(roomCode).emit('room:player_disconnected', { playerId, nickname });

  // ゲーム中かどうか確認
  const { data: room } = await supabase
    .from('rooms')
    .select('*, players(*)')
    .eq('code', roomCode)
    .single();

  if (!room || room.status !== 'playing') return;

  // 現在のラウンドを取得
  const { data: round } = await supabase
    .from('rounds')
    .select('*')
    .eq('room_id', room.id)
    .eq('round_number', room.current_round)
    .single();

  if (!round) return;

  const connectedPlayers = room.players.filter((p) => p.is_connected && p.id !== playerId);
  const connectedAnswerers = connectedPlayers.filter((p) => p.id !== round.questioner_id);

  // ── 出題者が落ちた ──────────────────────────────────────────
  if (round.questioner_id === playerId) {
    // ホストに操作権を移す（出題者 = ホストの場合は次の接続中プレイヤーへ）
    const newHost = connectedPlayers.find((p) => p.is_host) ?? connectedPlayers[0];
    if (!newHost) return; // 全員抜けた

    // selecting フェーズ中なら次の接続中プレイヤーをホストとして通知するだけ
    // （ラウンド進行は revealed 後に next_round を押せる人が変わるだけで十分）
    io.to(roomCode).emit('game:questioner_disconnected', {
      nickname,
      fallbackHostId: newHost.id,
      fallbackHostNickname: newHost.nickname,
      roundStatus: round.status,
    });
    console.log(`[Disconnect] 出題者離脱: ${nickname} / フォールバック: ${newHost.nickname}`);
    return;
  }

  // ── 回答者が落ちた ──────────────────────────────────────────

  // submitting フェーズ：提出済みかチェックして完了判定を再実行
  if (round.status === 'submitting') {
    const { data: submittedAnswers } = await supabase
      .from('answers')
      .select('id')
      .eq('round_id', round.id)
      .eq('is_real', false);

    const submittedCount = submittedAnswers?.length ?? 0;

    // 出題者への進捗更新
    const { data: questioner } = await supabase
      .from('players')
      .select('socket_id')
      .eq('id', round.questioner_id)
      .single();
    if (questioner?.socket_id) {
      io.to(questioner.socket_id).emit('round:fake_submitted', {
        submittedCount,
        totalCount: connectedAnswerers.length,
      });
    }

    if (submittedCount >= connectedAnswerers.length && connectedAnswerers.length > 0) {
      console.log(`[Disconnect] submitting 完了判定を再実行: ${roomCode}`);
      await transitionToVoting(io, roomCode, round);
    }
  }

  // voting フェーズ：投票済みかチェックして完了判定を再実行
  if (round.status === 'voting') {
    const { data: votes } = await supabase
      .from('votes')
      .select('id')
      .eq('round_id', round.id);

    const votedCount = votes?.length ?? 0;

    io.to(roomCode).emit('round:vote_progress', {
      votedCount,
      totalCount: connectedAnswerers.length,
    });

    if (votedCount >= connectedAnswerers.length && connectedAnswerers.length > 0) {
      console.log(`[Disconnect] voting 完了判定を再実行: ${roomCode}`);
      await revealRound(io, roomCode, round);
    }
  }

  // selecting フェーズ（宣言待ち）：全員宣言済みか再チェック
  if (round.status === 'selecting' && round.synopsis) {
    await checkAllDeclared(io, roomCode, round);
  }
}

module.exports = { registerSocketHandlers };

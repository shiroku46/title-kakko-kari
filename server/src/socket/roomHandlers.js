const supabase = require('../db/supabase');

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);

function collectSafeNetworkDiagnostics(error) {
  const diagnostics = new Set();
  const queue = [error, error?.cause];
  if (Array.isArray(error?.errors)) queue.push(...error.errors);
  if (Array.isArray(error?.cause?.errors)) queue.push(...error.cause.errors);

  for (const candidate of queue) {
    if (!candidate || typeof candidate !== 'object') continue;
    for (const field of ['code', 'errno', 'syscall']) {
      const value = candidate[field];
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const normalized = String(value);
      if (/^[A-Za-z0-9_.:-]{1,80}$/.test(normalized)) {
        diagnostics.add(`${field}=${normalized}`);
      }
    }
  }

  return [...diagnostics].sort().join(', ');
}

function isNetworkFailure(error) {
  const messages = [error?.message, error?.cause?.message]
    .filter((value) => typeof value === 'string')
    .join(' ');
  const codes = [error?.code, error?.cause?.code, error?.errno, error?.cause?.errno]
    .filter((value) => typeof value === 'string');

  return (
    error?.name === 'SupabaseNetworkError' ||
    messages.includes('Supabase network request failed') ||
    messages.includes('fetch failed') ||
    codes.some((code) => NETWORK_ERROR_CODES.has(code))
  );
}

function reportRoomError(event, error) {
  if (isNetworkFailure(error)) {
    const diagnostics = collectSafeNetworkDiagnostics(error);
    console.error(`[${event}] database network request failed${diagnostics ? ` [${diagnostics}]` : ''}`);
    return 'データベースへの接続に失敗しました。しばらくしてからもう一度お試しください';
  }

  const message = typeof error?.message === 'string' ? error.message : '処理に失敗しました';
  console.error(`[${event}]`, message);
  return message;
}

function registerRoomHandlers(io, socket) {
  // ----------------------------------------------------------
  // ルーム作成
  // クライアント送信: { nickname: string }
  // ----------------------------------------------------------
  socket.on('room:create', async ({ nickname }, callback) => {
    try {
      const trimmedNickname = nickname?.trim();
      if (!trimmedNickname) throw new Error('ニックネームを入力してください');

      // DBの関数でユニークなルームコードを生成
      const { data: code, error: codeError } = await supabase.rpc('generate_room_code');
      if (codeError) throw codeError;

      // ルームを作成
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert({ code, settings: {} })
        .select()
        .single();
      if (roomError) throw roomError;

      // ホストプレイヤーを作成
      const { data: player, error: playerError } = await supabase
        .from('players')
        .insert({
          room_id: room.id,
          nickname: trimmedNickname,
          is_host: true,
          socket_id: socket.id,
          is_connected: true
        })
        .select()
        .single();
      if (playerError) throw playerError;

      // Socket.io のルームに参加（roomCode をチャンネル名として使用）
      socket.join(code);
      socket.data = { playerId: player.id, roomCode: code, nickname: trimmedNickname };

      console.log(`[Room] 作成: ${code} / ホスト: ${trimmedNickname}`);
      callback({ ok: true, room, player });
    } catch (err) {
      callback({ ok: false, error: reportRoomError('room:create', err) });
    }
  });

  // ----------------------------------------------------------
  // ルーム参加
  // クライアント送信: { code: string, nickname: string }
  // ----------------------------------------------------------
  socket.on('room:join', async ({ code, nickname }, callback) => {
    try {
      const upperCode = code?.toUpperCase().trim();
      const trimmedNickname = nickname?.trim();
      if (!upperCode) throw new Error('ルームコードを入力してください');
      if (!trimmedNickname) throw new Error('ニックネームを入力してください');

      // ルームを検索（プレイヤー一覧も同時取得）
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('*, players(*)')
        .eq('code', upperCode)
        .single();
      if (roomError || !room) throw new Error('ルームが見つかりません');
      if (room.status !== 'waiting') throw new Error('このルームのゲームはすでに開始しています');

      const connectedPlayers = room.players.filter((p) => p.is_connected);
      if (connectedPlayers.length >= 6) throw new Error('ルームが満員です（最大6人）');

      // ニックネームの重複チェック（接続中のプレイヤーのみ対象）
      const nicknameExists = connectedPlayers.some((p) => p.nickname === trimmedNickname);
      if (nicknameExists) throw new Error('そのニックネームはすでに使われています');

      // プレイヤーを作成
      const { data: player, error: playerError } = await supabase
        .from('players')
        .insert({
          room_id: room.id,
          nickname: trimmedNickname,
          is_host: false,
          socket_id: socket.id,
          is_connected: true
        })
        .select()
        .single();
      if (playerError) throw playerError;

      // Socket.io のルームに参加
      socket.join(upperCode);
      socket.data = { playerId: player.id, roomCode: upperCode, nickname: trimmedNickname };

      // 参加前のプレイヤー一覧を整形（新規参加者含む全員）
      const allPlayers = [...connectedPlayers, player].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        isHost: p.is_host,
        score: p.score
      }));

      // 既存プレイヤーに参加を通知
      socket.to(upperCode).emit('room:player_joined', {
        player: { id: player.id, nickname: trimmedNickname },
        allPlayers
      });

      console.log(`[Room] 参加: ${upperCode} / ${trimmedNickname}`);
      callback({ ok: true, room, player, allPlayers });
    } catch (err) {
      callback({ ok: false, error: reportRoomError('room:join', err) });
    }
  });

  // ----------------------------------------------------------
  // プレイヤー一覧取得（画面復帰時などに使用）
  // ----------------------------------------------------------
  socket.on('room:get_state', async (_, callback) => {
    try {
      const { roomCode } = socket.data ?? {};
      if (!roomCode) throw new Error('ルームに参加していません');

      const { data: room, error } = await supabase
        .from('rooms')
        .select('*, players(*)')
        .eq('code', roomCode)
        .single();
      if (error) throw error;

      callback({ ok: true, room });
    } catch (err) {
      callback({ ok: false, error: reportRoomError('room:get_state', err) });
    }
  });
}

module.exports = { registerRoomHandlers };
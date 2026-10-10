const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { rooms, createRoom, getRoom, getMember, publicRoom, publicPlayer, playerScores,
  textInput, persistRooms, updateRoomExpiry } = require('../gameState');
const { getResumeGame } = require('./gameHandlers');

function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

function lobbyPlayers(room) {
  return room.players.filter((p) => p.is_connected).map((p) => ({
    id: p.id, nickname: p.nickname, isHost: p.is_host, isComputer: Boolean(p.is_computer), score: p.score,
    isOnline: Boolean(p.is_online),
  }));
}

function registerRoomHandlers(io, socket) {
  for (const event of ['room:create', 'room:join']) {
    socket.on(event, (payload, callback) => {
      try {
        if (socket.data.playerId) throw new Error('すでにルームに参加しています');
        const nickname = textInput(payload?.nickname, 'ニックネーム', 12);
        const isHost = event === 'room:create';
        let room;
        if (isHost) {
          room = createRoom();
        } else {
          const code = textInput(payload?.code, 'ルームコード', 6).toUpperCase();
          room = getRoom(code);
          if (room.status !== 'waiting') throw new Error('このルームのゲームはすでに開始しています');
          const connectedPlayers = room.players.filter((p) => p.is_connected);
          if (connectedPlayers.length >= 6) throw new Error('ルームが満員です（最大6人）');
          if (connectedPlayers.some((p) => p.nickname === nickname)) {
            throw new Error('そのニックネームはすでに使われています');
          }
        }
        const token = randomBytes(32).toString('base64url');
        const player = {
          id: randomUUID(), room_id: room.id, nickname, is_host: isHost,
          socket_id: socket.id, is_connected: true, is_online: true, resume_hash: tokenHash(token), score: 0, turn_order: null,
        };
        room.players.push(player);
        updateRoomExpiry(room);
        try { persistRooms(); }
        catch (error) {
          room.players.pop();
          if (isHost) rooms.delete(room.code);
          throw error;
        }
        socket.join(room.code);
        socket.data = { playerId: player.id, roomCode: room.code, nickname };
        // Recovery needs an event offset even when the host is alone in the lobby.
        socket.emit('room:session_ready', {});
        const allPlayers = lobbyPlayers(room);
        if (!isHost) {
          socket.to(room.code).emit('room:player_joined', {
            player: { id: player.id, nickname }, allPlayers,
          });
        }
        if (typeof callback === 'function') {
          callback({ ok: true, room: publicRoom(room), player: publicPlayer(player), token, allPlayers });
        }
      } catch (error) {
        if (typeof callback === 'function') callback({ ok: false, error: error.message });
      }
    });
  }

  socket.on('room:resume', (payload, callback) => {
    let rejoinUnavailable = true;
    try {
      const room = getRoom(payload?.code);
      const player = room.players.find((p) => p.id === payload?.playerId && p.is_connected && !p.is_computer);
      if (!player?.resume_hash || typeof payload?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.token) ||
          !timingSafeEqual(Buffer.from(player.resume_hash, 'hex'), Buffer.from(tokenHash(payload.token), 'hex'))) {
        throw new Error('元の席へ戻るための情報が見つかりません');
      }
      if (socket.data.playerId && (socket.data.playerId !== player.id || socket.data.roomCode !== room.code)) {
        throw new Error('すでに別のルームに参加しています');
      }
      rejoinUnavailable = false;
      const oldSocket = io.sockets.sockets.get(player.socket_id);
      const previous = { socket_id: player.socket_id, is_online: player.is_online, expires_at: room.expires_at };
      player.socket_id = socket.id;
      player.is_online = true;
      updateRoomExpiry(room);
      try { persistRooms(); }
      catch (error) {
        player.socket_id = previous.socket_id;
        player.is_online = previous.is_online;
        room.expires_at = previous.expires_at;
        throw error;
      }
      socket.data = { playerId: player.id, roomCode: room.code, nickname: player.nickname };
      socket.join(room.code);
      // The new authenticated socket owns the seat before the previous tab is closed.
      if (oldSocket && oldSocket !== socket) oldSocket.disconnect(true);
      socket.emit('room:session_ready', {});
      const allPlayers = lobbyPlayers(room);
      socket.to(room.code).emit('room:players_updated', { allPlayers });
      if (typeof callback === 'function') callback({ ok: true, room: publicRoom(room), player: publicPlayer(player), allPlayers,
        ...(room.status === 'playing' && { gameData: getResumeGame(room, player) }),
        ...(room.status === 'finished' && { finalScores: playerScores(room) }) });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false, error: error.message, rejoinUnavailable });
    }
  });

  socket.on('room:set_computers', (payload, callback) => {
    try {
      const { room, player } = getMember(socket);
      if (!player.is_host) throw new Error('コンピュータの変更はホストのみ操作できます');
      if (room.status !== 'waiting') throw new Error('ゲーム開始後はコンピュータを変更できません');
      const count = payload?.count;
      if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error('コンピュータは0〜5人で設定してください');
      const humans = room.players.filter((p) => p.is_connected && !p.is_computer);
      if (humans.length + count > 6) throw new Error('人間とコンピュータを合わせて最大6人です');
      room.players = [...humans, ...room.players.filter((p) => p.is_computer).slice(0, count)];
      while (room.players.length < humans.length + count) {
        let number = 1;
        while (room.players.some((p) => p.nickname === `コンピュータ${number}`)) number++;
        room.players.push({
          id: randomUUID(), room_id: room.id, nickname: `コンピュータ${number}`,
          is_computer: true, is_host: false, socket_id: null, is_connected: true, is_online: true, score: 0, turn_order: null,
        });
      }
      const allPlayers = lobbyPlayers(room);
      persistRooms();
      io.to(room.code).emit('room:players_updated', { allPlayers });
      if (typeof callback === 'function') callback({ ok: true, allPlayers });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false, error: error.message });
    }
  });

  socket.on('room:update_settings', (payload, callback) => {
    try {
      const { room, player } = getMember(socket);
      if (!player.is_host) throw new Error('ルールの変更はホストのみ操作できます');
      if (room.status !== 'waiting') throw new Error('ゲーム開始後はルールを変更できません');
      if (typeof payload?.genreDisclosure !== 'boolean') throw new Error('ジャンル指定の設定が不正です');
      room.settings = { ...room.settings, genreDisclosure: payload.genreDisclosure };
      persistRooms();
      io.to(room.code).emit('room:settings_updated', { settings: room.settings });
      if (typeof callback === 'function') callback({ ok: true, settings: room.settings });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false, error: error.message });
    }
  });

  socket.on('room:get_state', (_, callback) => {
    try {
      const { room } = getMember(socket);
      if (typeof callback === 'function') callback({ ok: true, room: publicRoom(room) });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerRoomHandlers };

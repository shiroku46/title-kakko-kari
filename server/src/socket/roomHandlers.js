const { randomUUID } = require('node:crypto');
const { createRoom, getRoom, getMember, publicRoom, textInput } = require('../gameState');

function lobbyPlayers(room) {
  return room.players.filter((p) => p.is_connected).map((p) => ({
    id: p.id, nickname: p.nickname, isHost: p.is_host, isComputer: Boolean(p.is_computer), score: p.score,
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
        const player = {
          id: randomUUID(), room_id: room.id, nickname, is_host: isHost,
          socket_id: socket.id, is_connected: true, score: 0, turn_order: null,
        };
        room.players.push(player);
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
          callback({ ok: true, room: publicRoom(room), player, ...(!isHost && { allPlayers }) });
        }
      } catch (error) {
        if (typeof callback === 'function') callback({ ok: false, error: error.message });
      }
    });
  }

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
          is_computer: true, is_host: false, socket_id: null, is_connected: true, score: 0, turn_order: null,
        });
      }
      const allPlayers = lobbyPlayers(room);
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

const { randomUUID } = require('node:crypto');
const { createRoom, getRoom, getMember, publicRoom, textInput } = require('../gameState');

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
        const allPlayers = room.players.filter((p) => p.is_connected).map((p) => ({
          id: p.id, nickname: p.nickname, isHost: p.is_host, score: p.score,
        }));
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

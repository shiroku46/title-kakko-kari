const { rooms, getCurrentRound } = require('../gameState');
const { registerRoomHandlers } = require('./roomHandlers');
const { registerGameHandlers, checkRoundProgress } = require('./gameHandlers');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket);
    registerGameHandlers(io, socket);
    socket.on('disconnect', () => handleDisconnect(io, socket));
  });
}

function handleDisconnect(io, socket) {
  const { playerId, roomCode, nickname } = socket.data ?? {};
  const room = rooms.get(roomCode);
  if (!room) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;
  player.is_connected = false;
  player.socket_id = null;
  io.to(roomCode).emit('room:player_disconnected', { playerId, nickname });
  const connectedPlayers = room.players.filter((p) => p.is_connected);
  // Delete the whole session, including titles, votes and declarations, when empty.
  if (!connectedPlayers.length) {
    rooms.delete(roomCode);
    return;
  }
  if (player.is_host) connectedPlayers[0].is_host = true;
  player.is_host = false;
  if (room.status === 'waiting') {
    room.players = connectedPlayers;
    return;
  }
  if (room.status !== 'playing') return;
  const round = getCurrentRound(room);
  if (round.questioner_id === playerId) {
    const fallback = connectedPlayers.find((p) => p.is_host) ?? connectedPlayers[0];
    io.to(roomCode).emit('game:questioner_disconnected', {
      nickname, fallbackHostId: fallback.id, fallbackHostNickname: fallback.nickname,
      roundStatus: round.status,
    });
  }
  if (round.questioner_id === null && round.status === 'selecting' && round.synopsis) {
    const host = connectedPlayers.find((p) => p.is_host);
    io.to(host.socket_id).emit('round:synopsis_fetched', { roundId: round.id, synopsis: round.synopsis });
  }
  checkRoundProgress(io, room, round);
}

module.exports = { registerSocketHandlers };

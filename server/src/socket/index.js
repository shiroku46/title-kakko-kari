const { rooms, getCurrentRound, getMember, persistRooms, updateRoomExpiry, roomStorageStatus } = require('../gameState');
const { commitGameAction, runStateOperation } = require('./commitGameAction');
const { registerRoomHandlers } = require('./roomHandlers');
const { registerGameHandlers, checkRoundProgress, checkRoundTimers } = require('./gameHandlers');

function registerSocketHandlers(io, instanceId) {
  const timer = setInterval(() => {
    if (roomStorageStatus().ready) runStateOperation(() => checkRoundTimers(io)).catch(() => {});
  }, 1000);
  timer.unref();
  io.engine.on('close', () => clearInterval(timer));
  io.on('connection', (socket) => {
    const connectedAt = process.uptime();
    if (socket.recovered) {
      runStateOperation(async () => {
      try {
        const { room, player } = getMember(socket);
        await commitGameAction(io, room, persistRooms, () => {
          player.is_online = true;
          updateRoomExpiry(room);
        });
      }
      catch (error) {
        if (error.code !== 'ROOM_STORE_UNAVAILABLE') socket.disconnect(true);
      }
      });
    }
    registerRoomHandlers(io, socket);
    registerGameHandlers(io, socket);
    socket.on('room:leave', (_, callback) => runStateOperation(async () => {
      try {
        await handleDisconnect(io, socket);
        socket.leave(socket.data.roomCode);
        socket.data = {};
        if (typeof callback === 'function') callback({ ok: true });
      } catch (error) {
        if (typeof callback === 'function') callback({ ok: false, error: error.message });
      }
    }));
    socket.on('disconnect', (reason) => {
      // Reasons and elapsed times identify transport loss without logging a seat or credential.
      console.info('[Session]', JSON.stringify({ instanceId, reason, connectedSeconds: Math.floor(process.uptime() - connectedAt) }));
      runStateOperation(async () => {
      try {
        if (reason === 'client namespace disconnect') return await handleDisconnect(io, socket);
        const room = rooms.get(socket.data.roomCode);
        const player = room?.players.find((p) => p.id === socket.data.playerId && p.socket_id === socket.id);
        if (!player) return;
        // Losing a transport reserves the seat; it never acts as a voluntary exit.
        await commitGameAction(io, room, persistRooms, () => {
          player.is_online = false;
          updateRoomExpiry(room);
        });
      } catch (_) {
        console.error('[Session] 部屋の保存に失敗しました');
      }
      });
    });
  });
}

async function handleDisconnect(io, socket) {
  const { playerId, roomCode, nickname } = socket.data ?? {};
  const room = rooms.get(roomCode);
  if (!room) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.socket_id !== socket.id) return;
  await commitGameAction(io, room, persistRooms, (io) => {
    player.is_connected = false;
    player.is_online = false;
    player.resume_hash = null;
    player.socket_id = null;
    io.to(roomCode).emit('room:player_disconnected', { playerId, nickname });
    const connectedPlayers = room.players.filter((p) => p.is_connected);
    const humans = connectedPlayers.filter((p) => !p.is_computer);
    // Delete the whole session, including titles, votes and declarations, when empty.
    if (!humans.length) {
      rooms.delete(roomCode);
      return;
    }
    if (player.is_host) (humans.find((p) => p.is_online) || humans[0]).is_host = true;
    player.is_host = false;
    updateRoomExpiry(room);
    if (room.status === 'waiting') {
      room.players = connectedPlayers;
      return;
    }
    if (room.status !== 'playing') { return; }
    const round = getCurrentRound(room);
    if (humans.length === 1 && (!connectedPlayers.some((p) => p.is_computer) || round.questioner_id !== null)) {
      // One person cannot continue this party game. Preserve earned scores and
      // give the remaining member an explicit exit instead of waiting forever
      // for absent declarations, submissions or votes.
      room.status = 'finished';
      io.to(roomCode).emit('game:stopped', {
        reason: 'not_enough_players',
        message: 'ほかの人がいなくなったため、ゲームを終わります。ホームに戻って、部屋を作り直してください。',
      });
      return;
    }
    if (round.questioner_id === playerId) {
      const fallback = connectedPlayers.find((p) => p.is_host) ?? connectedPlayers[0];
      io.to(roomCode).emit('game:questioner_disconnected', {
        nickname, fallbackHostId: fallback.id, fallbackHostNickname: fallback.nickname,
        roundStatus: round.status,
      });
    }
    if (round.questioner_id === null && round.status === 'selecting' && round.synopsis) {
      const host = connectedPlayers.find((p) => p.is_host);
      io.to(host.socket_id).emit('round:synopsis_fetched', {
        roundId: round.id, synopsis: round.synopsis, contentType: round.contentType,
      });
    }
    checkRoundProgress(io, room, round);
  }, () => rooms.set(roomCode, room));
}

module.exports = { registerSocketHandlers };

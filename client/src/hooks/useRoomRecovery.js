import { useEffect, useState } from 'react';
import { getSocket, disconnectSocket } from './useSocket';
import { getRoomSession, clearRoomSession, showRoom } from '../utils/roomSession';
import { Alert } from '../utils/alert';

export default function useRoomRecovery(navigation, leavingRef) {
  const socket = getSocket();
  const [reconnecting, setReconnecting] = useState(!socket.connected);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let retryTimer;
    let failures = 0;
    const cancelAttempt = () => {
      generation++;
      clearTimeout(retryTimer);
    };
    const fail = (message, unavailable = false) => {
      if (!active || leavingRef.current) return;
      cancelAttempt();
      leavingRef.current = true;
      if (unavailable) clearRoomSession();
      disconnectSocket();
      navigation.replace('Home');
      Alert.alert('接続を戻せませんでした', message);
    };
    const onDisconnect = () => {
      if (leavingRef.current) return;
      cancelAttempt();
      if (!socket.active) return fail('この画面の接続が終了しました。ホームの「前の部屋に戻る」から試してください。');
      setReconnecting(true);
    };
    const onConnect = () => {
      if (!active || leavingRef.current || !socket.connected || getSocket() !== socket) return;
      cancelAttempt();
      setReconnecting(true);
      const session = getRoomSession();
      if (!session) return fail('ホームから、もう一度部屋に入ってください。', true);
      const attempt = generation;
      const connectionId = socket.id;
      socket.timeout(10000).emit('room:resume', {
        code: session.code, playerId: session.playerId, token: session.token,
      }, (error, result) => {
        if (!active || leavingRef.current || attempt !== generation ||
            !socket.connected || socket.id !== connectionId || getSocket() !== socket) return;
        const current = getRoomSession();
        if (!current || current.code !== session.code || current.playerId !== session.playerId ||
            current.token !== session.token) return cancelAttempt();
        if (!result?.ok) {
          if (!error && result?.rejoinUnavailable) return fail(result.error, true);
          // A slow ACK or temporarily unavailable store does not revoke a seat.
          // Retain this screen and retry only this connection/session generation.
          failures++;
          retryTimer = setTimeout(onConnect, Math.min(failures * 1000, 10000));
          return;
        }
        failures = 0;
        setReconnecting(false);
        showRoom(navigation, result);
      });
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      active = false;
      cancelAttempt();
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [navigation, socket, leavingRef]);
  return reconnecting;
}

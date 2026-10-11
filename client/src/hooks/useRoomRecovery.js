import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { getSocket, disconnectSocket } from './useSocket';
import { getRoomSession, clearRoomSession, showRoom } from '../utils/roomSession';
import { Alert } from '../utils/alert';

const restoredConnections = new WeakMap();

export default function useRoomRecovery(navigation, leavingRef) {
  const socket = getSocket();
  const focused = useIsFocused();
  if (!restoredConnections.has(socket)) restoredConnections.set(socket, socket.io.engine);
  const [reconnecting, setReconnecting] = useState(!socket.connected || socket.io.engine !== restoredConnections.get(socket));
  useEffect(() => {
    if (!focused) return;
    let active = true;
    const ownsRecovery = () => active && !leavingRef.current && navigation.isFocused() && getSocket() === socket;
    let generation = 0;
    let retryTimer;
    let failures = 0;
    const cancelAttempt = () => {
      generation++;
      clearTimeout(retryTimer);
    };
    const fail = (message, unavailable = false) => {
      if (!ownsRecovery()) return;
      cancelAttempt();
      leavingRef.current = true;
      if (unavailable) clearRoomSession();
      disconnectSocket();
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      Alert.alert('接続を戻せませんでした', message);
    };
    const onDisconnect = () => {
      if (!ownsRecovery()) return;
      cancelAttempt();
      if (!socket.active) return fail('この画面の接続が終了しました。ホームの「前の部屋に戻る」から試してください。');
      setReconnecting(true);
    };
    const onConnect = () => {
      if (!ownsRecovery() || !socket.connected) return;
      cancelAttempt();
      setReconnecting(true);
      const session = getRoomSession();
      if (!session) return fail('ホームから、もう一度部屋に入ってください。', true);
      const attempt = generation;
      const connection = socket.io.engine;
      socket.timeout(10000).emit('room:resume', {
        code: session.code, playerId: session.playerId, token: session.token,
      }, (error, result) => {
        if (!ownsRecovery() || attempt !== generation || !socket.connected ||
            socket.io.engine !== connection) return;
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
        restoredConnections.set(socket, connection);
        setReconnecting(false);
        showRoom(navigation, result);
      });
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    setReconnecting(!socket.connected || socket.io.engine !== restoredConnections.get(socket));
    if (socket.connected && socket.io.engine !== restoredConnections.get(socket)) onConnect();
    return () => {
      active = false;
      cancelAttempt();
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [navigation, socket, leavingRef, focused]);
  return reconnecting;
}

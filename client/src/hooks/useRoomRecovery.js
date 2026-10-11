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
    const ownsRecovery = () => active && !leavingRef.current && navigation.isFocused();
    const fail = (message, unavailable = false) => {
      if (!ownsRecovery()) return;
      leavingRef.current = true;
      if (unavailable) clearRoomSession();
      disconnectSocket();
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      Alert.alert('接続を戻せませんでした', message);
    };
    const onDisconnect = () => {
      if (!ownsRecovery()) return;
      if (!socket.active) return fail('この画面の接続が終了しました。ホームの「前の部屋に戻る」から試してください。');
      setReconnecting(true);
    };
    const onConnect = () => {
      if (!ownsRecovery()) return;
      setReconnecting(true);
      const connection = socket.io.engine;
      const session = getRoomSession();
      if (!session) return fail('ホームから、もう一度部屋に入ってください。', true);
      socket.timeout(10000).emit('room:resume', {
        code: session.code, playerId: session.playerId, token: session.token,
      }, (error, result) => {
        if (!ownsRecovery() || socket.io.engine !== connection) return;
        if (!socket.connected && socket.active) return;
        if (error || !result?.ok) return fail(error
          ? 'サーバーの返事を待ちきれませんでした。ホームの「前の部屋に戻る」から試してください。'
          : result.error, result?.rejoinUnavailable);
        setReconnecting(false);
        restoredConnections.set(socket, connection);
        showRoom(navigation, result);
      });
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    setReconnecting(!socket.connected || socket.io.engine !== restoredConnections.get(socket));
    if (socket.connected && socket.io.engine !== restoredConnections.get(socket)) onConnect();
    return () => {
      active = false;
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [navigation, socket, leavingRef, focused]);
  return reconnecting;
}

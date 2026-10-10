import { useEffect, useState } from 'react';
import { getSocket, disconnectSocket } from './useSocket';
import { getRoomSession, clearRoomSession, showRoom } from '../utils/roomSession';
import { Alert } from '../utils/alert';

export default function useRoomRecovery(navigation, leavingRef) {
  const socket = getSocket();
  const [reconnecting, setReconnecting] = useState(!socket.connected);
  useEffect(() => {
    let active = true;
    const fail = (message, unavailable = false) => {
      if (!active || leavingRef.current) return;
      leavingRef.current = true;
      if (unavailable) clearRoomSession();
      disconnectSocket();
      navigation.replace('Home');
      Alert.alert('接続を戻せませんでした', message);
    };
    const onDisconnect = () => {
      if (leavingRef.current) return;
      if (!socket.active) return fail('この画面の接続が終了しました。ホームの「前の部屋に戻る」から試してください。');
      setReconnecting(true);
    };
    const onConnect = () => {
      if (leavingRef.current) return;
      const session = getRoomSession();
      if (!session) return fail('ホームから、もう一度部屋に入ってください。', true);
      socket.timeout(10000).emit('room:resume', {
        code: session.code, playerId: session.playerId, token: session.token,
      }, (error, result) => {
        if (!active || leavingRef.current) return;
        if (error || !result?.ok) return fail(error
          ? 'サーバーの返事を待ちきれませんでした。ホームの「前の部屋に戻る」から試してください。'
          : result.error, result?.rejoinUnavailable);
        setReconnecting(false);
        showRoom(navigation, result);
      });
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      active = false;
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [navigation, socket, leavingRef]);
  return reconnecting;
}

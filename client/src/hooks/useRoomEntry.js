import { useEffect, useRef, useState } from 'react';
import { connectSocket, disconnectSocket } from './useSocket';
import { DEFAULT_SERVER_URL } from '../config';

// Every entry attempt owns its timers and listeners. A cancelled/old attempt
// cannot navigate or leave the form waiting forever for an acknowledgement.
function waitForConnection(socket, signal) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      signal.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve();
    };
    const onConnect = () => finish();
    const onError = () => finish(new Error('つながりませんでした。少し待って、もう一度試してね。'));
    const onAbort = () => finish(new Error('cancelled'));
    const timer = setTimeout(onError, 10000);
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function requestEntry(socket, event, payload, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(response);
    };
    const onAbort = () => finish(new Error('cancelled'));
    const timer = setTimeout(() => finish(new Error('返事がありません。もう一度試してね。')), 10000);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) return onAbort();
    socket.emit(event, payload, (response) => {
      if (!response?.ok) return finish(new Error(response?.error || '部屋を用意できませんでした。'));
      finish(null, response);
    });
  });
}

export default function useRoomEntry(navigation) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const active = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);

  async function enterRoom({ nickname, code, serverUrl, joining = false }) {
    if (active.current) return;
    const nick = nickname.trim();
    const roomCode = (code || '').trim();
    const targetUrl = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    if (!nick) return setError('名前を入れてね。');
    if (joining && !/^\d{6}$/.test(roomCode)) return setError('6けたの部屋のコードを入れてね。');
    if (!/^https?:\/\/[^\s/]+/i.test(targetUrl)) return setError('つなぐ先は http:// か https:// から入れてね。');

    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setMessage('つないでいます…');
    const slowTimer = setTimeout(() => {
      if (mounted.current && active.current === controller) setMessage('準備を待っています。少し待ってね。');
    }, 4000);
    let timedOut = false;
    const healthTimer = setTimeout(() => { timedOut = true; controller.abort(); }, 90000);
    let entered = false;
    try {
      const response = await fetch(`${targetUrl}/health`, { signal: controller.signal });
      if (!response.ok) throw new Error('つなぐ先で問題が起きています。少し待って、もう一度試してね。');
      const health = await response.json();
      if (health.status !== 'ok') throw new Error('つなぐ先の準備ができていません。');
      clearTimeout(healthTimer);
      clearTimeout(slowTimer);
      if (controller.signal.aborted || !mounted.current) return;
      setMessage('部屋を用意しています…');
      const socket = connectSocket(targetUrl);
      await waitForConnection(socket, controller.signal);
      const result = await requestEntry(socket, joining ? 'room:join' : 'room:create',
        joining ? { nickname: nick, code: roomCode } : { nickname: nick }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      entered = true;
      navigation.replace('Lobby', {
        room: result.room,
        player: result.player,
        allPlayers: result.allPlayers || [{ id: result.player.id, nickname: nick, isHost: true, score: 0 }],
      });
    } catch (failure) {
      if (mounted.current && (timedOut || !controller.signal.aborted)) {
        setError(timedOut ? '時間がかかりすぎました。もう一度試してね。' : failure.message || 'つながりませんでした。もう一度試してね。');
      }
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(healthTimer);
      if (!entered) disconnectSocket();
      if (active.current === controller) {
        active.current = null;
        if (mounted.current) { setBusy(false); setMessage(''); }
      }
    }
  }

  return { busy, message, error, enterRoom, clearError: () => setError(''), cancel: () => active.current?.abort() };
}

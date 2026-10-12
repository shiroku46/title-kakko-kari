import { useEffect, useRef, useState } from 'react';
import { connectSocket, disconnectSocket } from './useSocket';
import { DEFAULT_SERVER_URL } from '../config';
import { getRoomSession, saveRoomSession, clearRoomSession, showRoom } from '../utils/roomSession';

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
    const onTimeout = () => finish(new Error('つながりませんでした。少し待って、もう一度試してね。'));
    const onError = () => { if (!socket.active) onTimeout(); };
    const onAbort = () => finish(new Error('cancelled'));
    const timer = setTimeout(onTimeout, 30000);
    socket.once('connect', onConnect);
    socket.on('connect_error', onError);
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
    const connectionId = socket.id;
    socket.emit(event, payload, (response) => {
      if (settled || signal.aborted || socket.id !== connectionId) return;
      if (!response?.ok) {
        if (response?.rejoinUnavailable) clearRoomSession();
        return finish(new Error(response?.error || '部屋を用意できませんでした。'));
      }
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

  async function enterRoom({ nickname = '', code, serverUrl, joining = false, resuming = false }) {
    if (active.current) return;
    if (resuming && !getRoomSession()) return setError('このブラウザーに復帰情報がありません。参加した端末・ブラウザーで開いてください。');
    const nick = nickname.trim();
    if (!resuming && !nick) return setError('名前を入れてね。');
    const roomCode = (code || '').trim();
    const targetUrl = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/+$/, '');
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
      const saved = getRoomSession();
      const resume = saved && saved.serverUrl === targetUrl && saved.code === roomCode &&
        (resuming || joining && saved.nickname === nick);
      if (resuming && !resume) throw new Error('前の部屋へ戻るための情報が見つかりません。');
      const result = await requestEntry(socket, resume ? 'room:resume' : joining ? 'room:join' : 'room:create',
        resume ? { code: saved.code, playerId: saved.playerId, token: saved.token }
          : { nickname: nick, ...(joining && { code: roomCode }) }, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      entered = true;
      saveRoomSession({ serverUrl: targetUrl, nickname: result.player.nickname, code: result.room.code,
        playerId: result.player.id, token: result.token || saved?.token });
      showRoom(navigation, result);
    } catch (failure) {
      if (mounted.current && (timedOut || !controller.signal.aborted)) {
        const failureMessage = failure instanceof TypeError || failure instanceof SyntaxError
          ? 'つながりませんでした。つなぐ先を確かめて、もう一度試してね。'
          : failure.message || 'つながりませんでした。もう一度試してね。';
        setError(timedOut ? '時間がかかりすぎました。もう一度試してね。' : failureMessage);
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

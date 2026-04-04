import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { DEFAULT_SERVER_URL } from '../config';

let sharedSocket = null;
let currentUrl = DEFAULT_SERVER_URL;

export function getSocket() {
  if (!sharedSocket) {
    sharedSocket = io(currentUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return sharedSocket;
}

/**
 * URLを指定してソケットを接続する
 * URL が変わっていたら既存ソケットを破棄して再生成
 */
export function connectSocket(url) {
  const targetUrl = url || DEFAULT_SERVER_URL;
  if (sharedSocket && currentUrl !== targetUrl) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
  currentUrl = targetUrl;
  const socket = getSocket();
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
}

export function getCurrentUrl() {
  return currentUrl;
}

/**
 * Socket.io イベントリスナーを登録・解除するフック
 * listeners: { 'event:name': handlerFn, ... }
 */
export function useSocketListeners(listeners) {
  const socket = getSocket();
  const listenersRef = useRef(listeners);
  listenersRef.current = listeners;

  useEffect(() => {
    const handlers = Object.keys(listenersRef.current).map((event) => {
      const handler = (...args) => listenersRef.current[event]?.(...args);
      socket.on(event, handler);
      return [event, handler];
    });
    return () => {
      handlers.forEach(([event, handler]) => socket.off(event, handler));
    };
  }, []);
}

import { useEffect, useRef, useState } from 'react';
import { Asset } from 'expo-asset';

const STORAGE_KEY = 'title-kakko-kari:bgm-v1';
const source = require('../../assets/audio/lobby-time.mp3');

function savedSettings() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    if (Number.isInteger(saved?.volume) && saved.volume >= 10 && saved.volume <= 100 && saved.volume % 10 === 0 &&
        typeof saved.muted === 'boolean') return saved;
  } catch (_) { /* Private browsing may deny storage. */ }
  return { volume: 30, muted: false };
}

export default function useRoomBgm(active) {
  const [settings, setSettings] = useState(savedSettings);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const player = useRef(null);
  const preferences = useRef(settings);
  preferences.current = settings;

  function play() {
    const current = player.current;
    if (!current || preferences.current.muted || document.hidden) return;
    setError('');
    if (current.audio.error) current.audio.load();
    current.context.resume().catch(() => {
      if (player.current === current) setError('BGMを再生できませんでした。再生ボタンで再試行できます。');
    });
    current.audio.play().catch(failure => {
      if (player.current !== current || failure.name === 'AbortError') return;
      setPlaying(false);
      setError(failure.name === 'NotAllowedError'
        ? '再生ボタンを押すとBGMが流れます。'
        : 'BGMを読み込めませんでした。再生ボタンで再試行できます。');
    });
  }

  useEffect(() => {
    if (!active) return;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    let context, audio, gain;
    try {
      context = new AudioContext();
      audio = new Audio(Asset.fromModule(source).uri);
      gain = context.createGain();
      context.createMediaElementSource(audio).connect(gain);
      gain.connect(context.destination);
    } catch (_) {
      audio?.pause();
      context?.close().catch(() => {});
      setError('このブラウザーではBGMを再生できません。');
      return;
    }
    // Web Audio gain also works where mobile browsers ignore media.volume.
    gain.gain.value = preferences.current.volume / 100;
    audio.loop = true;
    audio.preload = 'auto';
    const current = { audio, context, gain };
    player.current = current;
    const update = () => setPlaying(!audio.paused && context.state === 'running');
    const failed = () => {
      setPlaying(false);
      setError('BGMを読み込めませんでした。再生ボタンで再試行できます。');
    };
    const visibility = () => { if (document.hidden) audio.pause(); else play(); };
    audio.addEventListener('playing', update);
    audio.addEventListener('pause', update);
    audio.addEventListener('error', failed);
    context.addEventListener('statechange', update);
    document.addEventListener('visibilitychange', visibility);
    play();
    return () => {
      player.current = null;
      document.removeEventListener('visibilitychange', visibility);
      audio.removeEventListener('playing', update);
      audio.removeEventListener('pause', update);
      audio.removeEventListener('error', failed);
      context.removeEventListener('statechange', update);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      context.close().catch(() => {});
      setPlaying(false);
      setError('');
    };
  }, [active]);

  useEffect(() => {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) { /* Keep this session usable. */ }
    if (player.current) {
      player.current.gain.gain.value = settings.volume / 100;
      if (settings.muted) player.current.audio.pause();
    }
  }, [settings]);

  function toggle() {
    preferences.current = { ...settings, muted: playing };
    setSettings(preferences.current);
    if (playing) player.current?.audio.pause();
    else play();
  }

  return { ...settings, playing, error, toggle,
    changeVolume: difference => setSettings(previous => ({ ...previous, volume: Math.max(10, Math.min(100, previous.volume + difference)) })) };
}

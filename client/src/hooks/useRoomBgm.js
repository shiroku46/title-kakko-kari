import { useEffect, useRef, useState } from 'react';
import { Asset } from 'expo-asset';

const STORAGE_KEY = 'title-kakko-kari:bgm-v1';
export const BGM_TRACKS = [
  { id: 'swing-along', title: 'Swing Along', genre: 'エレクトロスウィング', author: 'bramd',
    url: 'https://opengameart.org/content/swing-along', source: require('../../assets/audio/swing-along.mp3') },
  { id: 'pop-rocks', title: 'Pop Rocks', genre: 'ポップ', author: 'Shane Ivers',
    url: 'https://www.silvermansound.com/free-music/pop-rocks', source: require('../../assets/audio/pop-rocks.mp3') },
  { id: 'bumbumbum', title: 'Bumbumbum', genre: 'レトロポップ', author: 'Shane Ivers',
    url: 'https://www.silvermansound.com/free-music/bumbumbum', source: require('../../assets/audio/bumbumbum.mp3') },
  { id: 'lobby-time', title: 'Lobby Time', genre: 'ラウンジ', author: 'Kevin MacLeod (incompetech.com)',
    url: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600054', source: require('../../assets/audio/lobby-time.mp3') },
];

function savedSettings() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    if (Number.isInteger(saved?.volume) && saved.volume >= 10 && saved.volume <= 100 && saved.volume % 10 === 0 &&
        typeof saved.muted === 'boolean') return { volume: saved.volume, muted: saved.muted,
          trackId: BGM_TRACKS.some(track => track.id === saved.trackId) ? saved.trackId : BGM_TRACKS[0].id };
  } catch (_) { /* Private browsing may deny storage. */ }
  return { volume: 30, muted: false, trackId: BGM_TRACKS[0].id };
}

export default function useRoomBgm(active) {
  const [settings, setSettings] = useState(savedSettings);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [localFile, setLocalFile] = useState(null);
  const file = useRef(null);
  const player = useRef(null);
  const preferences = useRef(settings);
  preferences.current = settings;

  function play() {
    const current = player.current;
    if (!current || preferences.current.muted || document.hidden) return;
    const revision = current.revision;
    setError('');
    if (current.audio.error) current.audio.load();
    current.context.resume().catch(() => {
      if (player.current === current && current.revision === revision) setError('BGMを再生できませんでした。再生ボタンで再試行できます。');
    });
    current.audio.play().catch(failure => {
      if (player.current !== current || current.revision !== revision || failure.name === 'AbortError') return;
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
      audio = new Audio(Asset.fromModule(BGM_TRACKS.find(track => track.id === preferences.current.trackId).source).uri);
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
    const current = { audio, context, gain, revision: 0 };
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
      if (file.current) URL.revokeObjectURL(file.current.uri);
      file.current = null;
      setLocalFile(null);
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

  function switchSource(uri, nextSettings) {
    preferences.current = nextSettings;
    setSettings(nextSettings);
    const current = player.current;
    if (current) {
      current.revision++;
      current.audio.pause();
      current.audio.src = uri;
      current.audio.load();
      setError('');
      play();
    }
    if (file.current) URL.revokeObjectURL(file.current.uri);
    file.current = null;
  }

  function selectTrack(id) {
    const track = BGM_TRACKS.find(item => item.id === id);
    if (!track) return;
    switchSource(Asset.fromModule(track.source).uri, { ...settings, trackId: id });
    setLocalFile(null);
  }

  function loadMp3(selected) {
    if (!selected) return;
    if (!player.current) {
      setError('このブラウザーではBGMを再生できません。');
      return;
    }
    if (!/\.mp3$/i.test(selected.name) || !selected.size) {
      setError('音声の入ったMP3ファイルを選んでください。');
      return;
    }
    let uri;
    try { uri = URL.createObjectURL(selected); } catch (_) {
      setError('MP3ファイルを読み込めませんでした。もう一度選んでください。');
      return;
    }
    switchSource(uri, { ...settings, muted: false });
    file.current = { uri, name: selected.name };
    setLocalFile(file.current);
  }

  return { ...settings, playing, error, toggle, selectTrack, loadMp3, localFile,
    changeVolume: difference => setSettings(previous => ({ ...previous, volume: Math.max(10, Math.min(100, previous.volume + difference)) })) };
}

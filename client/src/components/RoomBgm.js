import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import useRoomBgm, { BGM_TRACKS } from '../hooks/useRoomBgm';
import { StationeryButton } from './ui';
import { Text } from './ui/GameText';
import { colors } from '../theme';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';

export default function RoomBgm({ active }) {
  const bgm = useRoomBgm(active && Platform.OS === 'web');
  const input = useRef(null);
  const { isMobile } = useResponsiveLayout();
  const [expanded, setExpanded] = useState(false);
  const track = BGM_TRACKS.find(item => item.id === bgm.trackId);
  // shortcut: audio targets the public browser game; use Expo audio when shipping native BGM.
  if (!active || Platform.OS !== 'web') return null;
  return <View style={styles.panel}>
    <View style={styles.controls}>
      {!isMobile ? <Text style={styles.label}>BGM</Text> : null}
      {!isMobile || expanded ? React.createElement('select', { 'aria-label': 'BGMの曲を選ぶ', value: bgm.localFile ? 'local' : bgm.trackId,
        onChange: event => bgm.selectTrack(event.target.value), style: webStyles.select },
        BGM_TRACKS.map(item => React.createElement('option', { key: item.id, value: item.id }, `${item.genre} · ${item.title}`)),
        bgm.localFile ? React.createElement('option', { value: 'local' }, bgm.localFile.name) : null) : null}
      <StationeryButton variant="neutral" onPress={bgm.toggle} style={styles.button} textStyle={styles.buttonText}
        accessibilityLabel={bgm.playing ? 'BGMをミュート' : 'BGMを再生'}>
        {bgm.playing ? 'ミュート' : 'BGMを再生'}
      </StationeryButton>
      <Text style={styles.volume} accessibilityLiveRegion="polite">音量 {bgm.volume}%</Text>
      <StationeryButton variant="ghost" onPress={() => bgm.changeVolume(-10)} disabled={bgm.volume === 10}
        style={styles.volumeButton} accessibilityLabel="BGMの音量を下げる">−</StationeryButton>
      <StationeryButton variant="ghost" onPress={() => bgm.changeVolume(10)} disabled={bgm.volume === 100}
        style={styles.volumeButton} accessibilityLabel="BGMの音量を上げる">＋</StationeryButton>
      {isMobile ? <StationeryButton variant="neutral" onPress={() => setExpanded(value => !value)} style={styles.button}
        textStyle={styles.buttonText} accessibilityLabel="BGMの曲とMP3の設定"
        accessibilityState={{ expanded }}>{expanded ? '閉じる' : '曲を変更'}</StationeryButton> : null}
      {!isMobile || expanded ? <StationeryButton variant="neutral" onPress={() => input.current?.click()} style={styles.button}
        textStyle={styles.buttonText}>MP3を読み込む</StationeryButton> : null}
      {React.createElement('input', { type: 'file', accept: '.mp3,audio/mpeg', ref: input, hidden: true,
        'aria-label': 'MP3ファイル', onChange: event => { bgm.loadMp3(event.target.files?.[0]); event.target.value = ''; } })}
    </View>
    {bgm.error ? <Text style={styles.note} accessibilityLiveRegion="polite">{bgm.error}</Text> : null}
    {bgm.localFile ? <Text style={styles.credit}>端末内のMP3を再生中 · 再読み込み後は、もう一度ファイルを選んでください。</Text> : <Text style={styles.credit}>
      <Text accessibilityRole="link" href={track.url}
        hrefAttrs={{ target: '_blank', rel: 'noopener noreferrer' }}>
        {track.title} / {track.author}
      </Text>{' · '}
      <Text accessibilityRole="link" href="https://creativecommons.org/licenses/by/4.0/"
        hrefAttrs={{ target: '_blank', rel: 'noopener noreferrer' }}>CC BY 4.0</Text>
    </Text>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.white, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  label: { color: colors.navy, fontWeight: '700', fontSize: 14 },
  volume: { color: colors.navy, fontSize: 13 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  buttonText: { fontSize: 13 },
  volumeButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8 },
  note: { color: colors.navy, fontSize: 12, textAlign: 'center' },
  credit: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});

const webStyles = { select: { minHeight: 44, maxWidth: '100%', width: 280, padding: '8px 12px', border: `1px solid ${colors.border}`,
  borderRadius: 8, background: colors.white, color: colors.navy, fontFamily: 'system-ui, sans-serif', fontSize: 14, textOverflow: 'ellipsis' } };

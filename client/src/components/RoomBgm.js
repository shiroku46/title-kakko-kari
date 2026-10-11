import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import useRoomBgm from '../hooks/useRoomBgm';
import { StationeryButton } from './ui';
import { Text } from './ui/GameText';
import { colors } from '../theme';

export default function RoomBgm({ active }) {
  const bgm = useRoomBgm(active && Platform.OS === 'web');
  // shortcut: audio targets the public browser game; use Expo audio when shipping native BGM.
  if (!active || Platform.OS !== 'web') return null;
  return <View style={styles.panel}>
    <View style={styles.controls}>
      <Text style={styles.label} accessibilityLiveRegion="polite">♪ BGM {bgm.volume}%</Text>
      <StationeryButton variant="neutral" onPress={bgm.toggle} style={styles.button} textStyle={styles.buttonText}
        accessibilityLabel={bgm.playing ? 'BGMをミュート' : 'BGMを再生'}>
        {bgm.playing ? 'ミュート' : 'BGMを再生'}
      </StationeryButton>
      <StationeryButton variant="ghost" onPress={() => bgm.changeVolume(-10)} disabled={bgm.volume === 10}
        style={styles.volumeButton} accessibilityLabel="BGMの音量を下げる">−</StationeryButton>
      <StationeryButton variant="ghost" onPress={() => bgm.changeVolume(10)} disabled={bgm.volume === 100}
        style={styles.volumeButton} accessibilityLabel="BGMの音量を上げる">＋</StationeryButton>
    </View>
    {bgm.error ? <Text style={styles.note} accessibilityLiveRegion="polite">{bgm.error}</Text> : null}
    <Text style={styles.credit}>
      <Text accessibilityRole="link" href="https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600054"
        hrefAttrs={{ target: '_blank', rel: 'noopener noreferrer' }}>
        Lobby Time / Kevin MacLeod (incompetech.com)
      </Text>{' · '}
      <Text accessibilityRole="link" href="https://creativecommons.org/licenses/by/4.0/"
        hrefAttrs={{ target: '_blank', rel: 'noopener noreferrer' }}>CC BY 4.0</Text>
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.paper, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, gap: 3 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6 },
  label: { color: colors.navy, fontWeight: '700', fontSize: 13, minWidth: 82 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  buttonText: { fontSize: 13 },
  volumeButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8 },
  note: { color: colors.navy, fontSize: 12, textAlign: 'center' },
  credit: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
});

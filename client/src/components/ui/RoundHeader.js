import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './GameText';
import { colors, radii } from '../../theme';
import { fontFamilies } from '../../theme/typography';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

export default function RoundHeader({ currentRound, totalRounds, questioner, phase }) {
  const { isMobile } = useResponsiveLayout();
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <View style={styles.roundPill}>
          <Text style={styles.roundLabel}>ラウンド</Text>
          <Text style={styles.roundValue}>{currentRound} / {totalRounds}</Text>
        </View>
        {questioner ? (
          <View style={styles.questionerPill}>
            <Text style={styles.questionerLabel}>出題者</Text>
            <Text style={styles.questionerName}>{questioner.nickname}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.phase, isMobile && styles.phaseMobile]}>{phase}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.navy,
    borderRadius: radii.lg,
    borderWidth: 0,
    borderColor: colors.navyDeep,
    paddingHorizontal: 20,
    paddingVertical: 24,
    marginBottom: 14,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  roundPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  roundLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: '#E2ECF2',
  },
  roundValue: { fontSize: 13, fontWeight: '900', color: colors.white },
  questionerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    gap: 7,
  },
  questionerLabel: { fontSize: 12, color: '#A8C6DA' },
  questionerName: { fontSize: 12, fontWeight: '800', color: colors.white },
  phase: {
    marginTop: 14,
    fontFamily: fontFamilies.display,
    fontSize: 28,
    lineHeight: 38,
    fontWeight: '900',
    color: colors.white,
    textAlign: 'center',
  },
  phaseMobile: { fontSize: 21, lineHeight: 32 },
});

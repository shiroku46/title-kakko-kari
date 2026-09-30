import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';
import { fontFamilies } from '../../theme/typography';

export default function RoundHeader({ currentRound, totalRounds, questioner, phase }) {
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <View style={styles.roundPill}>
          <Text style={styles.roundLabel}>ROUND</Text>
          <Text style={styles.roundValue}>{currentRound} / {totalRounds}</Text>
        </View>
        {questioner ? (
          <View style={styles.questionerPill}>
            <Text style={styles.questionerLabel}>出題者</Text>
            <Text style={styles.questionerName}>{questioner.nickname}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.phase}>{phase}</Text>
      <View style={styles.accentLine}>
        <View style={styles.accentRed} />
        <View style={styles.accentYellow} />
        <View style={styles.accentCyan} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.navy,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 14,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  roundPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  roundLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: colors.red,
    letterSpacing: 1,
  },
  roundValue: { fontSize: 13, fontWeight: '900', color: colors.navy },
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
  questionerLabel: { fontSize: 10, color: '#A8C6DA' },
  questionerName: { fontSize: 12, fontWeight: '800', color: colors.white },
  phase: {
    marginTop: 14,
    fontFamily: fontFamilies.sansBold,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '900',
    color: colors.white,
  },
  accentLine: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 12,
  },
  accentRed: { width: 62, height: 5, borderRadius: 3, backgroundColor: colors.red },
  accentYellow: { width: 24, height: 5, borderRadius: 3, backgroundColor: colors.yellow },
  accentCyan: { width: 14, height: 5, borderRadius: 3, backgroundColor: colors.cyan },
});

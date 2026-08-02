import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';
import { fontFamilies } from '../../theme/typography';

export default function RoundHeader({ currentRound, totalRounds, questioner, phase }) {
  return (
    <View style={styles.header}>
      <View style={styles.pill}>
        <Text style={styles.pillText}>Round {currentRound} / {totalRounds}</Text>
      </View>
      <Text style={styles.phase}>{phase}</Text>
      {questioner ? (
        <Text style={styles.questioner}>出題者：{questioner.nickname}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingVertical: 20 },
  pill: {
    backgroundColor: colors.paperSubtle,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.navy },
  phase: {
    fontFamily: fontFamilies.sans,
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  questioner: { fontSize: 13, color: colors.muted, marginTop: 4 },
});

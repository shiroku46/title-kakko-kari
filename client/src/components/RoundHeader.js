import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function RoundHeader({ currentRound, totalRounds, questioner, phase }) {
  return (
    <View style={styles.header}>
      <View style={styles.pill}>
        <Text style={styles.pillText}>Round {currentRound} / {totalRounds}</Text>
      </View>
      <Text style={styles.phase}>{phase}</Text>
      {questioner && (
        <Text style={styles.questioner}>出題者：{questioner.nickname}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingVertical: 20 },
  pill: {
    backgroundColor: '#FFE8EC',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 8,
  },
  pillText: { fontSize: 12, fontWeight: '700', color: '#FF3B5C' },
  phase: { fontSize: 22, fontWeight: '800', color: '#1A1A1A' },
  questioner: { fontSize: 13, color: '#999', marginTop: 4 },
});

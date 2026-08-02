import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';
import Stamp from './Stamp';

export default function ScoreRow({ rank, nickname, score, delta, isMe = false, isWinner = false, style }) {
  return (
    <View style={[styles.base, isMe && styles.baseMe, style]}>
      <Text style={[styles.rank, isWinner && styles.rankWinner]}>{rank}</Text>
      <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
        {nickname}
        {isMe ? ' (あなた)' : ''}
      </Text>
      {delta != null && delta > 0 && (
        <Text style={styles.delta}>+{delta}</Text>
      )}
      <Text style={[styles.score, isWinner && styles.scoreWinner]}>{score} pt</Text>
      {isWinner && <Stamp type="得" size="sm" style={styles.stamp} />}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  baseMe: { backgroundColor: '#F5F7FA' },
  rank: { fontSize: 14, color: colors.muted, width: 28, textAlign: 'center' },
  rankWinner: { color: colors.mustard, fontWeight: '700' },
  name: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '500' },
  nameMe: { color: colors.navy, fontWeight: '700' },
  delta: { fontSize: 13, color: colors.vermilion, fontWeight: '700' },
  score: { fontSize: 15, color: colors.ink, fontWeight: '700' },
  scoreWinner: { color: colors.vermilion, fontSize: 17 },
  stamp: { marginLeft: 4 },
});

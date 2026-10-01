import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './GameText';
import { colors, radii } from '../../theme';

export default function ScoreRow({
  rank,
  nickname,
  score,
  delta,
  isMe = false,
  isWinner = false,
  style,
}) {
  return (
    <View style={[styles.base, isMe && styles.baseMe, isWinner && styles.winner, style]}>
      <View style={[styles.rankBadge, isWinner && styles.rankWinner]}>
        <Text style={[styles.rank, isWinner && styles.rankWinnerText]}>{rank}</Text>
      </View>
      <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
        {nickname}
        {isMe ? '（あなた）' : ''}
      </Text>
      {delta != null && delta > 0 && <Text style={styles.delta}>+{delta}</Text>}
      <Text style={[styles.score, isWinner && styles.scoreWinner]}>{score}</Text>
      <Text style={styles.unit}>pt</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    marginBottom: 8,
    backgroundColor: '#F5F8FA',
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: 8,
  },
  baseMe: {
    backgroundColor: '#E6F5FF',
    borderColor: colors.blue,
  },
  winner: {
    backgroundColor: '#FFF1A8',
    borderColor: colors.navy,
    borderWidth: 2,
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankWinner: { backgroundColor: colors.yellow },
  rank: { fontSize: 14, fontWeight: '900', color: colors.navy },
  rankWinnerText: { color: colors.navy },
  name: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '800' },
  nameMe: { color: colors.blue },
  delta: { fontSize: 13, color: colors.red, fontWeight: '900' },
  score: { fontSize: 20, color: colors.navy, fontWeight: '900' },
  scoreWinner: { color: colors.red, fontSize: 23 },
  unit: { fontSize: 11, color: colors.muted, marginLeft: -4 },
});

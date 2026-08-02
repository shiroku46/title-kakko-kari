import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../../theme';
import Stamp from './Stamp';

export default function PlayerCard({ player, isMe = false, isHost = false, status, style }) {
  const initial = (player?.nickname ?? '?').charAt(0);

  return (
    <View style={[styles.base, isMe && styles.baseMe, style]}>
      <View style={[styles.avatar, isHost && styles.avatarHost]}>
        <Text style={[styles.initial, isHost && styles.initialHost]}>{initial}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {player?.nickname ?? '—'}
          {isMe ? ' (あなた)' : ''}
        </Text>
        {isHost && <Text style={styles.hostLabel}>ホスト</Text>}
      </View>
      {status === 'ready' && <Stamp type="準備OK" size="sm" />}
      {status === 'submitted' && <Stamp type="封" size="sm" />}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    gap: spacing.sm,
  },
  baseMe: {
    borderColor: colors.navy,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.paperSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHost: { backgroundColor: colors.navy },
  initial: { fontSize: 16, fontWeight: '700', color: colors.ink },
  initialHost: { color: colors.white },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '500', color: colors.ink },
  hostLabel: { fontSize: 10, color: colors.muted, marginTop: 2 },
});

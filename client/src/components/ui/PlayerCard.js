import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';

const AVATAR_COLORS = [colors.yellow, colors.cyan, colors.pink, colors.green, '#B7A8FF', '#FFB46A'];

function colorForName(name = '') {
  const sum = [...name].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export default function PlayerCard({ player, isMe = false, isHost = false, status, style }) {
  const nickname = player?.nickname ?? '参加待ち';
  const initial = nickname === '参加待ち' ? '?' : nickname.charAt(0);
  const empty = nickname === '参加待ち' || !player;

  return (
    <View style={[styles.base, isMe && styles.baseMe, empty && styles.empty, style]}>
      <View style={[styles.avatar, { backgroundColor: empty ? '#E8EDF0' : colorForName(nickname) }]}>
        <Text style={[styles.initial, empty && styles.initialEmpty]}>{initial}</Text>
        {isHost && (
          <View style={styles.crown}>
            <Text style={styles.crownText}>★</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {nickname}
          {isMe ? '（あなた）' : ''}
        </Text>
        <Text style={styles.meta}>
          {isHost ? 'ホスト' : status === 'submitted' ? '提出済み' : empty ? '空席' : '参加中'}
        </Text>
      </View>
      {status && !empty && (
        <View style={[styles.statusDot, status === 'submitted' && styles.statusSubmitted]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
    minHeight: 68,
  },
  baseMe: {
    borderColor: colors.red,
    backgroundColor: '#FFF3F6',
  },
  empty: {
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  initial: { fontSize: 17, fontWeight: '900', color: colors.navy },
  initialEmpty: { color: colors.muted },
  crown: {
    position: 'absolute',
    top: -10,
    right: -7,
    backgroundColor: colors.yellow,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crownText: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '800', color: colors.navy },
  meta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.green,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  statusSubmitted: { backgroundColor: colors.red },
});

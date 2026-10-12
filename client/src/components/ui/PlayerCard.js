import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './GameText';
import { colors, radii } from '../../theme';

const AVATAR_COLORS = [colors.yellow, colors.cyan, colors.pink, colors.green, '#B7A8FF', '#FFB46A'];

function colorForName(name = '') {
  const sum = [...name].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export default function PlayerCard({ player, isMe = false, isHost = false, status, style }) {
  const nickname = player?.nickname ?? '参加待ち';
  const initial = player?.isComputer ? 'PC' : nickname === '参加待ち' ? '?' : nickname.charAt(0);
  const empty = nickname === '参加待ち' || !player;

  return (
    <View style={[styles.base, isMe && styles.baseMe, empty && styles.empty, style]}>
      <View style={[styles.avatar, { backgroundColor: empty ? '#E8EDF0' : colorForName(nickname) }]}>
        <Text style={[styles.initial, empty && styles.initialEmpty]}>{initial}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {nickname}
          {isMe ? '（あなた）' : ''}
        </Text>
        <Text style={styles.meta}>
          {player?.isComputer ? 'コンピュータ' : player?.profileReady === false ? '名前を入力中' : isHost ? 'ホスト' : status === 'submitted' ? '提出済み' : empty ? '空席' : '参加中'}
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

  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '800', color: colors.navy },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
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

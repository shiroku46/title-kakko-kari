import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './GameText';
import { colors, radii, shadows } from '../../theme';
import Stamp from './Stamp';

export default function TitleCard({ title, variant = 'hidden', author, style }) {
  const isReal = variant === 'correct';
  const isSelected = variant === 'selected';

  return (
    <View
      style={[
        styles.base,
        isReal && styles.real,
        isSelected && styles.selected,
        style,
      ]}
    >
      <View style={styles.indexTab}>
        <Text style={styles.indexText}>{isReal ? '真' : isSelected ? '推' : '案'}</Text>
      </View>
      <View style={styles.inner}>
        {variant === 'hidden' ? (
          <Text style={styles.hiddenText}>タイトル案</Text>
        ) : (
          <Text style={[styles.title, isReal && styles.titleReal]} numberOfLines={4}>
            {title}
          </Text>
        )}
        {author && !isReal && <Text style={styles.author}>作：{author}</Text>}
        {isReal && <Text style={styles.realLabel}>本物のタイトル</Text>}
      </View>
      {(isReal || isSelected) && (
        <Stamp type={isReal ? '正解' : '推'} size="sm" style={styles.stamp} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.navy,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadows.paper,
  },
  real: {
    borderColor: colors.red,
    backgroundColor: '#FFF1F4',
  },
  selected: {
    borderColor: colors.yellow,
    backgroundColor: '#FFF7C8',
  },
  indexTab: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: colors.white, fontWeight: '900', fontSize: 13 },
  inner: { flex: 1 },
  hiddenText: { fontSize: 15, color: colors.muted, fontWeight: '700' },
  title: { fontSize: 16, color: colors.ink, fontWeight: '800', lineHeight: 25 },
  titleReal: { color: colors.red },
  author: { fontSize: 11, color: colors.muted, marginTop: 4 },
  realLabel: { fontSize: 11, color: colors.red, fontWeight: '800', marginTop: 4 },
  stamp: { flexShrink: 0 },
});

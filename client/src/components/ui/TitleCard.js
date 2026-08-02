import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, shadows } from '../../theme';
import Stamp from './Stamp';

export default function TitleCard({ title, variant = 'hidden', author, style }) {
  const isReal = variant === 'correct';
  const isSelected = variant === 'selected';

  return (
    <View style={[styles.base, isReal && styles.real, isSelected && styles.selected, style]}>
      <View style={styles.inner}>
        {variant === 'hidden' ? (
          <Text style={styles.hiddenText}>—</Text>
        ) : (
          <Text style={[styles.title, isReal && styles.titleReal]} numberOfLines={4}>
            {title}
          </Text>
        )}
        {author && !isReal && (
          <Text style={styles.author}>作：{author}</Text>
        )}
        {isReal && (
          <Text style={styles.realLabel}>本物のタイトル</Text>
        )}
      </View>
      {isReal && <Stamp type="真" size="md" style={styles.stamp} />}
      {isSelected && !isReal && <Stamp type="推" size="md" style={styles.stamp} />}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.paper,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.paper,
  },
  real: {
    borderColor: colors.vermilion,
    backgroundColor: '#FFF8F7',
  },
  selected: {
    borderColor: colors.vermilion,
    backgroundColor: '#FFF8F7',
  },
  inner: { flex: 1 },
  hiddenText: { fontSize: 20, color: colors.muted, textAlign: 'center' },
  title: { fontSize: 16, color: colors.ink, fontWeight: '500', lineHeight: 26 },
  titleReal: { color: colors.vermilion, fontWeight: '700' },
  author: { fontSize: 11, color: colors.muted, marginTop: 4 },
  realLabel: { fontSize: 11, color: colors.vermilion, fontWeight: '600', marginTop: 4 },
  stamp: { marginLeft: 10, flexShrink: 0 },
});

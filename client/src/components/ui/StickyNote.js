import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, shadows } from '../../theme';

const ACCENT = {
  blue: colors.blue,
  mustard: colors.mustard,
  rose: colors.rose,
  green: colors.green,
};

const BG = {
  blue: '#EFF4FA',
  mustard: '#FBF5E6',
  rose: '#FAF0EF',
  green: '#EFF6F2',
};

export default function StickyNote({ children, color = 'mustard', style }) {
  const accent = ACCENT[color] ?? colors.mustard;
  const bg = BG[color] ?? BG.mustard;

  return (
    <View
      style={[styles.base, { backgroundColor: bg, borderLeftColor: accent }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {typeof children === 'string' ? (
        <Text style={[styles.text, { color: accent }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderLeftWidth: 4,
    borderRadius: radii.sm,
    padding: 12,
    ...shadows.paper,
  },
  text: {
    fontSize: 13,
    lineHeight: 20,
  },
});

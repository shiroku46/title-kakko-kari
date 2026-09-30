import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';

const PALETTES = {
  blue: { backgroundColor: '#DDF5F8', borderColor: colors.cyan, text: colors.navy },
  mustard: { backgroundColor: '#FFF1B3', borderColor: colors.yellow, text: colors.navy },
  rose: { backgroundColor: '#FFE2EC', borderColor: colors.pink, text: colors.navy },
  green: { backgroundColor: '#E0F4E6', borderColor: colors.green, text: colors.navy },
};

export default function StickyNote({ children, color = 'mustard', style }) {
  const palette = PALETTES[color] ?? PALETTES.mustard;
  return (
    <View
      style={[styles.base, palette, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.tape, { backgroundColor: palette.borderColor }]} />
      {typeof children === 'string' ? (
        <Text style={[styles.text, { color: palette.text }]}>{children}</Text>
      ) : children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'relative',
    borderRadius: radii.sm,
    borderWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tape: {
    position: 'absolute',
    width: 34,
    height: 8,
    top: -6,
    left: 16,
    opacity: 0.72,
    transform: [{ rotate: '-4deg' }],
  },
  text: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
});

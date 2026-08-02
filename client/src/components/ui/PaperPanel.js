import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radii, shadows } from '../../theme';

export default function PaperPanel({ children, variant = 'flat', style }) {
  return (
    <View style={[styles.base, variant === 'elevated' && styles.elevated, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.paper,
    borderRadius: radii.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.paper,
  },
  elevated: {
    ...shadows.elevated,
    borderWidth: 0,
  },
});

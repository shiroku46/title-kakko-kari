import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radii, shadows } from '../../theme';

const TONES = {
  white: { backgroundColor: colors.white, borderColor: colors.navy },
  cream: { backgroundColor: colors.cream, borderColor: colors.navy },
  sky: { backgroundColor: '#E8F7FA', borderColor: colors.navy },
  yellow: { backgroundColor: '#FFF2B8', borderColor: colors.navy },
  pink: { backgroundColor: '#FFE6EF', borderColor: colors.navy },
  navy: { backgroundColor: colors.navy, borderColor: colors.navyDeep },
};

export default function PaperPanel({
  children,
  variant = 'flat',
  tone = 'white',
  style,
}) {
  const toneStyle = TONES[tone] ?? TONES.white;
  return (
    <View
      style={[
        styles.base,
        toneStyle,
        variant === 'elevated' && styles.elevated,
        tone === 'navy' && styles.navyPanel,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    padding: 20,
    borderWidth: 2,
    ...shadows.paper,
  },
  elevated: {
    ...shadows.elevated,
    transform: [{ translateY: -1 }],
  },
  navyPanel: {
    shadowColor: colors.navyDeep,
  },
});

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './GameText';
import { colors } from '../../theme';
import { fontFamilies } from '../../theme/typography';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

export default function GameLogo({ compact = false, light = false, style }) {
  const { isPC } = useResponsiveLayout();
  const baseColor = light ? colors.white : colors.navy;
  return (
    <View style={[styles.wrap, style]} accessibilityLabel="タイトルたほいや">
      <Text
        style={[
          styles.logo,
          compact ? styles.logoCompact : styles.logoFull,
          !compact && !isPC && styles.logoMobile,
          { color: baseColor },
        ]}
      >
        タイトル
        <Text style={styles.logoAccent}>たほいや</Text>
      </Text>
      {!compact && (
        <Text style={[styles.subtitle, { color: light ? colors.cream : colors.muted }]}>
          命名系クイズゲーム
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start' },
  logo: {
    fontFamily: fontFamilies.display,
    fontWeight: '900',
    letterSpacing: -1.2,
    textShadowColor: 'rgba(7,31,54,0.16)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  logoFull: { fontSize: 40, lineHeight: 56 },
  logoCompact: { fontSize: 20, lineHeight: 30 },
  logoMobile: { fontSize: 30, lineHeight: 44 },
  logoAccent: { color: colors.red },
  subtitle: {
    marginTop: 3,
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.6,
  },
});

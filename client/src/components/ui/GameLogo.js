import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';
import { fontFamilies } from '../../theme/typography';

export default function GameLogo({ compact = false, light = false, style }) {
  const baseColor = light ? colors.white : colors.navy;
  return (
    <View style={[styles.wrap, style]} accessibilityLabel="タイトルたほいや">
      <Text
        style={[
          styles.logo,
          compact ? styles.logoCompact : styles.logoFull,
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
    fontFamily: fontFamilies.sansBold,
    fontWeight: '900',
    letterSpacing: -1.2,
    textShadowColor: 'rgba(7,31,54,0.16)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  logoFull: { fontSize: 44, lineHeight: 50 },
  logoCompact: { fontSize: 23, lineHeight: 28 },
  logoAccent: { color: colors.red },
  subtitle: {
    marginTop: 3,
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.6,
  },
});

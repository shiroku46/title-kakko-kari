import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { GAME_NAME, brandAssets } from '../../theme/brand';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

export default function GameLogo({ compact = false, style }) {
  const { isPC } = useResponsiveLayout();
  return (
    <View style={[styles.wrap, compact && styles.compact, compact && !isPC && styles.compactMobile, style]}>
      <Image
        source={brandAssets.logo}
        style={styles.image}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel={GAME_NAME}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 2137 / 736 },
  compact: { width: 190 },
  compactMobile: { width: 134 },
  image: { width: '100%', height: '100%' },
});

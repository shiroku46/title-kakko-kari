import React, { useRef, useEffect } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { colors, radii } from '../../theme';

const RECT_TYPES = new Set(['準備OK', '正解', 'MVP']);

export default function Stamp({ type, size = 'md', animate = false, style }) {
  const scale = useRef(new Animated.Value(animate ? 0.35 : 1)).current;
  const opacity = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 120,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animate, opacity, scale]);

  const isRect = RECT_TYPES.has(type);
  const dim = size === 'lg' ? 58 : size === 'sm' ? 30 : 44;
  const fontSize = isRect ? (size === 'sm' ? 10 : 12) : Math.round(dim * 0.38);

  return (
    <Animated.View
      style={[
        styles.base,
        isRect
          ? [styles.rect, { minHeight: dim * 0.68, paddingHorizontal: dim / 3 }]
          : [styles.circle, { width: dim, height: dim, borderRadius: dim / 2 }],
        { transform: [{ scale }], opacity },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.label, { fontSize }]}>{type}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {},
  rect: {
    borderRadius: radii.sm,
    paddingVertical: 5,
  },
  label: {
    color: colors.white,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});

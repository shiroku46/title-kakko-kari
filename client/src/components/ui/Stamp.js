import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { colors, radii } from '../../theme';

const RECT_TYPES = new Set(['準備OK']);

export default function Stamp({ type, size = 'md', animate = false, style }) {
  const scale = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const opacity = useRef(new Animated.Value(animate ? 0 : 0.85)).current;

  useEffect(() => {
    if (!animate) return;
    Animated.sequence([
      Animated.delay(80),
      Animated.parallel([
        Animated.spring(scale, { toValue: 1.15, useNativeDriver: true, friction: 4 }),
        Animated.timing(opacity, { toValue: 0.85, duration: 150, useNativeDriver: true }),
      ]),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }),
    ]).start();
  }, [animate]);

  const isRect = RECT_TYPES.has(type);
  const dim = size === 'lg' ? 56 : size === 'sm' ? 32 : 44;
  const fontSize = isRect ? (size === 'sm' ? 10 : 12) : Math.round(dim * 0.4);

  return (
    <Animated.View
      style={[
        styles.base,
        isRect
          ? [styles.rect, { paddingHorizontal: dim / 3, minHeight: dim * 0.7 }]
          : [styles.circle, { width: dim, height: dim, borderRadius: dim / 2 }],
        { transform: [{ scale }], opacity },
        style,
      ]}
      accessibilityLabel={`判子: ${type}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.label, { fontSize }]}>{type}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 2,
    borderColor: colors.vermilion,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {},
  rect: {
    borderRadius: radii.sm,
    paddingVertical: 4,
  },
  label: {
    color: colors.vermilion,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

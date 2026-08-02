import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';

function Clip({ style }) {
  return (
    <View
      style={[styles.clip, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.clipInner} />
    </View>
  );
}

function MaskingTape({ color = colors.mustard, angle = -3, style }) {
  return (
    <View
      style={[
        styles.tape,
        { backgroundColor: color + '55', borderColor: color + '99', transform: [{ rotate: `${angle}deg` }] },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function Pencil({ style }) {
  return (
    <View
      style={[styles.pencilWrap, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.pencilBody} />
      <View style={styles.pencilTip} />
    </View>
  );
}

function Eraser({ style }) {
  return (
    <View
      style={[styles.eraser, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.eraserText}>MONO</Text>
    </View>
  );
}

function Bookmark({ color = colors.vermilion, style }) {
  return (
    <View
      style={[styles.bookmark, { backgroundColor: color + 'CC' }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export { Clip, MaskingTape, Pencil, Eraser, Bookmark };

const styles = StyleSheet.create({
  clip: {
    width: 16,
    height: 36,
    borderWidth: 2,
    borderColor: colors.wood,
    borderRadius: 3,
    overflow: 'hidden',
  },
  clipInner: {
    position: 'absolute',
    top: 6,
    left: 3,
    right: 3,
    bottom: 6,
    borderWidth: 2,
    borderColor: colors.wood,
    borderRadius: 2,
  },
  tape: {
    width: 64,
    height: 18,
    borderWidth: 1,
    borderRadius: 2,
  },
  pencilWrap: { flexDirection: 'row', alignItems: 'center' },
  pencilBody: {
    width: 80,
    height: 10,
    backgroundColor: colors.mustard,
    borderWidth: 1,
    borderColor: colors.wood,
  },
  pencilTip: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.wood,
  },
  eraser: {
    width: 36,
    height: 18,
    backgroundColor: colors.rose + 'AA',
    borderWidth: 1,
    borderColor: colors.rose,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eraserText: { fontSize: 7, color: colors.white, fontWeight: '700', letterSpacing: 0.5 },
  bookmark: {
    width: 16,
    height: 48,
    borderRadius: 2,
  },
});

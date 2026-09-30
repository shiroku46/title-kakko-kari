import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../../theme';

export default function PopBackdrop({ children, style }) {
  return (
    <View style={[styles.root, style]}>
      <View pointerEvents="none" style={[styles.blob, styles.blobTop]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobRight]} />
      <View pointerEvents="none" style={[styles.paper, styles.paperA]} />
      <View pointerEvents="none" style={[styles.paper, styles.paperB]} />
      <View pointerEvents="none" style={[styles.confetti, styles.confettiA]} />
      <View pointerEvents="none" style={[styles.confetti, styles.confettiB]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.7,
  },
  blobTop: {
    width: 260,
    height: 260,
    backgroundColor: colors.sky,
    top: -120,
    left: -70,
  },
  blobRight: {
    width: 360,
    height: 360,
    backgroundColor: '#FDE7EC',
    right: -180,
    bottom: -200,
  },
  paper: {
    position: 'absolute',
    borderRadius: 14,
    opacity: 0.48,
    borderWidth: 2,
  },
  paperA: {
    width: 100,
    height: 64,
    backgroundColor: colors.yellow,
    borderColor: colors.navy,
    right: 30,
    top: 120,
    transform: [{ rotate: '8deg' }],
  },
  paperB: {
    width: 86,
    height: 52,
    backgroundColor: colors.cyan,
    borderColor: colors.navy,
    left: 24,
    bottom: 50,
    transform: [{ rotate: '-10deg' }],
  },
  confetti: {
    position: 'absolute',
    width: 16,
    height: 6,
    borderRadius: 3,
  },
  confettiA: {
    backgroundColor: colors.red,
    right: 180,
    top: 82,
    transform: [{ rotate: '30deg' }],
  },
  confettiB: {
    backgroundColor: colors.yellow,
    left: 160,
    bottom: 96,
    transform: [{ rotate: '-25deg' }],
  },
});

import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radii, shadows } from '../../theme';
import { fontFamilies } from '../../theme/typography';

export default function StationeryButton({
  children,
  variant = 'primary',
  disabled = false,
  loading = false,
  onPress,
  accessibilityLabel,
  style,
  textStyle,
}) {
  const isDisabled = disabled || loading;
  const spinnerColor = ['primary', 'secondary'].includes(variant) ? colors.white : colors.navy;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        styles[variant] ?? styles.primary,
        isDisabled && styles.disabledBtn,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: isDisabled }}
      activeOpacity={0.82}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text
          style={[
            styles.text,
            styles[`${variant}Text`] ?? styles.primaryText,
            isDisabled && styles.disabledText,
            textStyle,
          ]}
        >
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radii.md,
    paddingHorizontal: 20,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    ...shadows.button,
  },
  primary: {
    backgroundColor: colors.red,
    borderColor: colors.navy,
  },
  secondary: {
    backgroundColor: colors.blue,
    borderColor: colors.navy,
  },
  yellow: {
    backgroundColor: colors.yellow,
    borderColor: colors.navy,
  },
  neutral: {
    backgroundColor: colors.white,
    borderColor: colors.navy,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  danger: {
    backgroundColor: colors.navy,
    borderColor: colors.navyDeep,
  },
  disabledBtn: {
    backgroundColor: '#DDE5E9',
    borderColor: '#AEBAC2',
    shadowOpacity: 0,
    opacity: 0.72,
    elevation: 0,
  },
  text: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  primaryText: { color: colors.white },
  secondaryText: { color: colors.white },
  yellowText: { color: colors.navy },
  neutralText: { color: colors.navy },
  ghostText: { color: colors.navy },
  dangerText: { color: colors.white },
  disabledText: { color: colors.muted },
});

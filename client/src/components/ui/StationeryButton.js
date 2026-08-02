import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';
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

  return (
    <TouchableOpacity
      style={[styles.base, styles[variant], isDisabled && styles.disabledBtn, style]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: isDisabled }}
      activeOpacity={0.75}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.white : colors.ink}
          size="small"
        />
      ) : (
        <Text style={[styles.text, styles[`${variant}Text`], isDisabled && styles.disabledText, textStyle]}>
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.vermilion,
  },
  secondary: {
    backgroundColor: colors.paperSubtle,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabledBtn: {
    backgroundColor: colors.paperSubtle,
    opacity: 0.55,
    borderWidth: 0,
  },
  text: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    fontWeight: '700',
  },
  primaryText: { color: colors.white },
  secondaryText: { color: colors.ink },
  ghostText: { color: colors.muted },
  disabledText: { color: colors.muted },
});

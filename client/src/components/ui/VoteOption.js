import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';
import Stamp from './Stamp';

export default function VoteOption({ choice, selected, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.base, selected && styles.selected, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={choice.title}
    >
      <View style={[styles.radio, selected && styles.radioSelected]} />
      <Text style={[styles.text, selected && styles.textSelected]} numberOfLines={4}>
        {choice.title}
      </Text>
      {selected && <Stamp type="推" size="sm" style={styles.stamp} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 8,
    backgroundColor: colors.paper,
    minHeight: 44,
  },
  selected: { borderColor: colors.vermilion, backgroundColor: '#FFF8F7' },
  disabled: { opacity: 0.55 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 12,
    flexShrink: 0,
  },
  radioSelected: { borderColor: colors.vermilion, backgroundColor: colors.vermilion },
  text: { flex: 1, fontSize: 15, color: colors.ink, lineHeight: 22 },
  textSelected: { color: colors.vermilion, fontWeight: '600' },
  stamp: { marginLeft: 8, flexShrink: 0 },
});

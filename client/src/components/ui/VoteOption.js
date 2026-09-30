import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { colors, radii, shadows } from '../../theme';

export default function VoteOption({ choice, selected, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[
        styles.base,
        selected && styles.selected,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={choice.title}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioCore} />}
      </View>
      <Text style={[styles.text, selected && styles.textSelected]} numberOfLines={4}>
        {choice.title}
      </Text>
      <View style={[styles.tag, selected && styles.tagSelected]}>
        <Text style={[styles.tagText, selected && styles.tagTextSelected]}>
          {selected ? 'これに投票' : '選ぶ'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 13,
    marginBottom: 9,
    backgroundColor: colors.white,
    minHeight: 58,
    gap: 11,
  },
  selected: {
    borderColor: colors.navy,
    backgroundColor: '#FFF0A8',
    ...shadows.paper,
  },
  disabled: { opacity: 0.62 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioSelected: { backgroundColor: colors.white },
  radioCore: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.red,
  },
  text: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    fontWeight: '700',
    lineHeight: 22,
  },
  textSelected: { color: colors.navy, fontWeight: '900' },
  tag: {
    borderRadius: radii.pill,
    backgroundColor: '#EDF2F5',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagSelected: { backgroundColor: colors.red },
  tagText: { fontSize: 10, fontWeight: '800', color: colors.muted },
  tagTextSelected: { color: colors.white },
});

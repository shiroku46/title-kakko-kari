import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Text } from './GameText';
import { colors, radii, shadows } from '../../theme';

export default function VoteOption({ choice, selected, disabled, isOwn = false, onPress }) {
  const isDisabled = disabled || isOwn;
  return (
    <TouchableOpacity
      style={[
        styles.base,
        selected && styles.selected,
        isOwn && styles.own,
        isDisabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.82}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected, disabled: isDisabled }}
      accessibilityLabel={isOwn ? `${choice.title}、自分のタイトル、投票できません` : choice.title}
    >
      <View style={[styles.radio, selected && styles.radioSelected, isOwn && styles.radioOwn]}>
        {selected && <View style={styles.radioCore} />}
      </View>
      <Text style={[styles.text, selected && styles.textSelected, isOwn && styles.textOwn]} numberOfLines={4}>
        {choice.title}
      </Text>
      <View style={[styles.tag, selected && styles.tagSelected]}>
        <Text style={[styles.tagText, selected && styles.tagTextSelected]}>
          {isOwn ? '自分のタイトル\n投票不可' : selected ? 'これに投票' : '選ぶ'}
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
  own: { backgroundColor: '#EDF2F5', borderColor: colors.border },
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
  radioOwn: { borderColor: colors.muted },
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
  textOwn: { color: colors.muted },
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

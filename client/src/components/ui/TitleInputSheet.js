import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';
import PaperPanel from './PaperPanel';
import StationeryButton from './StationeryButton';
import Stamp from './Stamp';

export default function TitleInputSheet({
  synopsis,
  value,
  onChangeText,
  onSubmit,
  submitted,
  submittedTitle,
  maxLength = 40,
  loading = false,
}) {
  const charCount = value?.length ?? 0;

  if (submitted) {
    return (
      <PaperPanel>
        <View style={styles.submittedRow}>
          <Stamp type="封" size="md" animate />
          <View style={styles.submittedInfo}>
            <Text style={styles.submittedLabel}>タイトル案を提出しました</Text>
            <Text style={styles.submittedTitle} numberOfLines={3}>
              「{submittedTitle}」
            </Text>
          </View>
        </View>
      </PaperPanel>
    );
  }

  return (
    <PaperPanel>
      {synopsis ? (
        <>
          <Text style={styles.fieldLabel}>お題のあらすじ</Text>
          <Text style={styles.synopsis}>{synopsis}</Text>
          <View style={styles.divider} />
        </>
      ) : null}
      <Text style={styles.fieldLabel}>タイトル案を記入</Text>
      <TextInput
        style={styles.input}
        placeholder="本物らしいタイトルを考えて..."
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        accessibilityLabel="タイトル案の入力欄"
      />
      <Text style={styles.charCount}>{charCount} / {maxLength}</Text>
      <StationeryButton
        variant="primary"
        onPress={onSubmit}
        loading={loading}
        disabled={!value?.trim()}
        accessibilityLabel="タイトル案を提出する"
        style={styles.submitBtn}
      >
        提出する
      </StationeryButton>
    </PaperPanel>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  synopsis: { fontSize: 15, color: colors.ink, lineHeight: 24, marginBottom: 16 },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: 16 },
  input: {
    backgroundColor: colors.canvas,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    minHeight: 50,
    marginBottom: 4,
  },
  charCount: { fontSize: 11, color: colors.muted, textAlign: 'right', marginBottom: 14 },
  submitBtn: {},
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  submittedInfo: { flex: 1 },
  submittedLabel: { fontSize: 12, color: colors.muted, marginBottom: 4 },
  submittedTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, lineHeight: 26 },
});

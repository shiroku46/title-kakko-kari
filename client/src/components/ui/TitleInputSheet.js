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
      <PaperPanel tone="yellow" variant="elevated">
        <View style={styles.submittedRow}>
          <Stamp type="封" size="md" animate />
          <View style={styles.submittedInfo}>
            <Text style={styles.submittedLabel}>タイトル案を提出しました</Text>
            <Text style={styles.submittedTitle} numberOfLines={3}>
              {submittedTitle}
            </Text>
            <Text style={styles.submittedNote}>ほかの参加者の提出を待っています。</Text>
          </View>
        </View>
      </PaperPanel>
    );
  }

  return (
    <PaperPanel tone="cream" variant="elevated">
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.kicker}>YOUR TITLE</Text>
          <Text style={styles.heading}>それっぽいタイトルを考える</Text>
        </View>
        <View style={styles.pencilBadge}>
          <Text style={styles.pencilText}>✎</Text>
        </View>
      </View>

      {synopsis ? (
        <View style={styles.synopsisBox}>
          <Text style={styles.fieldLabel}>お題のあらすじ</Text>
          <Text style={styles.synopsis}>{synopsis}</Text>
        </View>
      ) : null}

      <Text style={styles.fieldLabel}>タイトル案</Text>
      <TextInput
        style={styles.input}
        placeholder="本物らしいタイトルを入力"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        accessibilityLabel="タイトル案の入力欄"
      />
      <View style={styles.metaRow}>
        <Text style={styles.hint}>短くても、長くてもOK。</Text>
        <Text style={styles.charCount}>{charCount} / {maxLength}</Text>
      </View>
      <StationeryButton
        variant="primary"
        onPress={onSubmit}
        loading={loading}
        disabled={!value?.trim()}
        accessibilityLabel="タイトル案を提出する"
      >
        タイトル案を提出する →
      </StationeryButton>
    </PaperPanel>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: colors.red,
    marginBottom: 4,
  },
  heading: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '900',
    color: colors.navy,
  },
  pencilBadge: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: colors.cyan,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '5deg' }],
  },
  pencilText: { fontSize: 21, color: colors.navy, fontWeight: '900' },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.navy,
    marginBottom: 7,
    letterSpacing: 0.5,
  },
  synopsisBox: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  synopsis: { fontSize: 14, color: colors.ink, lineHeight: 22 },
  input: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.ink,
    minHeight: 54,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 14,
  },
  hint: { fontSize: 11, color: colors.muted },
  charCount: { fontSize: 11, color: colors.muted, fontWeight: '700' },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  submittedInfo: { flex: 1 },
  submittedLabel: { fontSize: 12, color: colors.muted, marginBottom: 5 },
  submittedTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: colors.navy,
    lineHeight: 27,
  },
  submittedNote: { fontSize: 11, color: colors.muted, marginTop: 6 },
});

import { fontFamilies } from '../../theme/typography';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput } from './GameText';
import { colors, radii } from '../../theme';
import PaperPanel from './PaperPanel';
import StationeryButton from './StationeryButton';
import Stamp from './Stamp';
import WorkIntroduction from './WorkIntroduction';

export default function TitleInputSheet({
  synopsis,
  workKindLabel,
  value,
  onChangeText,
  onSubmit,
  submitted,
  submittedTitle,
  editing = false,
  canReplace = false,
  onStartEdit,
  onCancelEdit,
  submittedCount = 0,
  submissionTotal = 0,
  maxLength = 200,
  loading = false,
}) {
  const charCount = value?.length ?? 0;
  const submissionProgress = (
    <View style={[styles.submissionProgress, submitted && styles.submissionProgressSubmitted]}>
      <Text style={styles.submissionProgressLabel}>みんなの提出状況</Text>
      <Text testID="submission-progress" accessibilityLiveRegion="polite" style={styles.submissionProgressCount}>
        {submissionTotal ? `${submittedCount} / ${submissionTotal} 人が提出済み` : `${submittedCount} 人が提出済み`}
      </Text>
    </View>
  );

  if (submitted && (!editing || !canReplace)) {
    return (
      <PaperPanel tone="yellow" variant="elevated">
        <View style={styles.submittedRow}>
          <Stamp type="封" size="md" animate />
          <View style={styles.submittedInfo}>
            <Text style={styles.submittedLabel}>タイトル案を提出しました</Text>
            <Text style={styles.submittedTitle}>
              {submittedTitle}
            </Text>
            <Text style={styles.submittedNote}>
              {canReplace
                ? '全員が提出するまでは、タイトルを何度でも差し替えできます。'
                : '全員の提出が揃ったため、タイトルは変更できません。'}
            </Text>
          </View>
        </View>
        {submissionProgress}
        {canReplace ? (
          <StationeryButton variant="secondary" onPress={onStartEdit} accessibilityLabel="提出したタイトルを差し替える">
            タイトルを差し替える
          </StationeryButton>
        ) : null}
      </PaperPanel>
    );
  }

  return (
    <PaperPanel tone="cream" variant="elevated">
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.heading}>{editing ? 'タイトルを差し替える' : 'それっぽいタイトルを考える'}</Text>
        </View>
      </View>

      {synopsis ? (
        <View style={styles.synopsisBox}>
          <WorkIntroduction synopsis={synopsis} workKindLabel={workKindLabel} />
        </View>
      ) : null}
      {submissionProgress}
      {editing ? <Text style={styles.editingHint}>差し替えを確定すると、前のタイトル案が上書きされます。</Text> : null}
      <Text style={styles.fieldLabel}>{editing ? '新しいタイトル案' : 'タイトル案'}</Text>
      <TextInput
        style={styles.input}
        placeholder="本物らしいタイトルを入力"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline
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
        disabled={!value?.trim() || (editing && (!canReplace || value.trim() === submittedTitle.trim()))}
        accessibilityLabel={editing ? 'タイトル案の差し替えを確定する' : 'タイトル案を提出する'}
      >
        {editing ? 'このタイトルに差し替える →' : 'タイトル案を提出する →'}
      </StationeryButton>
      {editing ? (
        <StationeryButton variant="ghost" onPress={onCancelEdit} disabled={loading} accessibilityLabel="差し替え編集をやめる">
          編集をやめる
        </StationeryButton>
      ) : null}
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

  heading: {
    fontFamily: fontFamilies.display,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '900',
    color: colors.navy,
  },

  fieldLabel: {
    fontSize: 13,
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
  hint: { fontSize: 13, color: colors.muted },
  charCount: { fontSize: 13, color: colors.muted, fontWeight: '700' },
  submissionProgress: {
    backgroundColor: colors.white, borderRadius: radii.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'space-between', gap: 8, marginBottom: 16,
  },
  submissionProgressSubmitted: { marginTop: 16, marginBottom: 0 },
  submissionProgressLabel: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  submissionProgressCount: { color: colors.navy, fontSize: 16, fontWeight: '900' },
  editingHint: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  submittedInfo: { flex: 1 },
  submittedLabel: { fontSize: 12, color: colors.muted, marginBottom: 5 },
  submittedTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: colors.navy,
    lineHeight: 27,
  },
  submittedNote: { fontSize: 13, color: colors.muted, marginTop: 6 },
});

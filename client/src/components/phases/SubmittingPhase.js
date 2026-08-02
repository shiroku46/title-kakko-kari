import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { colors, radii } from '../../theme';
import { PaperPanel, RoundHeader, Stamp, TitleInputSheet } from '../ui';

export default function SubmittingPhase({
  currentRound, totalRounds, questioner,
  synopsis, isQuestioner, fakeSubmittedCount, socket,
}) {
  const [fakeTitle, setFakeTitle] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmitFake() {
    if (!fakeTitle.trim()) return Alert.alert('エラー', 'タイトルを入力してください');
    socket.emit('round:submit_fake', { title: fakeTitle.trim() }, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setSubmitted(true);
    });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <RoundHeader
          currentRound={currentRound}
          totalRounds={totalRounds}
          questioner={questioner}
          phase="タイトル案を提出"
        />

        {isQuestioner ? (
          <PaperPanel>
            <Text style={styles.cardTitle}>提出状況</Text>
            <Text style={styles.progressNum}>{fakeSubmittedCount}</Text>
            <Text style={styles.progressSub}>人が提出しました</Text>
            <Text style={styles.cardNote}>全員提出完了で自動的に投票フェーズへ移行します</Text>
          </PaperPanel>
        ) : (
          <TitleInputSheet
            synopsis={synopsis}
            value={fakeTitle}
            onChangeText={setFakeTitle}
            onSubmit={handleSubmitFake}
            submitted={submitted}
            submittedTitle={fakeTitle}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  cardNote: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  progressNum: {
    fontSize: 56,
    fontWeight: '800',
    color: colors.vermilion,
    textAlign: 'center',
  },
  progressSub: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 12 },
});

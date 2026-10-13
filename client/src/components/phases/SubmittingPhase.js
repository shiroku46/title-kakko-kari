import WorkIntroduction from '../ui/WorkIntroduction';
import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '../ui/GameText';
import { colors, radii } from '../../theme';
import {
  PaperPanel,
  RoundHeader,
  TitleInputSheet,
  PopBackdrop,
} from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';
import { useSocketListeners } from '../../hooks/useSocket';

export default function SubmittingPhase({
  round,
  currentRound,
  totalRounds,
  questioner,
  synopsis,
  workKindLabel,
  isQuestioner,
  fakeSubmittedCount,
  consent = false,
  realTitle,
  submittedAnswers = [],
  initialSubmitted = false,
  initialTitle = '',
  socket,
}) {
  const [fakeTitle, setFakeTitle] = useState(initialTitle);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const pendingRef = useRef(false);
  const { isPC, contentPadding } = useResponsiveLayout();
  useSocketListeners({
    'round:fake_saved': ({ roundId }) => {
      if (roundId === round.id) {
        setSubmitted(true);
        setRequestError(null);
      }
    },
  });

  function handleSubmitFake() {
    if (pendingRef.current || submitted) return;
    if (!fakeTitle.trim()) return setRequestError('タイトルを入力してください');
    if (!socket?.connected) return setRequestError('接続が切れています。接続を確認してください。');
    pendingRef.current = true;
    setSubmitting(true);
    setRequestError(null);
    socket.timeout(10000).emit('round:submit_fake', { title: fakeTitle.trim(), roundId: round?.id }, (error, res) => {
      pendingRef.current = false;
      setSubmitting(false);
      if (error) return setRequestError('返事がありません。接続を確認して、もう一度お試しください。');
      if (!res?.ok) return setRequestError(res?.error || 'タイトルを送れませんでした。もう一度お試しください。');
      setSubmitted(true);
    });
  }

  return (
    <PopBackdrop>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <RoundHeader
            currentRound={currentRound}
            totalRounds={totalRounds}
            questioner={questioner}
            phase={isQuestioner ? 'みんなのタイトル案を待つ' : 'それっぽいタイトルを考える'}
          />

          {isQuestioner ? (
            <View style={[styles.layout, isPC && styles.layoutPC]}>
              <View style={[styles.mainColumn, isPC && styles.mainColumnPC]}>
                <PaperPanel tone="cream">
                  <WorkIntroduction synopsis={synopsis} workKindLabel={workKindLabel} realTitle={realTitle} />
                </PaperPanel>
                <PaperPanel tone="navy" style={styles.questionerPanel}>
                  <Text style={styles.questionerTitle}>みんなのタイトル案</Text>
                  <Text style={styles.questionerBody}>
                    出題者はタイトルを提出しません。{consent ? '提出が揃うか制限時間が終わると、投票へ進められます。' : '提出が揃うか制限時間が終わると、投票へ進みます。'}
                  </Text>
                  <View style={styles.answerList}>
                    {submittedAnswers.length ? submittedAnswers.map((answer, index) => (
                      <Text key={answer.id} testID="questioner-answer" style={styles.answerItem}>{index + 1}. {answer.title}</Text>
                    )) : <Text style={styles.emptyAnswer}>まだ提出されていません。</Text>}
                  </View>
                </PaperPanel>
              </View>
              <View style={[styles.sideColumn, isPC && styles.sideColumnPC]}>
                <PaperPanel tone="yellow" style={styles.progressPanel}>
                  <Text style={styles.progressTitle}>提出状況</Text>
                  <View style={styles.progressValueRow}>
                    <Text testID="submission-progress" accessibilityLiveRegion="polite" style={styles.progressValue}>{fakeSubmittedCount}</Text>
                    <Text style={styles.progressUnit}>人が提出</Text>
                  </View>
                  <Text style={styles.progressNote}>みんなの提出状況は自動で更新されます。</Text>
                </PaperPanel>
                <PaperPanel tone="sky" style={styles.tipPanel}>
                  <Text style={styles.tipTitle}>出題者のヒント</Text>
                  <Text style={styles.tipText}>回答者には作品の紹介文だけが表示されています。</Text>
                </PaperPanel>
              </View>
            </View>
          ) : (
            <View style={styles.answererLayout}>
              {requestError ? (
                <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.requestError}>
                  {requestError}
                </Text>
              ) : null}
              <TitleInputSheet
                synopsis={synopsis}
                workKindLabel={workKindLabel}
                value={fakeTitle}
                onChangeText={(value) => {
                  if (pendingRef.current) return;
                  setFakeTitle(value);
                  setRequestError(null);
                }}
                onSubmit={handleSubmitFake}
                submitted={submitted}
                submittedTitle={fakeTitle}
                loading={submitting}
                submittedCount={fakeSubmittedCount}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </PopBackdrop>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    width: '100%', alignSelf: 'center', paddingTop: Platform.OS === 'web' ? 22 : 54,
    paddingBottom: 40,
  },
  layout: { gap: 14 },
  layoutPC: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  mainColumn: { gap: 14 },
  mainColumnPC: { flex: 1.7 },
  sideColumn: { gap: 14 },
  sideColumnPC: { flex: 0.75 },
  questionerPanel: {},
  questionerTitle: { color: colors.white, fontSize: 22, lineHeight: 30, fontWeight: '900', marginTop: 5 },
  questionerBody: { color: '#D5E3ED', fontSize: 14, lineHeight: 23, marginTop: 8 },
  answerList: { marginTop: 15, gap: 5 },
  answerItem: { color: colors.white, fontSize: 16, lineHeight: 26, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#52728A' },
  emptyAnswer: { color: '#D5E3ED', fontSize: 15, lineHeight: 24 },
  progressPanel: {},
  progressTitle: { color: colors.navy, fontSize: 19, fontWeight: '900', marginTop: 4 },
  progressValueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 10, marginTop: 14 },
  progressValue: { color: colors.red, fontSize: 48, lineHeight: 58, fontWeight: '900' },
  progressUnit: { color: colors.navy, fontSize: 16, fontWeight: '900' },
  progressNote: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 10 },
  tipPanel: {},
  tipTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  tipText: { color: colors.ink, fontSize: 14, lineHeight: 22, marginTop: 6 },
  answererLayout: { gap: 12 },
  requestError: { color: colors.redDark, backgroundColor: colors.cream, padding: 14,
    borderRadius: radii.md, fontSize: 14, lineHeight: 22 },
});

import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text } from '../ui/GameText';
import { PaperPanel, StationeryButton, RoundHeader, PopBackdrop } from '../ui';
import { colors } from '../../theme';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function RejectedPhase({ currentRound, totalRounds, questioner,
  rejectedQuestion, canReselect, canSkip, mode, socket }) {
  const { contentPadding } = useResponsiveLayout();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const pendingRef = useRef(false);

  function nextQuestion() {
    if (pendingRef.current) return;
    if (!socket?.connected) {
      setErrorMessage('サーバーに接続していません。接続を確認してください。');
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    const event = canSkip ? 'game:next_round' : 'round:next_question';
    socket.timeout(10000).emit(event, null, (error, res) => {
      pendingRef.current = false;
      setPending(false);
      if (error || !res?.ok) setErrorMessage(error
        ? 'サーバーから応答がありません。もう一度お試しください。'
        : res?.error || '操作できませんでした。もう一度お試しください。');
    });
  }

  return (
    <PopBackdrop>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: contentPadding }]}>
        <RoundHeader currentRound={currentRound} totalRounds={totalRounds}
          questioner={questioner} phase="選び直すお題の答え" />
        <PaperPanel tone="cream" variant="elevated" style={styles.panel}>
          <Text style={styles.heading}>このお題は変更します</Text>
          <Text style={styles.note}>知っている人がいたため、別の作品で遊びます。このお題では得点は入りません。</Text>
          <Text style={styles.label}>本物のタイトル</Text>
          <Text accessibilityLiveRegion="polite" style={styles.title}>{rejectedQuestion?.realTitle}</Text>
          <Text style={styles.synopsis}>{rejectedQuestion?.synopsis}</Text>
          {errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text> : null}
          {canReselect || canSkip ? (
            <StationeryButton onPress={nextQuestion} loading={pending}
              accessibilityLabel={canSkip ? '次の出題者へ進む' : '次のお題へ進む'}>
              {canSkip ? '次の出題者へ進む →' : '次のお題へ進む →'}
            </StationeryButton>
          ) : (
            <Text style={styles.note}>{mode === 'cpu' ? 'ホスト' : '出題者'}が次のお題を用意するまでお待ちください。</Text>
          )}
        </PaperPanel>
      </ScrollView>
    </PopBackdrop>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', paddingTop: 22, paddingBottom: 40 },
  panel: { padding: 22, gap: 16 },
  heading: { color: colors.navy, fontSize: 22, lineHeight: 30, fontWeight: '900' },
  note: { color: colors.muted, fontSize: 14, lineHeight: 23 },
  label: { color: colors.navy, fontSize: 14, fontWeight: '700' },
  title: { color: colors.redDark, fontSize: 26, lineHeight: 36, fontWeight: '900' },
  synopsis: { color: colors.ink, fontSize: 16, lineHeight: 27 },
  error: { color: colors.redDark, fontSize: 14, lineHeight: 23 },
});

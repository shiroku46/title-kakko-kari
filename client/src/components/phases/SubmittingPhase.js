import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, radii } from '../../theme';
import {
  PaperPanel,
  RoundHeader,
  TitleInputSheet,
  PopBackdrop,
} from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function SubmittingPhase({
  currentRound,
  totalRounds,
  questioner,
  synopsis,
  isQuestioner,
  fakeSubmittedCount,
  socket,
}) {
  const [fakeTitle, setFakeTitle] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { contentPadding } = useResponsiveLayout();

  function handleSubmitFake() {
    if (!fakeTitle.trim()) return Alert.alert('入力してください', 'タイトルを入力してください');
    socket.emit('round:submit_fake', { title: fakeTitle.trim() }, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
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
            <View style={styles.questionerLayout}>
              <PaperPanel tone="navy" variant="elevated" style={styles.progressPanel}>
                <Text style={styles.kicker}>SUBMISSION STATUS</Text>
                <Text style={styles.progressTitle}>タイトル案を受付中</Text>
                <Text style={styles.progressNote}>
                  内容は結果発表まで見えません。全員の提出が揃うと、自動的に投票へ進みます。
                </Text>

                <View style={styles.counterWrap}>
                  <View style={styles.counterBubble}>
                    <Text style={styles.counterNum}>{fakeSubmittedCount}</Text>
                    <Text style={styles.counterUnit}>人提出</Text>
                  </View>
                  <View style={styles.cardStack}>
                    <View style={[styles.miniCard, styles.miniCardA]} />
                    <View style={[styles.miniCard, styles.miniCardB]} />
                    <View style={[styles.miniCard, styles.miniCardC]}>
                      <Text style={styles.miniCardText}>TITLE</Text>
                    </View>
                  </View>
                </View>
              </PaperPanel>

              <PaperPanel tone="yellow" style={styles.tipPanel}>
                <Text style={styles.tipTitle}>出題者のヒント</Text>
                <Text style={styles.tipText}>
                  回答者には、あらすじだけが表示されています。どんなタイトルが集まるか、お楽しみに。
                </Text>
              </PaperPanel>
            </View>
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
    </PopBackdrop>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 22 : 54,
    paddingBottom: 40,
  },
  questionerLayout: { gap: 14 },
  progressPanel: { alignItems: 'center', paddingVertical: 30 },
  kicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  progressTitle: { color: colors.white, fontSize: 25, lineHeight: 34, fontWeight: '900', marginTop: 6 },
  progressNote: {
    color: '#BCD1E0',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 560,
    marginTop: 8,
  },
  counterWrap: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  counterBubble: {
    width: 126,
    height: 126,
    borderRadius: 63,
    backgroundColor: colors.yellow,
    borderWidth: 4,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterNum: { color: colors.navy, fontSize: 48, lineHeight: 54, fontWeight: '900' },
  counterUnit: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  cardStack: { width: 120, height: 100, position: 'relative' },
  miniCard: {
    position: 'absolute',
    width: 90,
    height: 62,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.white,
  },
  miniCardA: {
    left: 2,
    top: 16,
    backgroundColor: colors.cyan,
    transform: [{ rotate: '-10deg' }],
  },
  miniCardB: {
    left: 24,
    top: 10,
    backgroundColor: colors.pink,
    transform: [{ rotate: '7deg' }],
  },
  miniCardC: {
    left: 14,
    top: 24,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCardText: { color: colors.navy, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  tipPanel: {},
  tipTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  tipText: { color: colors.ink, fontSize: 12, lineHeight: 19, marginTop: 5 },
});

import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, TextInput } from '../ui/GameText';
import { colors, radii } from '../../theme';
import {
  PaperPanel,
  StationeryButton,
  RoundHeader,
  PopBackdrop,
} from '../ui';
import { getCurrentUrl } from '../../hooks/useSocket';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function SelectingPhase({
  currentRound,
  totalRounds,
  questioner,
  synopsis,
  isQuestioner,
  isHost,
  questionerDisconnected = false,
  knownDeclarations = [],
  allDeclared,
  socket,
}) {
  const [synopsisText, setSynopsisText] = useState('');
  const [realTitle, setRealTitle] = useState('');
  const [automaticQuestionId, setAutomaticQuestionId] = useState(null);
  const [declared, setDeclared] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [skipConfirming, setSkipConfirming] = useState(false);
  const requestPendingRef = useRef(false);
  const fetching = pendingAction === 'fetch';
  const requestBusy = Boolean(pendingAction);
  const { isPC, contentPadding } = useResponsiveLayout();

  function showError(action, message) {
    setRequestError({ action, message });
  }

  function requestAction(event, payload, onSuccess) {
    if (requestPendingRef.current) return;
    if (!socket?.connected) {
      showError(event, 'サーバーに接続していません。接続を確認して、もう一度お試しください。');
      return;
    }
    requestPendingRef.current = true;
    setPendingAction(event);
    setRequestError(null);
    socket.timeout(10000).emit(event, payload, (error, res) => {
      requestPendingRef.current = false;
      setPendingAction(null);
      if (error) {
        showError(event, 'サーバーから応答がありません。接続を確認して、もう一度お試しください。');
      } else if (!res?.ok) {
        showError(event, res?.error || '操作できませんでした。もう一度お試しください。');
      } else {
        onSuccess?.();
      }
    });
  }

  async function handleAutoFetch() {
    if (requestPendingRef.current) return;
    requestPendingRef.current = true;
    setPendingAction('fetch');
    setRequestError(null);
    const controller = new AbortController();
    // An empty bank may discover and verify new source material on demand.
    const timeout = setTimeout(() => controller.abort(), 70000);
    try {
      const baseUrl = getCurrentUrl() || 'https://title-kakko-kari.onrender.com';
      const res = await fetch(`${baseUrl}/api/random-work`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showError('fetch', data.error ?? '問題が見つかりませんでした。再試行してください。');
        return;
      }
      setSynopsisText(data.synopsis);
      setRealTitle(data.title);
      setAutomaticQuestionId(data.questionId ?? null);
    } catch (err) {
      if (err.name === 'AbortError') {
        showError('fetch', '取得に時間がかかりすぎました。もう一度お試しください。');
      } else {
        showError('fetch', '問題を取得できませんでした。接続を確認して、もう一度お試しください。');
      }
    } finally {
      clearTimeout(timeout);
      requestPendingRef.current = false;
      setPendingAction(null);
    }
  }

  function handleSubmitSynopsis() {
    if (requestPendingRef.current) return;
    if (!synopsisText.trim()) return showError('round:submit_synopsis', '作品の紹介文を入力してください');
    if (!realTitle.trim()) return showError('round:submit_synopsis', '本物のタイトルを入力してください');
    requestAction(
      'round:submit_synopsis',
      {
        synopsis: synopsisText.trim(),
        realTitle: realTitle.trim(),
        ...(automaticQuestionId && { questionId: automaticQuestionId }),
      },
      () => setSubmitted(true)
    );
  }

  function handleDeclareKnown() {
    requestAction('round:declare_known', null, () => setDeclared('known'));
  }

  function handleDeclareUnknown() {
    requestAction('round:declare_unknown', null, () => setDeclared('unknown'));
  }

  function handleReselect() {
    requestAction('round:reselect', null, () => {
      setSubmitted(false);
      setAutomaticQuestionId(null);
    });
  }

  function handleStartSubmitting() {
    requestAction('round:start_submitting', null);
  }

  function handleSkipRound() {
    if (!requestPendingRef.current) setSkipConfirming(true);
  }

  const hasKnown = knownDeclarations.length > 0;
  const canAdvance = allDeclared && !hasKnown;
  const errorNotice = requestError ? (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
      {requestError.message}
    </Text>
  ) : null;

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
            phase={isQuestioner ? '作品と紹介文を決める' : 'この作品、知っていますか？'}
          />

          {questionerDisconnected ? (
            <PaperPanel tone="navy" variant="elevated" style={styles.waitPanel}>
              <Text style={styles.waitTitle}>出題する人が部屋から出ました</Text>
              <Text style={styles.waitText}>
                {isHost ? 'この回を飛ばして、次の人の出題へ進めます。' : 'ホストが次の出題へ進めます。'}
              </Text>
              {requestError ? (
                <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.waitErrorText}>
                  {requestError.message}
                </Text>
              ) : null}
              {isHost && (
                skipConfirming ? (
                  <View style={styles.skipConfirmation}>
                    <Text style={styles.waitText}>この回を飛ばして次へ進みますか？</Text>
                    <View style={styles.actionRow}>
                      <StationeryButton
                        variant="neutral"
                        onPress={() => setSkipConfirming(false)}
                        disabled={requestBusy}
                      >
                        キャンセル
                      </StationeryButton>
                      <StationeryButton
                        variant="yellow"
                        onPress={() => requestAction('game:next_round', null, () => setSkipConfirming(false))}
                        loading={pendingAction === 'game:next_round'}
                        disabled={requestBusy}
                        accessibilityLabel="ラウンドのスキップを確定する"
                      >
                        スキップする
                      </StationeryButton>
                    </View>
                  </View>
                ) : (
                  <StationeryButton
                    variant="yellow"
                    onPress={handleSkipRound}
                    disabled={requestBusy}
                    accessibilityLabel="このラウンドをスキップ"
                    style={styles.skipButton}
                  >
                    このラウンドをスキップ
                  </StationeryButton>
                )
              )}
            </PaperPanel>
          ) : isQuestioner ? (
            !submitted ? (
              <View style={[styles.questionerLayout, isPC && styles.questionerLayoutPC]}>
                <PaperPanel
                  tone="navy"
                  style={[styles.guidePanel, isPC && styles.guidePanelPC]}
                >
                  <Text style={styles.guideKicker}>QUESTIONER</Text>
                  <Text style={styles.guideTitle}>出題する作品を選びましょう</Text>
                  <Text style={styles.guideBody}>
                    マイナーだけれど面白い作品ほど、みんなのタイトル案が広がります。
                  </Text>

                  <View style={styles.guideSteps}>
                    {[
                      ['1', '作品を決める'],
                      ['2', '作品の紹介文を入力'],
                      ['3', '本物のタイトルを秘密に登録'],
                    ].map(([num, label]) => (
                      <View key={num} style={styles.guideStep}>
                        <View style={styles.guideStepNum}>
                          <Text style={styles.guideStepNumText}>{num}</Text>
                        </View>
                        <Text style={styles.guideStepLabel}>{label}</Text>
                      </View>
                    ))}
                  </View>
                </PaperPanel>

                <PaperPanel
                  tone="cream"
                  variant="elevated"
                  style={[styles.formPanel, isPC && styles.formPanelPC]}
                >
                  <View style={styles.formHeadingRow}>
                    <View>
                      <Text style={styles.kicker}>MAKE A QUESTION</Text>
                      <Text style={styles.heading}>作品の紹介文を用意する</Text>
                    </View>
                    <View style={styles.secretBadge}>
                      <Text style={styles.secretBadgeText}>本物は非公開</Text>
                    </View>
                  </View>

                  <StationeryButton
                    variant="secondary"
                    onPress={handleAutoFetch}
                    loading={fetching}
                    disabled={requestBusy}
                    accessibilityLabel="出典付きの問題を自動取得"
                    style={styles.autoFetchButton}
                  >
                    出典付きの問題を自動取得
                  </StationeryButton>
                  <Text style={styles.helperText}>
                    出典は答え合わせで表示されます。編集した場合は手入力の問題として扱います。
                  </Text>
                  {requestError?.action === 'fetch' ? errorNotice : null}

                  <Text style={styles.fieldLabel}>作品の紹介文</Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    placeholder="作品のタイトルが分からないように、紹介文を入力…"
                    placeholderTextColor={colors.muted}
                    value={synopsisText}
                    editable={!requestBusy}
                    onChangeText={(text) => {
                      setSynopsisText(text);
                      setAutomaticQuestionId(null);
                      setRequestError(null);
                    }}
                    multiline
                    numberOfLines={6}
                    accessibilityLabel="作品の紹介文入力欄"
                  />

                  <Text style={styles.fieldLabel}>本物のタイトル</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="結果発表まで参加者には見えません"
                    placeholderTextColor={colors.muted}
                    value={realTitle}
                    editable={!requestBusy}
                    onChangeText={(text) => {
                      setRealTitle(text);
                      setAutomaticQuestionId(null);
                      setRequestError(null);
                    }}
                    accessibilityLabel="本物タイトル入力欄"
                  />

                  {requestError?.action !== 'fetch' ? errorNotice : null}
                  <StationeryButton
                    variant="primary"
                    onPress={handleSubmitSynopsis}
                    loading={pendingAction === 'round:submit_synopsis'}
                    disabled={requestBusy}
                    accessibilityLabel="作品の紹介文を提示する"
                  >
                    作品の紹介文を提示する →
                  </StationeryButton>
                </PaperPanel>
              </View>
            ) : (
              <View style={[styles.afterSubmitLayout, isPC && styles.afterSubmitLayoutPC]}>
                <PaperPanel
                  tone="cream"
                  variant="elevated"
                  style={styles.synopsisPanel}
                >
                  <View style={styles.formHeadingRow}>
                    <View>
                      <Text style={styles.kicker}>SYNOPSIS OPEN</Text>
                      <Text style={styles.heading}>作品の紹介文を公開しました</Text>
                    </View>
                    <View style={styles.openBadge}>
                      <Text style={styles.openBadgeText}>回答受付中</Text>
                    </View>
                  </View>

                  <View style={styles.synopsisBox}>
                    <Text style={styles.synopsisText}>{synopsisText}</Text>
                  </View>

                  {hasKnown ? (
                    <View style={styles.knownBox}>
                      <Text style={styles.knownTitle}>「知ってる！」の回答があります</Text>
                      <Text style={styles.knownNames}>{knownDeclarations.join('、')}</Text>
                      <Text style={styles.knownNote}>別の作品を選び直してください。</Text>
                    </View>
                  ) : canAdvance ? (
                    <View style={styles.successBox}>
                      <Text style={styles.successTitle}>全員が「知らない」と回答しました</Text>
                      <Text style={styles.successText}>タイトル案の提出へ進めます。</Text>
                    </View>
                  ) : (
                    <View style={styles.waitingBox}>
                      <View style={styles.waitingDots}>
                        <View style={[styles.dot, { backgroundColor: colors.red }]} />
                        <View style={[styles.dot, { backgroundColor: colors.yellow }]} />
                        <View style={[styles.dot, { backgroundColor: colors.cyan }]} />
                      </View>
                      <Text style={styles.waitingText}>みんなの回答を待っています…</Text>
                    </View>
                  )}

                  {errorNotice}
                  <View style={styles.actionRow}>
                    <StationeryButton
                      variant="neutral"
                      onPress={handleReselect}
                      loading={pendingAction === 'round:reselect'}
                      disabled={requestBusy}
                      accessibilityLabel="作品を選び直す"
                      style={styles.actionButton}
                    >
                      作品を選び直す
                    </StationeryButton>
                    <StationeryButton
                      variant="primary"
                      onPress={handleStartSubmitting}
                      loading={pendingAction === 'round:start_submitting'}
                      disabled={!canAdvance || requestBusy}
                      accessibilityLabel="タイトル案提出へ進む"
                      style={styles.actionButton}
                    >
                      タイトル案の提出へ →
                    </StationeryButton>
                  </View>
                </PaperPanel>
              </View>
            )
          ) : (
            <View style={[styles.answererLayout, isPC && styles.answererLayoutPC]}>
              {!synopsis ? (
                <PaperPanel tone="navy" variant="elevated" style={styles.waitPanel}>
                  <Text style={styles.waitKicker}>WAITING FOR QUESTION</Text>
                  <Text style={styles.waitTitle}>
                    {questioner?.nickname}さんが作品を選んでいます
                  </Text>
                  <Text style={styles.waitText}>
                    作品の紹介文が届くまで、このままお待ちください。
                  </Text>
                  <View style={styles.waitIllustration}>
                    <View style={[styles.waitCard, styles.waitCardBack]} />
                    <View style={[styles.waitCard, styles.waitCardFront]}>
                      <Text style={styles.waitCardText}>?</Text>
                    </View>
                  </View>
                  {requestError ? (
                    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.waitErrorText}>
                      {requestError.message}
                    </Text>
                  ) : null}
                </PaperPanel>
              ) : (
                <>
                  <PaperPanel tone="cream" variant="elevated" style={styles.synopsisPanel}>
                    <View style={styles.synopsisHeading}>
                      <View style={styles.synopsisIcon}>
                        <Text style={styles.synopsisIconText}>文</Text>
                      </View>
                      <View style={styles.synopsisHeadingText}>
                        <Text style={styles.kicker}>READ & ANSWER</Text>
                        <Text style={styles.heading}>このタイトルを知っていますか？</Text>
                      </View>
                    </View>
                    <View style={styles.synopsisBox}>
                      <Text style={styles.synopsisText}>{synopsis}</Text>
                    </View>
                  </PaperPanel>

                  {declared === null ? (
                    <PaperPanel tone="white" style={styles.declarePanel}>
                      <Text style={styles.declareQuestion}>
                        本物のタイトルが分かりますか？
                      </Text>
                      <Text style={styles.declareNote}>
                        ひとりでも知っている場合は、別の作品へ変更します。
                      </Text>
                      {errorNotice}
                      <View style={styles.declareRow}>
                        <StationeryButton
                          variant="neutral"
                          onPress={handleDeclareKnown}
                          loading={pendingAction === 'round:declare_known'}
                          disabled={requestBusy}
                          accessibilityLabel="知ってると宣言"
                          style={styles.declareButton}
                        >
                          知ってる！
                        </StationeryButton>
                        <StationeryButton
                          variant="primary"
                          onPress={handleDeclareUnknown}
                          loading={pendingAction === 'round:declare_unknown'}
                          disabled={requestBusy}
                          accessibilityLabel="知らないと回答"
                          style={styles.declareButton}
                        >
                          知らない →
                        </StationeryButton>
                      </View>
                    </PaperPanel>
                  ) : (
                    <PaperPanel
                      tone={declared === 'known' ? 'pink' : 'sky'}
                      style={styles.declaredPanel}
                    >
                      <View style={[
                        styles.declaredIcon,
                        declared === 'known' ? styles.declaredIconKnown : styles.declaredIconUnknown,
                      ]}>
                        <Text style={styles.declaredIconText}>
                          {declared === 'known' ? '!' : '✓'}
                        </Text>
                      </View>
                      <View style={styles.declaredBody}>
                        <Text style={styles.declaredTitle}>
                          {declared === 'known'
                            ? '「知ってる！」と回答しました'
                            : '「知らない」と回答しました'}
                        </Text>
                        <Text style={styles.declaredNote}>
                          {declared === 'known'
                            ? '出題者が別の作品を選び直します。'
                            : '全員の回答が揃うまでお待ちください。'}
                        </Text>
                      </View>
                    </PaperPanel>
                  )}
                </>
              )}
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
    width: '100%',
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 22 : 54,
    paddingBottom: 40,
  },
  questionerLayout: { gap: 14 },
  questionerLayoutPC: { flexDirection: 'row', alignItems: 'stretch' },
  guidePanel: {},
  guidePanelPC: { flex: 0.75 },
  guideKicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  guideTitle: { color: colors.white, fontSize: 23, lineHeight: 32, fontWeight: '900', marginTop: 6 },
  guideBody: { color: '#C2D5E4', fontSize: 12, lineHeight: 20, marginTop: 9 },
  guideSteps: { gap: 10, marginTop: 22 },
  guideStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  guideStepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideStepNumText: { color: colors.navy, fontWeight: '900' },
  guideStepLabel: { color: colors.white, fontSize: 13, fontWeight: '800', flex: 1 },
  formPanel: {},
  formPanelPC: { flex: 1.25 },
  formHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 13,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    marginBottom: 15,
  },
  kicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  heading: { color: colors.navy, fontSize: 21, lineHeight: 29, fontWeight: '900', marginTop: 3 },
  secretBadge: {
    backgroundColor: colors.pink,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  secretBadgeText: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  openBadge: {
    backgroundColor: colors.cyan,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  openBadgeText: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  autoFetchButton: { marginBottom: 6 },
  helperText: { color: colors.muted, fontSize: 10, textAlign: 'center', marginBottom: 13 },
  errorText: { color: colors.redDark, fontSize: 13, lineHeight: 21, marginTop: 8, marginBottom: 12 },
  fieldLabel: { color: colors.navy, fontSize: 11, fontWeight: '900', marginBottom: 7 },
  input: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 15,
  },
  textarea: { minHeight: 132, textAlignVertical: 'top' },
  afterSubmitLayout: {},
  afterSubmitLayoutPC: {},
  synopsisPanel: {},
  synopsisBox: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.navy,
    padding: 18,
  },
  synopsisText: { color: colors.ink, fontSize: 15, lineHeight: 25 },
  knownBox: {
    backgroundColor: '#FFE4EC',
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.red,
    padding: 14,
    marginTop: 14,
  },
  knownTitle: { color: colors.red, fontSize: 14, fontWeight: '900' },
  knownNames: { color: colors.navy, fontSize: 15, fontWeight: '800', marginTop: 5 },
  knownNote: { color: colors.muted, fontSize: 11, marginTop: 4 },
  successBox: {
    backgroundColor: '#E2F6E8',
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.green,
    padding: 14,
    marginTop: 14,
  },
  successTitle: { color: colors.navy, fontSize: 14, fontWeight: '900' },
  successText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  waitingBox: {
    marginTop: 14,
    backgroundColor: '#E8F5F8',
    borderRadius: radii.md,
    padding: 14,
    alignItems: 'center',
  },
  waitingDots: { flexDirection: 'row', gap: 7, marginBottom: 7 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  waitingText: { color: colors.navy, fontSize: 12, fontWeight: '800' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 15 },
  actionButton: { flex: 1, minWidth: 180 },
  answererLayout: { gap: 14 },
  answererLayoutPC: {},
  waitPanel: { alignItems: 'center', paddingVertical: 34 },
  waitKicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  waitTitle: { color: colors.white, fontSize: 22, lineHeight: 31, fontWeight: '900', marginTop: 7, textAlign: 'center' },
  waitText: { color: '#BCD1E0', fontSize: 12, lineHeight: 19, marginTop: 7, textAlign: 'center' },
  waitErrorText: { color: colors.yellow, fontSize: 13, lineHeight: 21, marginTop: 12, textAlign: 'center' },
  skipConfirmation: { alignItems: 'center', marginTop: 12 },
  waitIllustration: { width: 110, height: 80, marginTop: 20, position: 'relative' },
  waitCard: {
    position: 'absolute',
    width: 72,
    height: 54,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.white,
  },
  waitCardBack: {
    backgroundColor: colors.cyan,
    left: 8,
    top: 8,
    transform: [{ rotate: '-8deg' }],
  },
  waitCardFront: {
    backgroundColor: colors.yellow,
    right: 7,
    top: 16,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '7deg' }],
  },
  waitCardText: { color: colors.navy, fontSize: 24, fontWeight: '900' },
  skipButton: { marginTop: 14, minWidth: 240 },
  synopsisHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  synopsisIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  synopsisIconText: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  synopsisHeadingText: { flex: 1 },
  declarePanel: {},
  declareQuestion: { color: colors.navy, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  declareNote: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  declareRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  declareButton: { flex: 1, minWidth: 150 },
  declaredPanel: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  declaredIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declaredIconKnown: { backgroundColor: colors.pink },
  declaredIconUnknown: { backgroundColor: colors.cyan },
  declaredIconText: { color: colors.navy, fontSize: 21, fontWeight: '900' },
  declaredBody: { flex: 1 },
  declaredTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  declaredNote: { color: colors.muted, fontSize: 11, marginTop: 3 },
});

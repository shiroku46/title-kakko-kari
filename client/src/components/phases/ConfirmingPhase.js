import WorkIntroduction from '../ui/WorkIntroduction';
import GenreSelector from '../ui/GenreSelector';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text } from '../ui/GameText';
import { colors } from '../../theme';
import {
  PaperPanel,
  StationeryButton,
  RoundHeader,
  PopBackdrop,
} from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function ConfirmingPhase({
  round,
  currentRound,
  totalRounds,
  fetchedSynopsis,
  genreDisclosure = false,
  workKind,
  workKindLabel,
  synopsisError,
  isHost,
  canUseManual = true,
  socket,
  onRerollStart,
}) {
  const { contentPadding } = useResponsiveLayout();
  const [pendingAction, setPendingAction] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [selectedKind, setSelectedKind] = useState(workKind || null);
  const requestPendingRef = useRef(false);
  const displayError = requestError || synopsisError;
  useEffect(() => { if (workKind) setSelectedKind(workKind); }, [workKind]);
  const preview = !genreDisclosure || selectedKind === workKind ? fetchedSynopsis : null;
  const choosingGenre = genreDisclosure && (!workKind || selectedKind !== workKind);

  function requestAction(event, action) {
    if (!isHost || requestPendingRef.current) return;
    if (!socket?.connected) {
      setRequestError('サーバーに接続していません。接続を確認して、もう一度お試しください。');
      return;
    }
    requestPendingRef.current = true;
    setPendingAction(action);
    setRequestError(null);
    if (action === 'reroll') onRerollStart?.(selectedKind);
    socket.timeout(10000).emit(event, { roundId: round?.id,
      ...(action === 'reroll' && genreDisclosure && { workKind: selectedKind }) }, (error, res) => {
      requestPendingRef.current = false;
      setPendingAction(null);
      if (error) {
        setRequestError('サーバーから応答がありません。接続を確認して、もう一度お試しください。');
      } else if (!res?.ok) {
        setRequestError(res?.error || '操作できませんでした。もう一度お試しください。');
      }
    });
  }

  function handleConfirm() {
    if (!preview) return;
    requestAction('round:confirm_synopsis', 'confirm');
  }

  function handleReroll() {
    if (genreDisclosure && !selectedKind) {
      setRequestError('先に作品のジャンルを選択してください');
      return;
    }
    requestAction('round:reroll_synopsis', 'reroll');
  }

  return (
    <PopBackdrop>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
        ]}
      >
        <RoundHeader
          currentRound={currentRound}
          totalRounds={totalRounds}
          questioner={null}
          phase={choosingGenre ? 'ジャンルを選んでCPUに出題してもらう' : 'CPUが選んだ作品を確認'}
        />

        {isHost ? (
          <PaperPanel tone="cream" variant="elevated" style={{ padding: contentPadding }}>
            {genreDisclosure ? <GenreSelector workKind={selectedKind} onSelect={(kind) => {
              setSelectedKind(kind); setRequestError(null);
            }} disabled={Boolean(pendingAction)} /> : null}
            {!preview ? (
              <View style={styles.loadingBox}>
                <View style={styles.loadingIcon}>
                  {!displayError && !choosingGenre ? (
                    <ActivityIndicator color={colors.red} size="large" />
                  ) : displayError ? (
                    <Text style={styles.loadingErrorIcon}>!</Text>
                  ) : null}
                </View>
                <Text style={styles.loadingTitle}>
                  {displayError ? '作品を取得できませんでした' : choosingGenre ? 'ジャンルを選んで問題を用意しましょう' : '作品を探しています…'}
                </Text>
                <Text
                  accessibilityRole={displayError ? 'alert' : undefined}
                  accessibilityLiveRegion="polite"
                  style={[styles.loadingText, displayError && styles.errorText]}
                >
                  {displayError || (choosingGenre ? 'ジャンルを選択してから、下のボタンで問題を選びます。' : 'ネットで作品を検索し、元のページから紹介文を取得しています。')}
                </Text>
                {(displayError || genreDisclosure) && (
                  <StationeryButton
                    variant="secondary"
                    onPress={handleReroll}
                    loading={pendingAction === 'reroll'}
                    disabled={Boolean(pendingAction) || (genreDisclosure && !selectedKind)}
                    accessibilityLabel={genreDisclosure ? '選んだジャンルで問題を選ぶ' : '作品の紹介文を再取得'}
                    style={styles.loadingButton}
                  >
                    {genreDisclosure ? '選んだジャンルで問題を選ぶ' : 'もう一度検索する'}
                  </StationeryButton>
                )}
                {canUseManual && <StationeryButton variant="neutral"
                  onPress={() => requestAction('round:use_manual', 'manual')}
                  loading={pendingAction === 'manual'} disabled={Boolean(pendingAction)}
                  accessibilityLabel="手動で出題する" style={styles.loadingButton}>
                  手動で出題する
                </StationeryButton>}
                <Text style={styles.loadingText}>{canUseManual ? 'ホストが文章と答えを入力して、この回を続けられます。' : '1人で遊ぶ場合はCPUの出題を使います。取得できなければ、もう一度検索してください。'}</Text>
              </View>
            ) : (
              <>
                <View style={styles.headingRow}>
                  <View style={styles.headingCopy}>
                    <Text style={styles.heading}>この紹介文をみんなに提示しますか？</Text>
                  </View>
                  <View style={styles.cpuBadge}>
                    <Text style={styles.cpuBadgeText}>CPU出題</Text>
                  </View>
                </View>
                <View style={styles.synopsisBox}>
                  <WorkIntroduction synopsis={preview} workKindLabel={workKindLabel} />
                </View>
                <Text style={styles.note}>
                  本物のタイトルと出典は、答え合わせで表示されます。
                </Text>

                {displayError ? (
                  <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
                    {displayError}
                  </Text>
                ) : null}
                <View style={styles.buttonRow}>
                  <StationeryButton
                    variant="neutral"
                    onPress={handleReroll}
                    loading={pendingAction === 'reroll'}
                    disabled={Boolean(pendingAction)}
                    style={styles.secondaryButton}
                    accessibilityLabel="別の作品を取得"
                  >
                    別の作品にする
                  </StationeryButton>
                  <StationeryButton
                    variant="primary"
                    onPress={handleConfirm}
                    loading={pendingAction === 'confirm'}
                    disabled={Boolean(pendingAction)}
                    style={styles.primaryButton}
                    accessibilityLabel="この紹介文で進む"
                  >
                    この紹介文を提示する →
                  </StationeryButton>
                </View>
              </>
            )}
          </PaperPanel>
        ) : (
          <PaperPanel tone="navy" variant="elevated" style={styles.waitPanel}>
            <View style={styles.waitDots}>
              <View style={[styles.dot, { backgroundColor: colors.red }]} />
              <View style={[styles.dot, { backgroundColor: colors.yellow }]} />
              <View style={[styles.dot, { backgroundColor: colors.cyan }]} />
            </View>
            <Text style={styles.waitTitle}>ホストが作品を確認しています</Text>
            <Text style={styles.waitText}>
              作品の紹介文が決まるまで、このままお待ちください。
            </Text>
          </PaperPanel>
        )}
      </ScrollView>
    </PopBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 22 : 54,
    paddingBottom: 40,
  },
  headingRow: {
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 16,
  },

  headingCopy: { width: '100%' },
  heading: { color: colors.navy, fontSize: 24, lineHeight: 34, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  cpuBadge: {
    flexShrink: 0,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  cpuBadgeText: { color: colors.muted, fontSize: 13, fontWeight: '900' },
  synopsisBox: {
    padding: 16,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingTop: 27,
  },

  note: { color: colors.muted, fontSize: 13, lineHeight: 22, marginTop: 10, marginBottom: 24, textAlign: 'center' },
  errorText: { color: colors.redDark, fontSize: 13, lineHeight: 21, marginBottom: 12 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  secondaryButton: { flex: 1, minWidth: 170 },
  primaryButton: { flex: 1, minWidth: 220 },
  loadingBox: { alignItems: 'center', paddingVertical: 34 },
  loadingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#E7F5F7',
    borderWidth: 0,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingErrorIcon: { color: colors.red, fontSize: 34, fontWeight: '900' },
  loadingTitle: { color: colors.navy, fontSize: 20, fontWeight: '900', marginTop: 16 },
  loadingText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  loadingButton: { marginTop: 16, minWidth: 220 },
  waitPanel: { alignItems: 'center', paddingVertical: 42 },
  waitDots: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  dot: { width: 13, height: 13, borderRadius: 7 },
  waitTitle: { color: colors.white, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  waitText: { color: '#BCD1E0', fontSize: 12, lineHeight: 19, marginTop: 7, textAlign: 'center' },
});

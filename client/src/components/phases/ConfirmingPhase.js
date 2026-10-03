import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text } from '../ui/GameText';
import { colors, radii } from '../../theme';
import {
  PaperPanel,
  StationeryButton,
  RoundHeader,
  PopBackdrop,
} from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function ConfirmingPhase({
  currentRound,
  totalRounds,
  fetchedSynopsis,
  synopsisError,
  isHost,
  socket,
  onRerollStart,
}) {
  const { contentPadding } = useResponsiveLayout();
  const [pendingAction, setPendingAction] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const requestPendingRef = useRef(false);
  const displayError = requestError || synopsisError;

  function requestAction(event, action) {
    if (!isHost || requestPendingRef.current) return;
    if (!socket?.connected) {
      setRequestError('サーバーに接続していません。接続を確認して、もう一度お試しください。');
      return;
    }
    requestPendingRef.current = true;
    setPendingAction(action);
    setRequestError(null);
    if (action === 'reroll') onRerollStart?.();
    socket.timeout(10000).emit(event, null, (error, res) => {
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
    if (!fetchedSynopsis) return;
    requestAction('round:confirm_synopsis', 'confirm');
  }

  function handleReroll() {
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
          phase="CPUが選んだ作品を確認"
        />

        {isHost ? (
          <PaperPanel tone="cream" variant="elevated" style={styles.panel}>
            {!fetchedSynopsis ? (
              <View style={styles.loadingBox}>
                <View style={styles.loadingIcon}>
                  {!displayError ? (
                    <ActivityIndicator color={colors.red} size="large" />
                  ) : (
                    <Text style={styles.loadingErrorIcon}>!</Text>
                  )}
                </View>
                <Text style={styles.loadingTitle}>
                  {displayError ? '作品を取得できませんでした' : '作品を探しています…'}
                </Text>
                <Text
                  accessibilityRole={displayError ? 'alert' : undefined}
                  accessibilityLiveRegion="polite"
                  style={[styles.loadingText, displayError && styles.errorText]}
                >
                  {displayError || 'ネットで作品を検索し、元のページから紹介文を取得しています。'}
                </Text>
                {displayError && (
                  <StationeryButton
                    variant="secondary"
                    onPress={handleReroll}
                    loading={pendingAction === 'reroll'}
                    disabled={Boolean(pendingAction)}
                    accessibilityLabel="作品の紹介文を再取得"
                    style={styles.loadingButton}
                  >
                    もう一度検索する
                  </StationeryButton>
                )}
                <StationeryButton variant="neutral"
                  onPress={() => requestAction('round:use_manual', 'manual')}
                  loading={pendingAction === 'manual'} disabled={Boolean(pendingAction)}
                  accessibilityLabel="手動で出題する" style={styles.loadingButton}>
                  手動で出題する
                </StationeryButton>
                <Text style={styles.loadingText}>ホストが文章と答えを入力して、この回を続けられます。</Text>
              </View>
            ) : (
              <>
                <View style={styles.headingRow}>
                  <View style={styles.headingCopy}>
                    <Text style={styles.kicker}>WORK CHECK</Text>
                    <Text style={styles.heading}>この紹介文をみんなに提示しますか？</Text>
                  </View>
                  <View style={styles.cpuBadge}>
                    <Text style={styles.cpuBadgeText}>CPU出題</Text>
                  </View>
                </View>

                <View style={styles.synopsisBox}>
                  <View style={styles.synopsisTab}>
                    <Text style={styles.synopsisTabText}>作品の紹介文</Text>
                  </View>
                  <Text style={styles.synopsisText}>{fetchedSynopsis}</Text>
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
  panel: { padding: 22 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    marginBottom: 16,
  },
  kicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.7 },
  headingCopy: { flex: 1, minWidth: 0 },
  heading: { color: colors.navy, fontSize: 21, lineHeight: 29, fontWeight: '900', marginTop: 3 },
  cpuBadge: {
    flexShrink: 0,
    backgroundColor: colors.cyan,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  cpuBadgeText: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  synopsisBox: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.navy,
    padding: 18,
    paddingTop: 27,
    position: 'relative',
  },
  synopsisTab: {
    position: 'absolute',
    top: -10,
    left: 16,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.navy,
    borderRadius: radii.sm,
    paddingHorizontal: 11,
    paddingVertical: 4,
    transform: [{ rotate: '-2deg' }],
  },
  synopsisTabText: { color: colors.navy, fontSize: 11, fontWeight: '900' },
  synopsisText: { color: colors.ink, fontSize: 16, lineHeight: 27 },
  note: { color: colors.muted, fontSize: 11, marginTop: 10, marginBottom: 15 },
  errorText: { color: colors.redDark, fontSize: 13, lineHeight: 21, marginBottom: 12 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  secondaryButton: { flex: 1, minWidth: 170 },
  primaryButton: { flex: 1.5, minWidth: 220 },
  loadingBox: { alignItems: 'center', paddingVertical: 34 },
  loadingIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#E7F5F7',
    borderWidth: 2,
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

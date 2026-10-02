import React, { useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Text } from '../ui/GameText';
import { colors, radii } from '../../theme';
import { PaperPanel, StationeryButton, RoundHeader, PopBackdrop } from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function ConfirmingPhase({ currentRound, totalRounds, fetchedSynopsis,
  synopsisError, isHost, knownDeclarations = [], allDeclared, socket }) {
  const { contentPadding } = useResponsiveLayout();
  const [pendingAction, setPendingAction] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [declared, setDeclared] = useState(null);
  const requestPendingRef = useRef(false);
  const displayError = requestError || synopsisError;
  const hasKnown = knownDeclarations.length > 0;

  function requestAction(event, onSuccess) {
    if (requestPendingRef.current) return;
    if (!socket?.connected) {
      setRequestError('サーバーに接続していません。接続を確認して、もう一度お試しください。');
      return;
    }
    requestPendingRef.current = true;
    setPendingAction(event);
    setRequestError(null);
    socket.timeout(10000).emit(event, null, (error, res) => {
      requestPendingRef.current = false;
      setPendingAction(null);
      if (error) {
        setRequestError('サーバーから応答がありません。接続を確認して、もう一度お試しください。');
      } else if (!res?.ok) {
        setRequestError(res?.error || '操作できませんでした。もう一度お試しください。');
      } else {
        onSuccess?.();
      }
    });
  }

  return (
    <PopBackdrop>
      <ScrollView style={styles.scroll} contentContainerStyle={[
        styles.content, { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
      ]}>
        <RoundHeader currentRound={currentRound} totalRounds={totalRounds}
          questioner={null} phase="この作品、知っていますか？" />
        <PaperPanel tone="cream" variant="elevated" style={styles.panel}>
          {!fetchedSynopsis ? (
            <View style={styles.loadingBox}>
              {!displayError ? <ActivityIndicator color={colors.red} size="large" /> : null}
              <Text style={styles.loadingTitle}>
                {displayError ? '作品を取得できませんでした' : '作品を探しています…'}
              </Text>
              <Text accessibilityRole={displayError ? 'alert' : undefined} style={styles.loadingText}>
                {displayError || '出典付きの作品から問題を選んでいます。'}
              </Text>
              {displayError && isHost ? (
                <StationeryButton variant="secondary" onPress={() => requestAction('round:reroll_synopsis')}
                  loading={pendingAction === 'round:reroll_synopsis'} disabled={Boolean(pendingAction)}
                  accessibilityLabel="作品の紹介文を再取得" style={styles.loadingButton}>
                  もう一度取得する
                </StationeryButton>
              ) : null}
            </View>
          ) : (
            <>
              <View style={styles.headingRow}>
                <View style={styles.headingCopy}>
                  <Text style={styles.kicker}>WORK CHECK</Text>
                  <Text style={styles.heading}>このタイトルを知っていますか？</Text>
                </View>
                <View style={styles.cpuBadge}><Text style={styles.cpuBadgeText}>CPU出題</Text></View>
              </View>
              <View style={styles.synopsisBox}>
                <View style={styles.synopsisTab}><Text style={styles.synopsisTabText}>作品の紹介文</Text></View>
                <Text style={styles.synopsisText}>{fetchedSynopsis}</Text>
              </View>
              <Text style={styles.note}>
                ひとりでも知っている場合は、ホストが確認し、答えを表示してから別の作品へ変更します。
              </Text>
              {displayError ? <Text accessibilityRole="alert" style={styles.errorText}>{displayError}</Text> : null}
              {declared === null ? (
                <View style={styles.buttonRow}>
                  <StationeryButton variant="neutral"
                    onPress={() => requestAction('round:declare_known', () => setDeclared('known'))}
                    loading={pendingAction === 'round:declare_known'} disabled={Boolean(pendingAction)}
                    accessibilityLabel="知ってると宣言" style={styles.secondaryButton}>知ってる！</StationeryButton>
                  <StationeryButton variant="primary"
                    onPress={() => requestAction('round:declare_unknown', () => setDeclared('unknown'))}
                    loading={pendingAction === 'round:declare_unknown'} disabled={Boolean(pendingAction)}
                    accessibilityLabel="知らないと回答" style={styles.secondaryButton}>知らない →</StationeryButton>
                </View>
              ) : (
                <Text style={styles.note}>
                  {declared === 'known' ? '「知ってる！」と回答しました。ホストの確認を待っています。' : '「知らない」と回答しました。全員の回答を待っています。'}
                </Text>
              )}
              {hasKnown ? (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  「知ってる！」の回答があります：{knownDeclarations.join('、')}
                </Text>
              ) : allDeclared ? (
                <Text style={styles.note}>全員が「知らない」と回答しました。タイトル案の提出へ進めます。</Text>
              ) : null}
              {isHost ? (
                <View style={[styles.buttonRow, { marginTop: 16 }]}>
                  <StationeryButton variant="neutral" onPress={() => requestAction('round:reroll_synopsis')}
                    loading={pendingAction === 'round:reroll_synopsis'} disabled={Boolean(pendingAction)}
                    accessibilityLabel={hasKnown ? '確認して答えを表示する' : '別の作品を取得'}
                    style={styles.secondaryButton}>
                    {hasKnown ? '確認して答えを表示する' : '別の作品にする'}
                  </StationeryButton>
                  <StationeryButton variant="primary" onPress={() => requestAction('round:confirm_synopsis')}
                    loading={pendingAction === 'round:confirm_synopsis'}
                    disabled={!allDeclared || hasKnown || Boolean(pendingAction)}
                    accessibilityLabel="タイトル案提出へ進む" style={styles.primaryButton}>
                    タイトル案の提出へ →
                  </StationeryButton>
                </View>
              ) : null}
            </>
          )}
        </PaperPanel>
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
  loadingTitle: { color: colors.navy, fontSize: 20, fontWeight: '900', marginTop: 16 },
  loadingText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  loadingButton: { marginTop: 16, minWidth: 220 },

});

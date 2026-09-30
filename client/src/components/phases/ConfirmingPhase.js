import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
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
}) {
  const { contentPadding } = useResponsiveLayout();

  function handleConfirm() {
    socket.emit('round:confirm_synopsis', null, (res) => {
      if (!res.ok) Alert.alert('エラー', res.error);
    });
  }

  function handleReroll() {
    socket.emit('round:reroll_synopsis', null, (res) => {
      if (!res.ok) Alert.alert('エラー', res.error);
    });
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
                  {!synopsisError ? (
                    <ActivityIndicator color={colors.red} size="large" />
                  ) : (
                    <Text style={styles.loadingErrorIcon}>!</Text>
                  )}
                </View>
                <Text style={styles.loadingTitle}>
                  {synopsisError ? '作品を取得できませんでした' : '作品を探しています…'}
                </Text>
                <Text style={styles.loadingText}>
                  {synopsisError || 'Wikipediaからランダムに作品を選んでいます。'}
                </Text>
                {synopsisError && (
                  <StationeryButton
                    variant="secondary"
                    onPress={handleReroll}
                    accessibilityLabel="あらすじを再取得"
                    style={styles.loadingButton}
                  >
                    もう一度取得する
                  </StationeryButton>
                )}
              </View>
            ) : (
              <>
                <View style={styles.headingRow}>
                  <View>
                    <Text style={styles.kicker}>SYNOPSIS CHECK</Text>
                    <Text style={styles.heading}>このあらすじで進みますか？</Text>
                  </View>
                  <View style={styles.cpuBadge}>
                    <Text style={styles.cpuBadgeText}>CPU出題</Text>
                  </View>
                </View>

                <View style={styles.synopsisBox}>
                  <View style={styles.synopsisTab}>
                    <Text style={styles.synopsisTabText}>あらすじ</Text>
                  </View>
                  <Text style={styles.synopsisText}>{fetchedSynopsis}</Text>
                </View>

                <Text style={styles.note}>
                  本物のタイトルは結果発表まで参加者に表示されません。
                </Text>

                <View style={styles.buttonRow}>
                  <StationeryButton
                    variant="neutral"
                    onPress={handleReroll}
                    style={styles.secondaryButton}
                    accessibilityLabel="別の作品を取得"
                  >
                    別の作品にする
                  </StationeryButton>
                  <StationeryButton
                    variant="primary"
                    onPress={handleConfirm}
                    style={styles.primaryButton}
                    accessibilityLabel="このあらすじで進む"
                  >
                    このあらすじで進む →
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
              あらすじが決まるまで、このままお待ちください。
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
  heading: { color: colors.navy, fontSize: 21, lineHeight: 29, fontWeight: '900', marginTop: 3 },
  cpuBadge: {
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

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { colors, radii } from '../../theme';
import { PaperPanel, StationeryButton, RoundHeader } from '../ui';

export default function ConfirmingPhase({
  currentRound, totalRounds,
  fetchedSynopsis, synopsisError, isHost, socket,
}) {
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <RoundHeader
        currentRound={currentRound}
        totalRounds={totalRounds}
        questioner={null}
        phase="作品を確認中"
      />

      {isHost ? (
        <PaperPanel variant="elevated">
          {!fetchedSynopsis ? (
            <View style={styles.loadingBox}>
              {!synopsisError && <ActivityIndicator color={colors.navy} size="large" />}
              <Text style={styles.loadingText}>{synopsisError || 'Wikipediaから作品を取得中...'}</Text>
              {synopsisError && (
                <StationeryButton onPress={handleReroll} accessibilityLabel="あらすじを再取得">
                  再取得
                </StationeryButton>
              )}
            </View>
          ) : (
            <>
              <Text style={styles.cardTitle}>取得したあらすじ</Text>
              <Text style={styles.cardNote}>
                このあらすじで進めますか？タイトルは結果発表まで全員に非公開です。
              </Text>
              <View style={styles.synopsisBox}>
                <Text style={styles.synopsisText}>{fetchedSynopsis}</Text>
              </View>
              <View style={styles.btnRow}>
                <StationeryButton
                  variant="secondary"
                  onPress={handleReroll}
                  style={styles.btnFlex1}
                  accessibilityLabel="あらすじを再取得"
                >
                  再取得
                </StationeryButton>
                <StationeryButton
                  variant="primary"
                  onPress={handleConfirm}
                  style={styles.btnFlex2}
                  accessibilityLabel="このあらすじで進む"
                >
                  これで進む →
                </StationeryButton>
              </View>
            </>
          )}
        </PaperPanel>
      ) : (
        <PaperPanel>
          <Text style={styles.cardTitle}>ホストが作品を確認しています</Text>
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.navy} size="large" />
            <Text style={styles.loadingText}>しばらくお待ちください...</Text>
          </View>
        </PaperPanel>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, paddingBottom: 40 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  cardNote: { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 16 },
  loadingBox: { alignItems: 'center', paddingVertical: 32 },
  loadingText: { fontSize: 14, color: colors.muted, marginTop: 12 },
  synopsisBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  synopsisText: { fontSize: 15, color: colors.ink, lineHeight: 24 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btnFlex1: { flex: 1 },
  btnFlex2: { flex: 2 },
});

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { colors, radii } from '../../theme';
import { PaperPanel, StationeryButton, RoundHeader, VoteOption } from '../ui';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

export default function VotingPhase({
  currentRound, totalRounds, questioner,
  synopsis, choices, isQuestioner, voteProgress, socket,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [voted, setVoted] = useState(false);
  const { isPC } = useResponsiveLayout();

  function handleVote() {
    if (!selectedId) return Alert.alert('エラー', '選択肢を選んでください');
    socket.emit('round:submit_vote', { answerId: selectedId }, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setVoted(true);
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <RoundHeader currentRound={currentRound} totalRounds={totalRounds} questioner={questioner} phase="投票" />

      <View style={isPC ? styles.pcRow : null}>
        <View style={isPC ? styles.pcMain : null}>
          <PaperPanel style={styles.synopsisCard}>
            <Text style={styles.fieldLabel}>あらすじ</Text>
            <Text style={styles.synopsisText}>{synopsis}</Text>
          </PaperPanel>

          {isQuestioner ? null : (
            <PaperPanel variant="elevated" style={styles.voteCard}>
              <Text style={styles.cardTitle}>本物のタイトルはどれ？</Text>
              <Text style={styles.cardNote}>1つ選んで投票してください</Text>
              {choices.map((choice) => (
                <VoteOption
                  key={choice.id}
                  choice={choice}
                  selected={selectedId === choice.id}
                  disabled={voted}
                  onPress={() => !voted && setSelectedId(choice.id)}
                />
              ))}
              {!voted ? (
                <StationeryButton
                  variant="primary"
                  onPress={handleVote}
                  disabled={!selectedId}
                  accessibilityLabel="投票する"
                  style={styles.voteBtn}
                >
                  投票する
                </StationeryButton>
              ) : (
                <View style={styles.votedBox}>
                  <Text style={styles.votedText}>投票しました</Text>
                  <Text style={styles.waitingText}>
                    {voteProgress.voted} / {voteProgress.total} 人投票済み
                  </Text>
                </View>
              )}
            </PaperPanel>
          )}
        </View>

        {isPC && (
          <View style={styles.pcSide}>
            <PaperPanel style={styles.progressCard}>
              <Text style={styles.progressLabel}>投票状況</Text>
              <Text style={styles.progressNum}>{voteProgress.voted} / {voteProgress.total}</Text>
              <Text style={styles.progressSub}>人が投票しました</Text>
              {isQuestioner && (
                <Text style={styles.cardNote}>全員投票完了で自動的に結果が公開されます</Text>
              )}
            </PaperPanel>
          </View>
        )}
      </View>

      {isQuestioner && !isPC && (
        <PaperPanel>
          <Text style={styles.cardTitle}>投票状況</Text>
          <Text style={styles.progressNum}>{voteProgress.voted} / {voteProgress.total}</Text>
          <Text style={styles.progressSub}>人が投票しました</Text>
          <Text style={styles.cardNote}>全員投票完了で自動的に結果が公開されます</Text>
        </PaperPanel>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  synopsisCard: {},
  voteCard: {},
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 8 },
  synopsisText: { fontSize: 15, color: colors.ink, lineHeight: 24 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  cardNote: { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 4 },
  voteBtn: { marginTop: 4 },
  votedBox: { alignItems: 'center', paddingVertical: 12 },
  votedText: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  waitingText: { fontSize: 13, color: colors.muted },
  progressLabel: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 8 },
  progressNum: { fontSize: 40, fontWeight: '800', color: colors.vermilion, textAlign: 'center' },
  progressSub: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 12 },
  progressCard: {},
  pcRow: { flexDirection: 'row', gap: 16 },
  pcMain: { flex: 2, gap: 12 },
  pcSide: { flex: 1 },
});

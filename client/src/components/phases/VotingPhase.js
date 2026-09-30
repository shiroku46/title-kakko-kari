import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { colors, radii } from '../../theme';
import {
  PaperPanel,
  StationeryButton,
  RoundHeader,
  VoteOption,
  PopBackdrop,
} from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

export default function VotingPhase({
  currentRound,
  totalRounds,
  questioner,
  synopsis,
  choices,
  isQuestioner,
  voteProgress,
  socket,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [voted, setVoted] = useState(false);
  const { isPC, contentPadding } = useResponsiveLayout();

  function handleVote() {
    if (!selectedId) return Alert.alert('選んでください', 'タイトルを1つ選んでください');
    socket.emit('round:submit_vote', { answerId: selectedId }, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setVoted(true);
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
          questioner={questioner}
          phase="本物だと思うタイトルに投票"
        />

        <View style={[styles.layout, isPC && styles.layoutPC]}>
          <View style={styles.mainColumn}>
            <PaperPanel tone="cream" style={styles.synopsisPanel}>
              <View style={styles.synopsisHeading}>
                <View style={styles.synopsisIcon}>
                  <Text style={styles.synopsisIconText}>文</Text>
                </View>
                <View style={styles.synopsisHeadingBody}>
                  <Text style={styles.kicker}>STORY</Text>
                  <Text style={styles.synopsisTitle}>この作品のあらすじ</Text>
                </View>
              </View>
              <Text style={styles.synopsisText}>{synopsis}</Text>
            </PaperPanel>

            {!isQuestioner ? (
              <PaperPanel tone="white" variant="elevated" style={styles.votePanel}>
                <View style={styles.voteHeadingRow}>
                  <View>
                    <Text style={styles.kicker}>VOTE</Text>
                    <Text style={styles.voteTitle}>どのタイトルが本物？</Text>
                    <Text style={styles.voteNote}>1つ選んで、投票してください。</Text>
                  </View>
                  <View style={styles.choiceCount}>
                    <Text style={styles.choiceCountNumber}>{choices.length}</Text>
                    <Text style={styles.choiceCountLabel}>候補</Text>
                  </View>
                </View>

                <View style={styles.choiceList}>
                  {choices.map((choice) => (
                    <VoteOption
                      key={choice.id}
                      choice={choice}
                      selected={selectedId === choice.id}
                      disabled={voted}
                      onPress={() => !voted && setSelectedId(choice.id)}
                    />
                  ))}
                </View>

                {!voted ? (
                  <StationeryButton
                    variant="primary"
                    onPress={handleVote}
                    disabled={!selectedId}
                    accessibilityLabel="投票する"
                  >
                    このタイトルに投票する →
                  </StationeryButton>
                ) : (
                  <View style={styles.votedBox}>
                    <View style={styles.votedIcon}>
                      <Text style={styles.votedIconText}>✓</Text>
                    </View>
                    <View style={styles.votedBody}>
                      <Text style={styles.votedTitle}>投票しました</Text>
                      <Text style={styles.votedText}>
                        {voteProgress.voted} / {voteProgress.total} 人が投票済み
                      </Text>
                    </View>
                  </View>
                )}
              </PaperPanel>
            ) : (
              <PaperPanel tone="navy" style={styles.questionerPanel}>
                <Text style={styles.questionerKicker}>QUESTIONER VIEW</Text>
                <Text style={styles.questionerTitle}>投票を見守っています</Text>
                <Text style={styles.questionerBody}>
                  出題者は投票しません。全員の投票が終わると、自動的に結果が発表されます。
                </Text>
              </PaperPanel>
            )}
          </View>

          <View style={styles.sideColumn}>
            <PaperPanel tone="yellow" style={styles.progressPanel}>
              <Text style={styles.progressKicker}>VOTING STATUS</Text>
              <Text style={styles.progressTitle}>投票状況</Text>
              <View style={styles.progressValueRow}>
                <Text style={styles.progressValue}>{voteProgress.voted}</Text>
                <Text style={styles.progressSlash}>/</Text>
                <Text style={styles.progressTotal}>{voteProgress.total}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${voteProgress.total
                        ? Math.min(100, (voteProgress.voted / voteProgress.total) * 100)
                        : 0}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressNote}>
                全員の投票が終わると、正解が発表されます。
              </Text>
            </PaperPanel>

            <PaperPanel tone="sky" style={styles.tipPanel}>
              <Text style={styles.tipTitle}>投票のコツ</Text>
              <Text style={styles.tipBody}>
                あらすじの言葉づかい、時代、ジャンルから「本当にありそうか」を考えてみましょう。
              </Text>
            </PaperPanel>
          </View>
        </View>
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
  layout: { gap: 14 },
  layoutPC: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  mainColumn: { flex: 1.7, gap: 14 },
  sideColumn: { flex: 0.75, gap: 14 },
  synopsisPanel: {},
  synopsisHeading: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
  synopsisIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: colors.cyan,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  synopsisIconText: { color: colors.navy, fontSize: 18, fontWeight: '900' },
  synopsisHeadingBody: { flex: 1 },
  kicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  synopsisTitle: { color: colors.navy, fontSize: 18, fontWeight: '900', marginTop: 2 },
  synopsisText: { color: colors.ink, fontSize: 15, lineHeight: 25 },
  votePanel: {},
  voteHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 13,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    marginBottom: 15,
  },
  voteTitle: { color: colors.navy, fontSize: 22, lineHeight: 30, fontWeight: '900', marginTop: 3 },
  voteNote: { color: colors.muted, fontSize: 11, marginTop: 4 },
  choiceCount: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCountNumber: { color: colors.navy, fontSize: 20, fontWeight: '900', lineHeight: 22 },
  choiceCountLabel: { color: colors.navy, fontSize: 9, fontWeight: '900' },
  choiceList: { marginBottom: 5 },
  votedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#E2F6E8',
    borderWidth: 2,
    borderColor: colors.green,
    borderRadius: radii.md,
    padding: 13,
  },
  votedIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  votedIconText: { color: colors.white, fontWeight: '900', fontSize: 20 },
  votedBody: { flex: 1 },
  votedTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  votedText: { color: colors.muted, fontSize: 11, marginTop: 2 },
  questionerPanel: {},
  questionerKicker: { color: colors.yellow, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  questionerTitle: { color: colors.white, fontSize: 22, fontWeight: '900', marginTop: 5 },
  questionerBody: { color: '#BCD1E0', fontSize: 12, lineHeight: 19, marginTop: 7 },
  progressPanel: {},
  progressKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  progressTitle: { color: colors.navy, fontSize: 19, fontWeight: '900', marginTop: 4 },
  progressValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: 14,
  },
  progressValue: { color: colors.red, fontSize: 48, fontWeight: '900' },
  progressSlash: { color: colors.navy, fontSize: 22, fontWeight: '800', marginHorizontal: 6 },
  progressTotal: { color: colors.navy, fontSize: 28, fontWeight: '900' },
  progressTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
    overflow: 'hidden',
    marginTop: 10,
  },
  progressFill: { height: '100%', backgroundColor: colors.red },
  progressNote: { color: colors.ink, fontSize: 11, lineHeight: 17, marginTop: 10 },
  tipPanel: {},
  tipTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  tipBody: { color: colors.ink, fontSize: 12, lineHeight: 19, marginTop: 5 },
});

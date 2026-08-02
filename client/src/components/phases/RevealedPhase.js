import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { colors, radii } from '../../theme';
import { PaperPanel, StationeryButton, RoundHeader, TitleCard, VoteOption, ScoreRow, Stamp } from '../ui';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';

export default function RevealedPhase({
  currentRound, totalRounds,
  revealData, isQuestioner, isHost, playerId, mvpData, socket,
}) {
  const [mvpSubmitted, setMvpSubmitted] = useState(false);
  const [selectedMvpId, setSelectedMvpId] = useState(null);
  const { isPC } = useResponsiveLayout();

  if (!revealData) return null;
  const { realTitle, answers, votes, roundScores, playerScores } = revealData;

  const fakeAnswers = answers.filter((a) => !a.isReal);

  const voteMap = {};
  votes.forEach(({ answerId, voterId }) => {
    if (!voteMap[answerId]) voteMap[answerId] = [];
    voteMap[answerId].push(voterId);
  });

  const myScore = roundScores?.find((s) => s.player_id === playerId);
  const canAdvance = isQuestioner || isHost;

  function handleSubmitMvp() {
    if (!selectedMvpId) return;
    socket.emit('round:submit_mvp', { answerId: selectedMvpId }, (res) => {
      if (res.ok) setMvpSubmitted(true);
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <RoundHeader currentRound={currentRound} totalRounds={totalRounds} questioner={null} phase="結果発表" />

      {/* 本物のタイトル */}
      <View style={styles.realTitleCard}>
        <Text style={styles.realLabel}>本物のタイトル</Text>
        <Text style={styles.realTitle}>{realTitle}</Text>
        <Stamp type="真" size="lg" animate style={styles.truStamp} />
      </View>

      {/* PC: 2カラムレイアウト */}
      {isPC ? (
        <View style={styles.pcRow}>
          <View style={styles.pcMain}>
            {/* 選択肢と投票結果 */}
            <PaperPanel>
              <Text style={styles.cardTitle}>選択肢と投票結果</Text>
              {answers.map((answer) => {
                const voteCount = (voteMap[answer.id] ?? []).length;
                return (
                  <View key={answer.id} style={[styles.answerRow, answer.isReal && styles.answerRowReal]}>
                    <View style={styles.answerLeft}>
                      <Text style={[styles.answerTitle, answer.isReal && styles.answerTitleReal]} numberOfLines={3}>
                        {answer.title}
                      </Text>
                      <Text style={styles.answerAuthor}>
                        {answer.isReal ? '★ 本物' : `作：${answer.author?.nickname ?? '?'}`}
                      </Text>
                    </View>
                    {voteCount > 0 && (
                      <View style={[styles.voteBadge, answer.isReal && styles.voteBadgeReal]}>
                        <Text style={[styles.voteBadgeText, answer.isReal && styles.voteBadgeTextReal]}>
                          {voteCount}票
                        </Text>
                      </View>
                    )}
                    {answer.isReal && <Stamp type="真" size="sm" style={styles.answerStamp} />}
                  </View>
                );
              })}
            </PaperPanel>

            {/* MVP */}
            {isQuestioner && !mvpData && (
              <PaperPanel style={styles.mt12}>
                <Text style={styles.cardTitle}>MVP を選ぶ（任意）</Text>
                <Text style={styles.cardNote}>一番気に入った偽タイトルに +1pt を贈れます</Text>
                {fakeAnswers.map((a) => (
                  <VoteOption
                    key={a.id}
                    choice={a}
                    selected={selectedMvpId === a.id}
                    disabled={mvpSubmitted}
                    onPress={() => !mvpSubmitted && setSelectedMvpId(a.id)}
                  />
                ))}
                {!mvpSubmitted ? (
                  <StationeryButton
                    variant="primary"
                    onPress={handleSubmitMvp}
                    disabled={!selectedMvpId}
                    accessibilityLabel="MVPを贈る"
                    style={styles.mt8}
                  >
                    MVP を贈る
                  </StationeryButton>
                ) : (
                  <Text style={styles.mvpSentText}>MVPを贈りました</Text>
                )}
              </PaperPanel>
            )}
            {mvpData && (
              <View style={[styles.mvpResultCard, styles.mt12]}>
                <Text style={styles.mvpResultLabel}>MVP</Text>
                <Text style={styles.mvpResultTitle}>「{mvpData.answerTitle}」</Text>
                <Text style={styles.mvpResultAuthor}>{mvpData.playerNickname} に +1pt</Text>
              </View>
            )}
          </View>

          <View style={styles.pcSide}>
            {/* 自分の得点 */}
            {myScore && (
              <PaperPanel style={styles.mb12}>
                <Text style={styles.cardTitle}>あなたの得点</Text>
                <Text style={styles.myPts}>+{myScore.total_pts} pt</Text>
                <View style={styles.ptsBreakdown}>
                  <View style={styles.ptsItem}>
                    <Text style={styles.ptsValue}>{myScore.correct_pts}</Text>
                    <Text style={styles.ptsLabel}>正解</Text>
                  </View>
                  <View style={styles.ptsDivider} />
                  <View style={styles.ptsItem}>
                    <Text style={styles.ptsValue}>{myScore.deceive_pts}</Text>
                    <Text style={styles.ptsLabel}>欺き</Text>
                  </View>
                </View>
              </PaperPanel>
            )}

            {/* スコアボード */}
            <PaperPanel>
              <Text style={styles.cardTitle}>スコアボード</Text>
              {playerScores.map((p, i) => (
                <ScoreRow
                  key={p.id}
                  rank={i + 1}
                  nickname={p.nickname}
                  score={p.score}
                  isMe={p.id === playerId}
                  isWinner={i === 0}
                />
              ))}
            </PaperPanel>

            {canAdvance ? (
              <StationeryButton
                variant="primary"
                onPress={() => socket.emit('game:next_round', null, () => {})}
                accessibilityLabel={currentRound >= totalRounds ? 'ゲームを終了する' : '次のラウンドへ'}
                style={styles.mt12}
              >
                {currentRound >= totalRounds ? 'ゲームを終了する' : '次のラウンドへ →'}
              </StationeryButton>
            ) : (
              <Text style={styles.waitingText}>出題者 / ホストが次のラウンドへ進めます</Text>
            )}
          </View>
        </View>
      ) : (
        <>
          {myScore && (
            <PaperPanel>
              <Text style={styles.cardTitle}>あなたの得点</Text>
              <Text style={styles.myPts}>+{myScore.total_pts} pt</Text>
              <View style={styles.ptsBreakdown}>
                <View style={styles.ptsItem}>
                  <Text style={styles.ptsValue}>{myScore.correct_pts}</Text>
                  <Text style={styles.ptsLabel}>正解</Text>
                </View>
                <View style={styles.ptsDivider} />
                <View style={styles.ptsItem}>
                  <Text style={styles.ptsValue}>{myScore.deceive_pts}</Text>
                  <Text style={styles.ptsLabel}>欺き</Text>
                </View>
              </View>
            </PaperPanel>
          )}

          <PaperPanel>
            <Text style={styles.cardTitle}>選択肢と投票結果</Text>
            {answers.map((answer) => {
              const voteCount = (voteMap[answer.id] ?? []).length;
              return (
                <View key={answer.id} style={[styles.answerRow, answer.isReal && styles.answerRowReal]}>
                  <View style={styles.answerLeft}>
                    <Text style={[styles.answerTitle, answer.isReal && styles.answerTitleReal]} numberOfLines={4}>
                      {answer.title}
                    </Text>
                    <Text style={styles.answerAuthor}>
                      {answer.isReal ? '★ 本物' : `作：${answer.author?.nickname ?? '?'}`}
                    </Text>
                  </View>
                  {voteCount > 0 && (
                    <View style={[styles.voteBadge, answer.isReal && styles.voteBadgeReal]}>
                      <Text style={[styles.voteBadgeText, answer.isReal && styles.voteBadgeTextReal]}>
                        {voteCount}票
                      </Text>
                    </View>
                  )}
                  {answer.isReal && <Stamp type="真" size="sm" style={styles.answerStamp} />}
                </View>
              );
            })}
          </PaperPanel>

          {isQuestioner && !mvpData && (
            <PaperPanel>
              <Text style={styles.cardTitle}>MVP を選ぶ（任意）</Text>
              <Text style={styles.cardNote}>一番気に入った偽タイトルに +1pt を贈れます</Text>
              {fakeAnswers.map((a) => (
                <VoteOption
                  key={a.id}
                  choice={a}
                  selected={selectedMvpId === a.id}
                  disabled={mvpSubmitted}
                  onPress={() => !mvpSubmitted && setSelectedMvpId(a.id)}
                />
              ))}
              {!mvpSubmitted ? (
                <StationeryButton
                  variant="primary"
                  onPress={handleSubmitMvp}
                  disabled={!selectedMvpId}
                  accessibilityLabel="MVPを贈る"
                  style={styles.mt8}
                >
                  MVP を贈る
                </StationeryButton>
              ) : (
                <Text style={styles.mvpSentText}>MVPを贈りました</Text>
              )}
            </PaperPanel>
          )}
          {mvpData && (
            <View style={styles.mvpResultCard}>
              <Text style={styles.mvpResultLabel}>MVP</Text>
              <Text style={styles.mvpResultTitle}>「{mvpData.answerTitle}」</Text>
              <Text style={styles.mvpResultAuthor}>{mvpData.playerNickname} に +1pt</Text>
            </View>
          )}

          <PaperPanel>
            <Text style={styles.cardTitle}>スコアボード</Text>
            {playerScores.map((p, i) => (
              <ScoreRow
                key={p.id}
                rank={i + 1}
                nickname={p.nickname}
                score={p.score}
                isMe={p.id === playerId}
                isWinner={i === 0}
              />
            ))}
          </PaperPanel>

          {canAdvance ? (
            <StationeryButton
              variant="primary"
              onPress={() => socket.emit('game:next_round', null, () => {})}
              accessibilityLabel={currentRound >= totalRounds ? 'ゲームを終了する' : '次のラウンドへ'}
            >
              {currentRound >= totalRounds ? 'ゲームを終了する' : '次のラウンドへ →'}
            </StationeryButton>
          ) : (
            <Text style={styles.waitingText}>出題者 / ホストが次のラウンドへ進めます</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  realTitleCard: {
    backgroundColor: colors.navy,
    borderRadius: radii.lg,
    padding: 24,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  realLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.65)', position: 'absolute', top: 12, left: 20 },
  realTitle: { fontSize: 24, fontWeight: '800', color: colors.white, textAlign: 'center', flex: 1, lineHeight: 34 },
  truStamp: { flexShrink: 0 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  cardNote: { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 12 },
  myPts: { fontSize: 48, fontWeight: '800', color: colors.vermilion, textAlign: 'center' },
  ptsBreakdown: { flexDirection: 'row', justifyContent: 'center', marginTop: 12 },
  ptsItem: { alignItems: 'center', paddingHorizontal: 24 },
  ptsValue: { fontSize: 22, fontWeight: '700', color: colors.ink },
  ptsLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  ptsDivider: { width: 1, backgroundColor: colors.border },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.paper,
  },
  answerRowReal: { borderColor: colors.vermilion, backgroundColor: '#FFF8F7' },
  answerLeft: { flex: 1 },
  answerTitle: { fontSize: 14, color: colors.ink, fontWeight: '500', lineHeight: 22 },
  answerTitleReal: { color: colors.vermilion, fontWeight: '700' },
  answerAuthor: { fontSize: 11, color: colors.muted, marginTop: 3 },
  voteBadge: {
    backgroundColor: colors.paperSubtle,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  voteBadgeReal: { backgroundColor: '#FFE8E5' },
  voteBadgeText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  voteBadgeTextReal: { color: colors.vermilion },
  answerStamp: { marginLeft: 8 },
  mt8: {},
  mt12: { marginTop: 0 },
  mb12: {},
  mvpResultCard: {
    backgroundColor: colors.mustard,
    borderRadius: radii.lg,
    padding: 20,
    alignItems: 'center',
  },
  mvpResultLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginBottom: 4 },
  mvpResultTitle: { fontSize: 20, fontWeight: '800', color: colors.white, textAlign: 'center', lineHeight: 28 },
  mvpResultAuthor: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 6 },
  mvpSentText: { textAlign: 'center', color: colors.mustard, fontWeight: '700', fontSize: 14, paddingVertical: 10 },
  waitingText: { color: colors.muted, textAlign: 'center', fontSize: 13, paddingVertical: 8 },
  pcRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  pcMain: { flex: 3, gap: 12 },
  pcSide: { flex: 2, gap: 12 },
});

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import RoundHeader from '../RoundHeader';

export default function RevealedPhase({
  currentRound, totalRounds,
  revealData, isQuestioner, isHost, playerId, mvpData, socket,
}) {
  const [mvpSubmitted, setMvpSubmitted] = useState(false);
  const [selectedMvpId, setSelectedMvpId] = useState(null);

  if (!revealData) return null;
  const { realTitle, answers, votes, roundScores, playerScores } = revealData;

  const fakeAnswers = answers.filter((a) => !a.isReal);

  // answerId → 投票者IDリスト
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

      {/* 正解 */}
      <View style={styles.answerCard}>
        <Text style={styles.answerLabel}>本物のタイトル</Text>
        <Text style={styles.realTitle}>{realTitle}</Text>
      </View>

      {/* 自分のこのラウンドの得点 */}
      {myScore && (
        <View style={styles.card}>
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
        </View>
      )}

      {/* 選択肢と投票結果 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>選択肢と投票結果</Text>
        {answers.map((answer) => {
          const voteCount = (voteMap[answer.id] ?? []).length;
          return (
            <View key={answer.id} style={[styles.answerRow, answer.isReal && styles.answerRowReal]}>
              <View style={styles.answerLeft}>
                <Text style={[styles.answerTitle, answer.isReal && styles.answerTitleReal]}>
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
            </View>
          );
        })}
      </View>

      {/* MVP */}
      {isQuestioner && !mvpData && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>MVP を選ぶ（任意）</Text>
          <Text style={styles.cardNote}>一番気に入った偽タイトルに +1pt を贈れます</Text>
          {fakeAnswers.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={[styles.mvpChoice, selectedMvpId === a.id && styles.mvpChoiceSelected]}
              onPress={() => !mvpSubmitted && setSelectedMvpId(a.id)}
              disabled={mvpSubmitted}
            >
              <View style={[styles.radio, selectedMvpId === a.id && styles.radioSelected]} />
              <View style={styles.mvpChoiceInner}>
                <Text style={[styles.mvpChoiceTitle, selectedMvpId === a.id && styles.mvpChoiceTitleSelected]}>
                  {a.title}
                </Text>
                <Text style={styles.mvpChoiceAuthor}>作：{a.author?.nickname ?? '?'}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {!mvpSubmitted ? (
            <TouchableOpacity
              style={[styles.btnMvp, !selectedMvpId && styles.btnDisabled]}
              onPress={handleSubmitMvp}
              disabled={!selectedMvpId}
            >
              <Text style={styles.btnPrimaryText}>⭐ MVP を贈る</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.mvpSentText}>MVPを贈りました</Text>
          )}
        </View>
      )}
      {mvpData && (
        <View style={styles.mvpResultCard}>
          <Text style={styles.mvpResultLabel}>MVP</Text>
          <Text style={styles.mvpResultTitle}>「{mvpData.answerTitle}」</Text>
          <Text style={styles.mvpResultAuthor}>{mvpData.playerNickname} に +1pt</Text>
        </View>
      )}

      {/* スコアボード */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>スコアボード</Text>
        {playerScores.map((p, i) => (
          <View key={p.id} style={styles.scoreRow}>
            <Text style={styles.rank}>{i + 1}</Text>
            <Text style={[styles.scoreName, p.id === playerId && styles.scoreNameMe]}>
              {p.nickname}{p.id === playerId ? ' (あなた)' : ''}
            </Text>
            <Text style={styles.scoreValue}>{p.score} pt</Text>
          </View>
        ))}
      </View>

      {canAdvance ? (
        <TouchableOpacity style={styles.btnPrimary} onPress={() => socket.emit('game:next_round', null, () => {})}>
          <Text style={styles.btnPrimaryText}>
            {currentRound >= totalRounds ? 'ゲームを終了する' : '次のラウンドへ →'}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.waitingText}>出題者 / ホストが次のラウンドへ進めます</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  answerCard: {
    backgroundColor: '#FF3B5C', borderRadius: 16, padding: 24, alignItems: 'center',
  },
  answerLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginBottom: 6 },
  realTitle: { fontSize: 26, fontWeight: '800', color: '#FFF', textAlign: 'center' },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 14 },
  myPts: { fontSize: 48, fontWeight: '800', color: '#FF3B5C', textAlign: 'center' },
  ptsBreakdown: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 0 },
  ptsItem: { alignItems: 'center', paddingHorizontal: 24 },
  ptsValue: { fontSize: 22, fontWeight: '700', color: '#1A1A1A' },
  ptsLabel: { fontSize: 12, color: '#999', marginTop: 2 },
  ptsDivider: { width: 1, backgroundColor: '#EBEBEB' },
  answerRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#EBEBEB',
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  answerRowReal: { borderColor: '#FF3B5C', backgroundColor: '#FFF5F7' },
  answerLeft: { flex: 1 },
  answerTitle: { fontSize: 14, color: '#1A1A1A', fontWeight: '500', marginBottom: 2 },
  answerTitleReal: { color: '#FF3B5C', fontWeight: '700' },
  answerAuthor: { fontSize: 11, color: '#999' },
  voteBadge: {
    backgroundColor: '#F5F5F5', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  voteBadgeReal: { backgroundColor: '#FFE8EC' },
  voteBadgeText: { fontSize: 12, fontWeight: '700', color: '#999' },
  voteBadgeTextReal: { color: '#FF3B5C' },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  rank: { fontSize: 13, color: '#BBB', width: 24 },
  scoreName: { flex: 1, fontSize: 15, color: '#1A1A1A' },
  scoreNameMe: { color: '#FF3B5C', fontWeight: '700' },
  scoreValue: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  btnPrimary: {
    backgroundColor: '#FF3B5C', borderRadius: 12, padding: 16, alignItems: 'center',
  },
  btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  waitingText: { color: '#BBB', textAlign: 'center', fontSize: 13, paddingVertical: 8 },
  // MVP
  mvpChoice: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#EBEBEB',
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  mvpChoiceSelected: { borderColor: '#FF9500', backgroundColor: '#FFFBF0' },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#D0D0D0', marginRight: 12, flexShrink: 0,
  },
  radioSelected: { borderColor: '#FF9500', backgroundColor: '#FF9500' },
  mvpChoiceInner: { flex: 1 },
  mvpChoiceTitle: { fontSize: 14, color: '#1A1A1A', fontWeight: '500' },
  mvpChoiceTitleSelected: { color: '#CC7700', fontWeight: '700' },
  mvpChoiceAuthor: { fontSize: 11, color: '#999', marginTop: 2 },
  btnMvp: {
    backgroundColor: '#FF9500', borderRadius: 12, padding: 15,
    alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { backgroundColor: '#E0E0E0' },
  mvpSentText: { textAlign: 'center', color: '#FF9500', fontWeight: '700', fontSize: 14, paddingVertical: 10 },
  mvpResultCard: {
    backgroundColor: '#FF9500', borderRadius: 16, padding: 20, alignItems: 'center',
  },
  mvpResultLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginBottom: 4 },
  mvpResultTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', textAlign: 'center' },
  mvpResultAuthor: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 6 },
});

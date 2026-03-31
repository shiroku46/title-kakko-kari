import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, ScrollView,
} from 'react-native';
import RoundHeader from '../RoundHeader';

export default function VotingPhase({
  currentRound, totalRounds, questioner,
  synopsis, choices, isQuestioner, voteProgress, socket,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [voted, setVoted] = useState(false);

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

      {/* あらすじ */}
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>あらすじ</Text>
        <Text style={styles.synopsisText}>{synopsis}</Text>
      </View>

      {isQuestioner ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>投票状況</Text>
          <Text style={styles.progressNum}>{voteProgress.voted} / {voteProgress.total}</Text>
          <Text style={styles.progressSub}>人が投票しました</Text>
          <Text style={styles.cardNote}>全員投票完了で自動的に結果が公開されます</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>本物のタイトルはどれ？</Text>
          <Text style={styles.cardNote}>1つ選んで投票してください</Text>

          {choices.map((choice) => (
            <TouchableOpacity
              key={choice.id}
              style={[
                styles.choiceBtn,
                selectedId === choice.id && styles.choiceSelected,
                voted && styles.choiceDisabled,
              ]}
              onPress={() => !voted && setSelectedId(choice.id)}
              disabled={voted}
              activeOpacity={0.7}
            >
              <View style={[styles.radio, selectedId === choice.id && styles.radioSelected]} />
              <Text style={[styles.choiceText, selectedId === choice.id && styles.choiceTextSelected]}>
                {choice.title}
              </Text>
            </TouchableOpacity>
          ))}

          {!voted ? (
            <TouchableOpacity
              style={[styles.btnPrimary, !selectedId && styles.btnDisabled]}
              onPress={handleVote}
              disabled={!selectedId}
            >
              <Text style={styles.btnPrimaryText}>投票する</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.votedBox}>
              <Text style={styles.votedText}>投票しました</Text>
              <Text style={styles.waitingText}>
                {voteProgress.voted} / {voteProgress.total} 人投票済み
              </Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  cardNote: { fontSize: 12, color: '#999', lineHeight: 18, marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 8 },
  synopsisText: { fontSize: 15, color: '#1A1A1A', lineHeight: 24 },
  choiceBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#EBEBEB',
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  choiceSelected: { borderColor: '#FF3B5C', backgroundColor: '#FFF5F7' },
  choiceDisabled: { opacity: 0.5 },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#D0D0D0', marginRight: 12,
  },
  radioSelected: { borderColor: '#FF3B5C', backgroundColor: '#FF3B5C' },
  choiceText: { flex: 1, fontSize: 15, color: '#1A1A1A' },
  choiceTextSelected: { color: '#FF3B5C', fontWeight: '600' },
  btnPrimary: {
    backgroundColor: '#FF3B5C', borderRadius: 12,
    padding: 15, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { backgroundColor: '#E0E0E0' },
  btnPrimaryText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  votedBox: { alignItems: 'center', paddingVertical: 12 },
  votedText: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 4 },
  waitingText: { fontSize: 13, color: '#999' },
  progressNum: { fontSize: 48, fontWeight: '800', color: '#FF3B5C', textAlign: 'center' },
  progressSub: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 12 },
});

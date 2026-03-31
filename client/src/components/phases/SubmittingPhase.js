import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import RoundHeader from '../RoundHeader';

export default function SubmittingPhase({
  currentRound, totalRounds, questioner,
  synopsis, isQuestioner, fakeSubmittedCount, socket,
}) {
  const [fakeTitle, setFakeTitle] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmitFake() {
    if (!fakeTitle.trim()) return Alert.alert('エラー', 'タイトルを入力してください');
    socket.emit('round:submit_fake', { title: fakeTitle.trim() }, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setSubmitted(true);
    });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <RoundHeader currentRound={currentRound} totalRounds={totalRounds} questioner={questioner} phase="偽タイトル提出" />

        {/* あらすじカード */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>あらすじ</Text>
          <Text style={styles.synopsisText}>{synopsis}</Text>
        </View>

        {isQuestioner ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>提出状況</Text>
            <Text style={styles.progressNum}>{fakeSubmittedCount}</Text>
            <Text style={styles.progressSub}>人が提出しました</Text>
            <Text style={styles.cardNote}>全員提出完了で自動的に投票フェーズへ移行します</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {!submitted ? (
              <>
                <Text style={styles.cardTitle}>偽タイトルを入力</Text>
                <Text style={styles.cardNote}>本物っぽい嘘のタイトルを考えてください。他の人を騙せたら得点！</Text>
                <TextInput
                  style={styles.input}
                  placeholder="偽タイトル..."
                  placeholderTextColor="#C0C0C0"
                  value={fakeTitle}
                  onChangeText={setFakeTitle}
                  maxLength={40}
                />
                <TouchableOpacity style={styles.btnPrimary} onPress={handleSubmitFake}>
                  <Text style={styles.btnPrimaryText}>提出する</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.submittedBox}>
                <Text style={styles.submittedLabel}>提出しました</Text>
                <Text style={styles.submittedTitle}>「{fakeTitle}」</Text>
                <Text style={styles.waitingText}>他の人の提出を待っています...</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12,
    fontSize: 15, color: '#1A1A1A', marginBottom: 16,
  },
  btnPrimary: {
    backgroundColor: '#FF3B5C', borderRadius: 12, padding: 15, alignItems: 'center',
  },
  btnPrimaryText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  progressNum: { fontSize: 56, fontWeight: '800', color: '#FF3B5C', textAlign: 'center' },
  progressSub: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 12 },
  submittedBox: { alignItems: 'center', paddingVertical: 8 },
  submittedLabel: { fontSize: 13, color: '#999', marginBottom: 6 },
  submittedTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 },
  waitingText: { fontSize: 13, color: '#BBB' },
});

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import RoundHeader from '../RoundHeader';

export default function ConfirmingPhase({
  currentRound, totalRounds,
  fetchedSynopsis, isHost, socket,
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
        <View style={styles.card}>
          {!fetchedSynopsis ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#FF3B5C" size="large" />
              <Text style={styles.loadingText}>Wikipediaから作品を取得中...</Text>
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
                <TouchableOpacity style={styles.btnReroll} onPress={handleReroll}>
                  <Text style={styles.btnRerollText}>再取得</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnConfirm} onPress={handleConfirm}>
                  <Text style={styles.btnConfirmText}>これで進む →</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ホストが作品を確認しています</Text>
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#FF3B5C" size="large" />
            <Text style={styles.loadingText}>しばらくお待ちください...</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  cardNote: { fontSize: 12, color: '#999', lineHeight: 18, marginBottom: 16 },
  loadingBox: { alignItems: 'center', paddingVertical: 32 },
  loadingText: { fontSize: 14, color: '#BBB', marginTop: 12 },
  synopsisBox: {
    backgroundColor: '#F5F5F5', borderRadius: 12, padding: 16, marginBottom: 16,
  },
  synopsisText: { fontSize: 15, color: '#1A1A1A', lineHeight: 24 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btnReroll: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 12,
    padding: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#E0E0E0',
  },
  btnRerollText: { fontSize: 14, fontWeight: '600', color: '#666' },
  btnConfirm: {
    flex: 2, backgroundColor: '#FF3B5C', borderRadius: 12,
    padding: 14, alignItems: 'center',
  },
  btnConfirmText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});

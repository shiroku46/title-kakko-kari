import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { disconnectSocket } from '../hooks/useSocket';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function ResultScreen({ navigation, route }) {
  const { finalScores, winner } = route.params;

  return (
    <View style={styles.container}>
      <View style={styles.winnerCard}>
        <Text style={styles.winnerEmoji}>🏆</Text>
        <Text style={styles.winnerLabel}>優勝</Text>
        <Text style={styles.winnerName}>{winner?.nickname}</Text>
        <Text style={styles.winnerScore}>{winner?.score} pt</Text>
      </View>

      <Text style={styles.sectionTitle}>最終スコア</Text>
      <FlatList
        data={finalScores}
        keyExtractor={(p) => p.id}
        style={styles.list}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item, index }) => (
          <View style={[styles.scoreRow, index === 0 && styles.topRow]}>
            <Text style={styles.medal}>{MEDALS[index] ?? `${index + 1}`}</Text>
            <Text style={[styles.name, index === 0 && styles.nameTop]}>{item.nickname}</Text>
            <Text style={[styles.score, index === 0 && styles.scoreTop]}>{item.score} pt</Text>
          </View>
        )}
      />

      <TouchableOpacity
        style={styles.btnHome}
        onPress={() => { disconnectSocket(); navigation.replace('Home'); }}
      >
        <Text style={styles.btnHomeText}>タイトルへ戻る</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7', paddingTop: 60, paddingHorizontal: 16 },
  winnerCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  winnerEmoji: { fontSize: 48, marginBottom: 8 },
  winnerLabel: { fontSize: 13, color: '#999', fontWeight: '600' },
  winnerName: { fontSize: 30, fontWeight: '800', color: '#1A1A1A', marginTop: 4 },
  winnerScore: { fontSize: 18, color: '#FF3B5C', fontWeight: '700', marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#999', marginBottom: 10 },
  list: { flex: 1 },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF', borderRadius: 12, padding: 16,
  },
  topRow: { borderWidth: 1.5, borderColor: '#FF3B5C' },
  medal: { fontSize: 20, width: 36 },
  name: { flex: 1, fontSize: 16, color: '#1A1A1A', fontWeight: '500' },
  nameTop: { fontWeight: '700' },
  score: { fontSize: 16, color: '#999', fontWeight: '600' },
  scoreTop: { color: '#FF3B5C', fontSize: 18, fontWeight: '800' },
  btnHome: {
    backgroundColor: '#1A1A1A', borderRadius: 12,
    padding: 16, alignItems: 'center',
    marginVertical: 20,
  },
  btnHomeText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

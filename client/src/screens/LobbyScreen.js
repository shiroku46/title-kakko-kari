import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useSocketListeners, getSocket, disconnectSocket } from '../hooks/useSocket';

export default function LobbyScreen({ navigation, route }) {
  const { room, player } = route.params;
  const [players, setPlayers] = useState(route.params.allPlayers ?? []);
  const isHost = player.is_host;
  const socket = getSocket();

  useSocketListeners({
    'room:player_joined': ({ allPlayers }) => setPlayers(allPlayers),
    'room:player_disconnected': ({ playerId }) =>
      setPlayers((prev) => prev.filter((p) => p.id !== playerId)),
    'game:started': (data) =>
      navigation.replace('Game', { room, player, gameData: data }),
  });

  useEffect(() => {
    const onDisconnect = () => {
      Alert.alert('切断', 'サーバーとの接続が切れました');
      navigation.replace('Home');
    };
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, []);

  function handleStart() {
    if (players.length < 2) return Alert.alert('エラー', '最低2人必要です');
    socket.emit('game:start', null, (res) => {
      if (!res.ok) Alert.alert('エラー', res.error);
    });
  }

  return (
    <View style={styles.container}>
      {/* ルームコード */}
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>ルームコード</Text>
        <Text style={styles.codeText}>{room.code}</Text>
        <Text style={styles.codeHint}>このコードを友達に共有してください</Text>
      </View>

      {/* プレイヤー一覧 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>参加者　{players.length} / 6</Text>
        <FlatList
          data={players}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.playerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.nickname.charAt(0)}</Text>
              </View>
              <Text style={styles.playerName}>{item.nickname}</Text>
              <View style={styles.badges}>
                {item.isHost && <View style={styles.badge}><Text style={styles.badgeText}>ホスト</Text></View>}
                {item.id === player.id && <View style={[styles.badge, styles.badgeMe]}><Text style={[styles.badgeText, styles.badgeTextMe]}>あなた</Text></View>}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>

      {/* アクション */}
      <View style={styles.footer}>
        {isHost ? (
          <TouchableOpacity
            style={[styles.btnPrimary, players.length < 2 && styles.btnDisabled]}
            onPress={handleStart}
            disabled={players.length < 2}
          >
            <Text style={styles.btnPrimaryText}>ゲームを開始する</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.waitingBox}>
            <Text style={styles.waitingText}>ホストがゲームを開始するのを待っています</Text>
          </View>
        )}
        <TouchableOpacity style={styles.btnGhost} onPress={() => { disconnectSocket(); navigation.replace('Home'); }}>
          <Text style={styles.btnGhostText}>退出する</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7', paddingTop: 56 },
  codeCard: {
    backgroundColor: '#FFF',
    margin: 16,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  codeLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 8 },
  codeText: { fontSize: 42, fontWeight: '800', color: '#FF3B5C', letterSpacing: 8 },
  codeHint: { fontSize: 12, color: '#BBB', marginTop: 8 },
  section: { flex: 1, marginHorizontal: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#999', marginBottom: 10 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 12,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFE8EC',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#FF3B5C' },
  playerName: { flex: 1, fontSize: 15, color: '#1A1A1A', fontWeight: '500' },
  badges: { flexDirection: 'row', gap: 6 },
  badge: {
    backgroundColor: '#F5F5F5', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeMe: { backgroundColor: '#FFF0F3' },
  badgeText: { fontSize: 11, color: '#999', fontWeight: '600' },
  badgeTextMe: { color: '#FF3B5C' },
  separator: { height: 6 },
  footer: { padding: 16, gap: 8 },
  btnPrimary: {
    backgroundColor: '#FF3B5C', borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#E0E0E0' },
  btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  waitingBox: {
    backgroundColor: '#FFF', borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  waitingText: { color: '#999', fontSize: 14 },
  btnGhost: { padding: 12, alignItems: 'center' },
  btnGhostText: { color: '#C0C0C0', fontSize: 14 },
});

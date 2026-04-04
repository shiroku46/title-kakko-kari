import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useSocketListeners, getSocket, disconnectSocket } from '../hooks/useSocket';

const ROUND_OPTIONS = [3, 5, 7, 10];

export default function LobbyScreen({ navigation, route }) {
  const { room, player } = route.params;
  const [players, setPlayers] = useState(route.params.allPlayers ?? []);
  const [gameMode, setGameMode] = useState('player'); // 'player' | 'cpu'
  const [cpuRounds, setCpuRounds] = useState(5);
  const [starting, setStarting] = useState(false);
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
    if (players.length < 2) {
      return Alert.alert('エラー', `もう${2 - players.length}人参加が必要です`);
    }
    setStarting(true);
    const timer = setTimeout(() => {
      setStarting(false);
      Alert.alert('エラー', 'サーバーから応答がありません。再試行してください。');
    }, 10000);
    socket.emit('game:start', { mode: gameMode, totalRounds: cpuRounds }, (res) => {
      clearTimeout(timer);
      if (!res.ok) {
        setStarting(false);
        Alert.alert('エラー', res.error);
      }
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

      {/* ゲーム設定（ホストのみ） */}
      {isHost && (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>ゲーム設定</Text>

          {/* モード選択 */}
          <Text style={styles.settingsLabel}>出題形式</Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, gameMode === 'player' && styles.modeBtnActive]}
              onPress={() => setGameMode('player')}
            >
              <Text style={[styles.modeBtnText, gameMode === 'player' && styles.modeBtnTextActive]}>
                プレイヤー出題
              </Text>
              <Text style={[styles.modeBtnSub, gameMode === 'player' && styles.modeBtnSubActive]}>
                全員が1回ずつ出題
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, gameMode === 'cpu' && styles.modeBtnActive]}
              onPress={() => setGameMode('cpu')}
            >
              <Text style={[styles.modeBtnText, gameMode === 'cpu' && styles.modeBtnTextActive]}>
                CPU出題
              </Text>
              <Text style={[styles.modeBtnSub, gameMode === 'cpu' && styles.modeBtnSubActive]}>
                Wikipediaが自動出題
              </Text>
            </TouchableOpacity>
          </View>

          {/* CPU モード時のラウンド数選択 */}
          {gameMode === 'cpu' && (
            <>
              <Text style={styles.settingsLabel}>ラウンド数</Text>
              <View style={styles.roundRow}>
                {ROUND_OPTIONS.map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.roundBtn, cpuRounds === n && styles.roundBtnActive]}
                    onPress={() => setCpuRounds(n)}
                  >
                    <Text style={[styles.roundBtnText, cpuRounds === n && styles.roundBtnTextActive]}>
                      {n}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {/* アクション */}
      <View style={styles.footer}>
        {isHost ? (
          <>
            <TouchableOpacity
              style={[styles.btnPrimary, (starting) && styles.btnDisabled]}
              onPress={handleStart}
              disabled={starting}
            >
              <Text style={styles.btnPrimaryText}>
                {starting ? '開始中...' : 'ゲームを開始する'}
              </Text>
            </TouchableOpacity>
            {players.length < 2 && (
              <Text style={styles.hintText}>あと{2 - players.length}人の参加が必要です</Text>
            )}
          </>
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
    marginBottom: 8,
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
  section: { flex: 1, marginHorizontal: 16, marginBottom: 8 },
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
  // 設定パネル
  settingsCard: {
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  settingsTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 },
  settingsLabel: { fontSize: 11, fontWeight: '600', color: '#999', marginBottom: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: {
    flex: 1, borderRadius: 12, padding: 12,
    borderWidth: 1.5, borderColor: '#EBEBEB',
    backgroundColor: '#FAFAFA',
  },
  modeBtnActive: { borderColor: '#FF3B5C', backgroundColor: '#FFF5F7' },
  modeBtnText: { fontSize: 13, fontWeight: '700', color: '#999', marginBottom: 2 },
  modeBtnTextActive: { color: '#FF3B5C' },
  modeBtnSub: { fontSize: 10, color: '#C0C0C0' },
  modeBtnSubActive: { color: '#FF7A93' },
  roundRow: { flexDirection: 'row', gap: 8 },
  roundBtn: {
    width: 48, height: 40, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#EBEBEB',
    backgroundColor: '#FAFAFA',
    alignItems: 'center', justifyContent: 'center',
  },
  roundBtnActive: { borderColor: '#FF3B5C', backgroundColor: '#FFF5F7' },
  roundBtnText: { fontSize: 15, fontWeight: '700', color: '#999' },
  roundBtnTextActive: { color: '#FF3B5C' },
  // フッター
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
  hintText: { textAlign: 'center', color: '#999', fontSize: 13, marginTop: 6 },
});

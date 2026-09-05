import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { useSocketListeners, getSocket, disconnectSocket } from '../hooks/useSocket';
import { colors, radii, spacing } from '../theme';
import { fontFamilies } from '../theme/typography';
import { PaperPanel, StationeryButton, PlayerCard } from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

const ROUND_OPTIONS = [3, 5, 7, 10];
const MIN_PLAYERS = (__DEV__ && process.env.EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV === 'true') ? 3 : 4;

export default function LobbyScreen({ navigation, route }) {
  const { room, player } = route.params;
  const [players, setPlayers] = useState(route.params.allPlayers ?? []);
  const [gameMode, setGameMode] = useState('player'); // 'player' | 'cpu'
  const [cpuRounds, setCpuRounds] = useState(5);
  const [starting, setStarting] = useState(false);
  const [isHost, setIsHost] = useState(player.is_host);
  const socket = getSocket();
  const { isPC, isMobile, contentPadding } = useResponsiveLayout();

  useSocketListeners({
    'room:player_joined': ({ allPlayers }) => setPlayers(allPlayers),
    'room:player_disconnected': ({ playerId }) => {
      setPlayers((prev) => prev.filter((p) => p.id !== playerId));
      socket.emit('room:get_state', null, (res) => {
        if (!res.ok) return;
        setIsHost(Boolean(res.room.players.find((p) => p.id === player.id)?.is_host));
        setPlayers(res.room.players.filter((p) => p.is_connected).map((p) => ({
          id: p.id, nickname: p.nickname, score: p.score, isHost: p.is_host,
        })));
      });
    },
    'game:started': (data) =>
      navigation.replace('Game', { room, player: { ...player, is_host: isHost }, gameData: data }),
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
    if (players.length < MIN_PLAYERS) {
      return Alert.alert('エラー', `もう${MIN_PLAYERS - players.length}人参加が必要です`);
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

  const roomCodeCard = (
    <PaperPanel variant="elevated" style={styles.codeCard}>
      <Text style={styles.codeLabel}>ルームコード</Text>
      <Text style={styles.codeText} accessibilityLabel={`ルームコード ${room.code}`}>{room.code}</Text>
      <Text style={styles.codeHint}>このコードを友達に共有してください</Text>
      <Text style={styles.playerCount}>{players.length} / 6 人参加中</Text>
    </PaperPanel>
  );

  const playerGrid = (
    <View>
      <Text style={styles.sectionTitle}>参加者</Text>
      <View style={[styles.playerGrid, isPC && styles.playerGridPC]}>
        {players.map((p) => (
          <PlayerCard
            key={p.id}
            player={p}
            isMe={p.id === player.id}
            isHost={p.isHost}
            style={isPC ? styles.playerCardPC : undefined}
          />
        ))}
      </View>
    </View>
  );

  const settingsPanel = isHost && (
    <PaperPanel style={styles.settingsCard}>
      <Text style={styles.settingsTitle}>ゲーム設定</Text>

      <Text style={styles.settingsLabel}>出題形式</Text>
      <View style={styles.modeRow}>
        {[
          { key: 'player', label: 'プレイヤー出題', sub: '全員が1回ずつ出題' },
          { key: 'cpu', label: 'CPU出題', sub: 'Wikipediaが自動出題' },
        ].map(({ key, label, sub }) => (
          <StationeryButton
            key={key}
            variant={gameMode === key ? 'primary' : 'secondary'}
            onPress={() => setGameMode(key)}
            accessibilityLabel={label}
            style={styles.modeBtn}
            textStyle={styles.modeBtnText}
          >
            {label}
          </StationeryButton>
        ))}
      </View>

      {gameMode === 'cpu' && (
        <>
          <Text style={styles.settingsLabel}>ラウンド数</Text>
          <View style={styles.roundRow}>
            {ROUND_OPTIONS.map((n) => (
              <StationeryButton
                key={n}
                variant={cpuRounds === n ? 'primary' : 'secondary'}
                onPress={() => setCpuRounds(n)}
                accessibilityLabel={`${n}ラウンド`}
                style={styles.roundBtn}
              >
                {String(n)}
              </StationeryButton>
            ))}
          </View>
        </>
      )}
    </PaperPanel>
  );

  const actionArea = (
    <View style={styles.actionArea}>
      {isHost ? (
        <>
          <StationeryButton
            variant="primary"
            onPress={handleStart}
            loading={starting}
            disabled={starting}
            accessibilityLabel="ゲームを開始する"
          >
            ゲームを開始する
          </StationeryButton>
          {players.length < MIN_PLAYERS && (
            <Text style={styles.hintText}>あと{MIN_PLAYERS - players.length}人の参加が必要です</Text>
          )}
        </>
      ) : (
        <PaperPanel style={styles.waitingBox}>
          <Text style={styles.waitingText}>ホストがゲームを開始するのを待っています</Text>
        </PaperPanel>
      )}
      <StationeryButton
        variant="ghost"
        onPress={() => { disconnectSocket(); navigation.replace('Home'); }}
        accessibilityLabel="退出する"
        style={styles.exitBtn}
        textStyle={styles.exitBtnText}
      >
        退出する
      </StationeryButton>
    </View>
  );

  if (isPC) {
    return (
      <View style={styles.pcRoot}>
        <View style={[styles.pcContent, { maxWidth: CONTENT_MAX_WIDTH }]}>
          {/* 上部: ルームコード */}
          <View style={styles.pcHeader}>
            {roomCodeCard}
          </View>

          {/* 中部: プレイヤー + 設定 */}
          <View style={styles.pcBody}>
            <View style={styles.pcMain}>
              {playerGrid}
            </View>
            <View style={styles.pcSide}>
              {settingsPanel}
              {actionArea}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.mobileContainer, { padding: contentPadding }]}
    >
      {roomCodeCard}
      {playerGrid}
      {settingsPanel}
      {actionArea}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  mobileContainer: { gap: 12, paddingTop: 56, paddingBottom: 32 },
  codeCard: { alignItems: 'center' },
  codeLabel: { fontSize: 11, fontWeight: '600', color: colors.muted, marginBottom: 8, letterSpacing: 0.5 },
  codeText: {
    fontFamily: fontFamilies.sans,
    fontSize: 42,
    fontWeight: '800',
    color: colors.navy,
    letterSpacing: 8,
  },
  codeHint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  playerCount: { fontSize: 13, color: colors.muted, marginTop: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 10, letterSpacing: 0.5 },
  playerGrid: { gap: 8 },
  playerGridPC: { flexDirection: 'row', flexWrap: 'wrap' },
  playerCardPC: { width: '31%', minWidth: 160, flexGrow: 1 },
  settingsCard: {},
  settingsTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 14 },
  settingsLabel: { fontSize: 11, fontWeight: '600', color: colors.muted, marginBottom: 8, letterSpacing: 0.5 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  modeBtn: { flex: 1, paddingHorizontal: 8 },
  modeBtnText: { fontSize: 13 },
  roundRow: { flexDirection: 'row', gap: 8 },
  roundBtn: { minWidth: 48, paddingHorizontal: 8 },
  actionArea: { gap: 8 },
  waitingBox: { alignItems: 'center', paddingVertical: 4 },
  waitingText: { color: colors.muted, fontSize: 14 },
  hintText: { textAlign: 'center', color: colors.muted, fontSize: 13, marginTop: 4 },
  exitBtn: { alignSelf: 'center' },
  exitBtnText: { color: colors.muted, fontSize: 13 },

  // PC
  pcRoot: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
  },
  pcContent: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 32,
    paddingTop: 32,
    paddingBottom: 24,
    gap: 20,
  },
  pcHeader: {},
  pcBody: { flex: 1, flexDirection: 'row', gap: 20 },
  pcMain: { flex: 2 },
  pcSide: { flex: 1, gap: 12 },
});

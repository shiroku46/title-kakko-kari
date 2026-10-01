import { fontFamilies } from '../theme/typography';
import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { Text } from '../components/ui/GameText';
import { useSocketListeners, getSocket, disconnectSocket } from '../hooks/useSocket';
import { colors, radii } from '../theme';
import {
  PaperPanel,
  StationeryButton,
  PlayerCard,
  GameLogo,
  PopBackdrop,
} from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

const ROUND_OPTIONS = [3, 5, 7, 10];
const MIN_PLAYERS = (__DEV__ && process.env.EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV === 'true') ? 3 : 4;

export default function LobbyScreen({ navigation, route }) {
  const { room, player } = route.params;
  const [players, setPlayers] = useState(route.params.allPlayers ?? []);
  const [gameMode, setGameMode] = useState('player');
  const [cpuRounds, setCpuRounds] = useState(5);
  const [starting, setStarting] = useState(false);
  const [isHost, setIsHost] = useState(player.is_host);
  const socket = getSocket();
  const { isPC, contentPadding } = useResponsiveLayout();

  useSocketListeners({
    'room:player_joined': ({ allPlayers }) => setPlayers(allPlayers),
    'room:player_disconnected': ({ playerId }) => {
      setPlayers((prev) => prev.filter((p) => p.id !== playerId));
      socket.emit('room:get_state', null, (res) => {
        if (!res.ok) return;
        setIsHost(Boolean(res.room.players.find((p) => p.id === player.id)?.is_host));
        setPlayers(res.room.players.filter((p) => p.is_connected).map((p) => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          isHost: p.is_host,
        })));
      });
    },
    'game:started': (data) =>
      navigation.replace('Game', {
        room,
        player: { ...player, is_host: isHost },
        gameData: data,
      }),
  });

  useEffect(() => {
    const onDisconnect = () => {
      Alert.alert('切断', 'サーバーとの接続が切れました');
      navigation.replace('Home');
    };
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, [navigation, socket]);

  function handleStart() {
    if (players.length < MIN_PLAYERS) {
      return Alert.alert('まだ開始できません', `あと${MIN_PLAYERS - players.length}人の参加が必要です`);
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

  const displaySlots = Array.from({ length: 6 }, (_, index) => players[index] ?? null);

  return (
    <PopBackdrop>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.container,
          { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
        ]}
      >
        <View style={styles.topBar}>
          <GameLogo compact />
          <StationeryButton
            variant="ghost"
            onPress={() => {
              disconnectSocket();
              navigation.replace('Home');
            }}
            accessibilityLabel="ルームを退出"
            style={styles.exitButton}
            textStyle={styles.exitText}
          >
            ルームを退出
          </StationeryButton>
        </View>

        <View style={styles.lobbyTitleRow}>
          <View style={styles.lobbyTitle}>
            <Text style={styles.kicker}>ROOM LOBBY</Text>
            <Text style={styles.pageTitle}>みんなが集まるのを待っています</Text>
          </View>
          <View style={styles.countBubble}>
            <Text style={styles.countNumber}>{players.length}</Text>
            <Text style={styles.countUnit}>/ 6人</Text>
          </View>
        </View>

        <View style={[styles.body, isPC && styles.bodyPC]}>
          <View style={styles.mainColumn}>
            <PaperPanel tone="cream" variant="elevated" style={styles.codePanel}>
              <View style={styles.codeTop}>
                <View>
                  <Text style={styles.codeLabel}>ルームコード</Text>
                  <Text
                    style={styles.codeText}
                    accessibilityLabel={`ルームコード ${room.code}`}
                  >
                    {room.code}
                  </Text>
                </View>
                <View style={styles.shareBadge}>
                  <Text style={styles.shareBadgeIcon}>↗</Text>
                  <Text style={styles.shareBadgeText}>このコードを共有</Text>
                </View>
              </View>
              <Text style={styles.codeHint}>
                一緒に遊ぶ人へ、この6桁のコードを伝えてください。
              </Text>
            </PaperPanel>

            <View style={styles.sectionHeader}>
              <View style={styles.sectionMarker} />
              <Text style={styles.sectionTitle}>参加メンバー</Text>
              <Text style={styles.sectionSub}>4〜6人で遊べます</Text>
            </View>

            <View style={[styles.playerGrid, isPC && styles.playerGridPC]}>
              {displaySlots.map((slot, index) => (
                <PlayerCard
                  key={slot?.id ?? `empty-${index}`}
                  player={slot}
                  isMe={slot?.id === player.id}
                  isHost={Boolean(slot?.isHost)}
                  status={slot ? 'ready' : undefined}
                  style={isPC ? styles.playerCardPC : undefined}
                />
              ))}
            </View>

            {!isHost && (
              <PaperPanel tone="sky" style={styles.waitingPanel}>
                <View style={styles.waitingIcon}>
                  <Text style={styles.waitingIconText}>…</Text>
                </View>
                <View style={styles.waitingBody}>
                  <Text style={styles.waitingTitle}>ホストの設定を待っています</Text>
                  <Text style={styles.waitingNote}>
                    参加者が揃うと、ホストがゲームを開始します。
                  </Text>
                </View>
              </PaperPanel>
            )}
          </View>

          <View style={styles.sideColumn}>
            {isHost ? (
              <PaperPanel tone="white" variant="elevated" style={styles.settingsPanel}>
                <View style={styles.settingsHeadingRow}>
                  <View>
                    <Text style={styles.settingsKicker}>HOST SETTINGS</Text>
                    <Text style={styles.settingsTitle}>ゲーム設定</Text>
                  </View>
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>ホスト</Text>
                  </View>
                </View>

                <Text style={styles.settingsLabel}>出題モード</Text>
                <View style={styles.modeStack}>
                  <ModeButton
                    selected={gameMode === 'player'}
                    title="プレイヤー出題"
                    note="参加者が順番に作品を出題"
                    color={colors.red}
                    onPress={() => setGameMode('player')}
                  />
                  <ModeButton
                    selected={gameMode === 'cpu'}
                    title="CPU出題"
                    note="出典付きの作品から出題"
                    color={colors.blue}
                    onPress={() => setGameMode('cpu')}
                  />
                </View>

                {gameMode === 'cpu' && (
                  <>
                    <Text style={styles.settingsLabel}>ラウンド数</Text>
                    <View style={styles.roundRow}>
                      {ROUND_OPTIONS.map((n) => (
                        <StationeryButton
                          key={n}
                          variant={cpuRounds === n ? 'yellow' : 'neutral'}
                          onPress={() => setCpuRounds(n)}
                          accessibilityLabel={`${n}ラウンド`}
                          style={styles.roundButton}
                          textStyle={styles.roundButtonText}
                        >
                          {String(n)}
                        </StationeryButton>
                      ))}
                    </View>
                  </>
                )}

                <View style={styles.startArea}>
                  <StationeryButton
                    variant="primary"
                    onPress={handleStart}
                    loading={starting}
                    disabled={starting || players.length < MIN_PLAYERS}
                    accessibilityLabel="ゲームを開始する"
                  >
                    ゲームを開始する →
                  </StationeryButton>
                  {players.length < MIN_PLAYERS ? (
                    <Text style={styles.startHint}>
                      あと{MIN_PLAYERS - players.length}人の参加が必要です
                    </Text>
                  ) : (
                    <Text style={styles.startReady}>準備完了。いつでも開始できます！</Text>
                  )}
                </View>
              </PaperPanel>
            ) : (
              <PaperPanel tone="navy" style={styles.guestPanel}>
                <Text style={styles.guestKicker}>READY?</Text>
                <Text style={styles.guestTitle}>あなたは参加済みです</Text>
                <Text style={styles.guestBody}>
                  画面を閉じずに、そのままお待ちください。
                </Text>
              </PaperPanel>
            )}

            <PaperPanel tone="yellow" style={styles.tipPanel}>
              <Text style={styles.tipTitle}>待っている間に</Text>
              <Text style={styles.tipBody}>
                「それっぽいタイトル」を考えるコツは、作品の紹介文から雰囲気とジャンルを想像すること。
              </Text>
            </PaperPanel>
          </View>
        </View>
      </ScrollView>
    </PopBackdrop>
  );
}

function ModeButton({ selected, title, note, color, onPress }) {
  return (
    <StationeryButton
      variant={selected ? 'yellow' : 'neutral'}
      onPress={onPress}
      accessibilityLabel={title}
      style={[styles.modeButton, selected && { borderColor: color }]}
      textStyle={styles.modeButtonText}
    >
      {selected ? '● ' : '○ '}{title}
      {'\n'}
      {note}
    </StationeryButton>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 24 : 54,
    paddingBottom: 36,
  },
  topBar: {
    minHeight: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exitButton: { minHeight: 42, paddingHorizontal: 10 },
  exitText: { fontSize: 12, color: colors.muted },
  lobbyTitleRow: {
    marginTop: 20,
    marginBottom: 14,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  lobbyTitle: { flex: 1, minWidth: 0 },
  kicker: { color: colors.red, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 },
  pageTitle: {
    fontFamily: fontFamilies.display,
    color: colors.navy,
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '900',
    marginTop: 3,
  },
  countBubble: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: colors.navy,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  countNumber: { color: colors.yellow, fontSize: 25, fontWeight: '900' },
  countUnit: { color: colors.white, fontSize: 12, fontWeight: '800' },
  body: { gap: 14 },
  bodyPC: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  mainColumn: { flex: 1.7, gap: 14 },
  sideColumn: { flex: 1, gap: 14 },
  codePanel: { padding: 20 },
  codeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  codeLabel: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  codeText: {
    color: colors.navy,
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: 8,
    marginTop: 2,
  },
  shareBadge: {
    borderRadius: radii.md,
    backgroundColor: '#E5F6FA',
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  shareBadgeIcon: { color: colors.red, fontSize: 18, fontWeight: '900' },
  shareBadgeText: { color: colors.navy, fontSize: 10, fontWeight: '800', marginTop: 1 },
  codeHint: { color: colors.muted, fontSize: 12, marginTop: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionMarker: { width: 7, height: 23, borderRadius: 4, backgroundColor: colors.red },
  sectionTitle: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 11, marginLeft: 'auto' },
  playerGrid: { gap: 9 },
  playerGridPC: { flexDirection: 'row', flexWrap: 'wrap' },
  playerCardPC: { width: '31%', minWidth: 190, flexGrow: 1 },
  waitingPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  waitingIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.cyan,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingIconText: { color: colors.navy, fontWeight: '900', fontSize: 22 },
  waitingBody: { flex: 1 },
  waitingTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  waitingNote: { color: colors.muted, fontSize: 11, marginTop: 3 },
  settingsPanel: { padding: 20 },
  settingsHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 13,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    marginBottom: 15,
  },
  settingsKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  settingsTitle: { color: colors.navy, fontSize: 22, fontWeight: '900', marginTop: 2 },
  hostBadge: {
    backgroundColor: colors.yellow,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  hostBadgeText: { color: colors.navy, fontSize: 10, fontWeight: '900' },
  settingsLabel: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 8,
    marginTop: 2,
  },
  modeStack: { gap: 8, marginBottom: 15 },
  modeButton: {
    minHeight: 64,
    alignItems: 'flex-start',
    paddingHorizontal: 14,
  },
  modeButtonText: { textAlign: 'left', fontSize: 12, lineHeight: 19 },
  roundRow: { flexDirection: 'row', gap: 7, marginBottom: 14 },
  roundButton: { flex: 1, minWidth: 0, minHeight: 45, paddingHorizontal: 6 },
  roundButtonText: { fontSize: 13 },
  startArea: {
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
    paddingTop: 15,
    marginTop: 2,
  },
  startHint: { textAlign: 'center', color: colors.muted, fontSize: 11, marginTop: 8 },
  startReady: { textAlign: 'center', color: colors.green, fontSize: 11, fontWeight: '800', marginTop: 8 },
  guestPanel: {},
  guestKicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 },
  guestTitle: { color: colors.white, fontSize: 20, fontWeight: '900', marginTop: 5 },
  guestBody: { color: '#C3D6E4', fontSize: 12, lineHeight: 19, marginTop: 7 },
  tipPanel: {},
  tipTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  tipBody: { color: colors.ink, fontSize: 12, lineHeight: 19, marginTop: 5 },
});

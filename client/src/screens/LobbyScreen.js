import { fontFamilies } from '../theme/typography';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { Text } from '../components/ui/GameText';
import { Alert } from '../utils/alert';
import { useSocketListeners, getSocket, leaveRoom } from '../hooks/useSocket';
import useRoomRecovery from '../hooks/useRoomRecovery';
import PlayerSettings from '../components/PlayerSettings';
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
const MIN_PLAYERS = 2;

export default function LobbyScreen({ navigation, route }) {
  const { room, player } = route.params;
  const [players, setPlayers] = useState(route.params.allPlayers ?? []);
  const [gameMode, setGameMode] = useState('cpu');
  const [cpuRounds, setCpuRounds] = useState(5);
  const [starting, setStarting] = useState(false);
  const [genreDisclosure, setGenreDisclosure] = useState(Boolean(room.settings?.genreDisclosure));
  const [progressSettings, setProgressSettings] = useState({ advanceMode: room.settings?.advanceMode || 'auto', timeLimitSeconds: room.settings?.timeLimitSeconds || 0 });
  const [settingsPending, setSettingsPending] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [isHost, setIsHost] = useState(player.is_host);
  const leavingRef = useRef(false);
  const startRequestRef = useRef(null);
  const socket = getSocket();
  const reconnecting = useRoomRecovery(navigation, leavingRef);
  const { isPC, contentPadding } = useResponsiveLayout();

  useSocketListeners({
    'room:settings_updated': ({ settings }) => { setGenreDisclosure(Boolean(settings.genreDisclosure)); setProgressSettings(settings); },
    'room:player_joined': ({ allPlayers }) => setPlayers(allPlayers),
    'room:players_updated': ({ allPlayers }) => setPlayers(allPlayers),
    'room:player_disconnected': ({ playerId }) => {
      setPlayers((prev) => prev.filter((p) => p.id !== playerId));
      socket.emit('room:get_state', null, (res) => {
        if (!res.ok) return;
        setIsHost(Boolean(res.room.players.find((p) => p.id === player.id)?.is_host));
        setGenreDisclosure(Boolean(res.room.settings?.genreDisclosure));
        setProgressSettings(res.room.settings);
        setPlayers(res.room.players.filter((p) => p.is_connected).map((p) => ({
          id: p.id,
          nickname: p.nickname,
          score: p.score,
          isHost: p.is_host,
          isComputer: Boolean(p.is_computer),
          icon: p.icon, profileReady: p.profile_ready,
        })));
      });
    },
    'game:started': (data) => {
      clearTimeout(startRequestRef.current);
      startRequestRef.current = null;
      navigation.replace('Game', {
        room: { ...room, players: players.map((p) => ({ ...p, is_host: p.isHost, is_computer: p.isComputer,
          is_connected: true, is_online: p.isOnline, profile_ready: p.profileReady })) },
        player: { ...player, ...players.find((p) => p.id === player.id), profile_ready: true, is_host: isHost },
        gameData: data,
      });
    },
  });

  useEffect(() => {
    return () => {
      clearTimeout(startRequestRef.current);
      startRequestRef.current = null;
    };
  }, []);

  function handleStart() {
    if (startRequestRef.current || leavingRef.current) return;
    if (!socket.connected) return Alert.alert('接続を戻しています', 'つながるまで、この画面のままお待ちください。');
    if (players.length < MIN_PLAYERS) {
      return Alert.alert('まだ開始できません', `あと${MIN_PLAYERS - players.length}人の参加が必要です`);
    }
    setStarting(true);
    const timer = setTimeout(() => {
      if (startRequestRef.current !== timer) return;
      startRequestRef.current = null;
      setStarting(false);
      Alert.alert('エラー', 'サーバーから応答がありません。再試行してください。');
    }, 10000);
    startRequestRef.current = timer;

    socket.emit('game:start', { mode: effectiveGameMode, totalRounds: cpuRounds, genreDisclosure }, (res) => {
      if (startRequestRef.current !== timer) return;
      clearTimeout(timer);
      startRequestRef.current = null;
      if (!res.ok) {
        setStarting(false);
        Alert.alert('エラー', res.error);
      }
    });
  }

  function updateGenreRule(value, changes = {}) {
    if (settingsPending || starting) return;
    setSettingsPending(true);
    socket.timeout(10000).emit('room:update_settings', { ...progressSettings, ...changes, genreDisclosure: value }, (error, res) => {
      if (leavingRef.current) return;
      setSettingsPending(false);
      if (error || !res?.ok) Alert.alert('ルールを変更できませんでした', error ? '接続を確認して、もう一度お試しください。' : res?.error);
      else { setGenreDisclosure(Boolean(res.settings.genreDisclosure)); setProgressSettings(res.settings); }
    });
  }

  function updateComputers(count) {
    if (settingsPending || starting) return;
    setSettingsPending(true);
    socket.timeout(10000).emit('room:set_computers', { count }, (error, res) => {
      if (leavingRef.current) return;
      setSettingsPending(false);
      if (error || !res?.ok) Alert.alert('コンピュータを変更できませんでした', error ? '接続を確認して、もう一度お試しください。' : res?.error);
    });
  }

  async function handleCopyCode() {
    setCopyStatus('');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(room.code));
      } else {
        const focused = document.activeElement;
        const field = document.createElement('textarea');
        field.value = String(room.code);
        field.readOnly = true;
        field.setAttribute('aria-hidden', 'true');
        field.tabIndex = -1;
        Object.assign(field.style, { position: 'fixed', opacity: '0', top: '0', left: '0' });
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand('copy')) throw new Error('Copy failed');
        } finally {
          field.remove();
          focused?.focus?.();
        }
      }
      if (!leavingRef.current) setCopyStatus('コピーしました！');
    } catch {
      if (!leavingRef.current) setCopyStatus('コピーできませんでした。コードを選択してコピーしてください。');
    }
  }

  const displaySlots = Array.from({ length: 6 }, (_, index) => players[index] ?? null);
  const computerCount = players.filter((p) => p.isComputer).length;
  const humanCount = players.length - computerCount;
  const effectiveGameMode = humanCount === 1 ? 'cpu' : gameMode;
  const waitingForNames = players.some(p => !p.isComputer && p.profileReady === false);

  return (
    <PopBackdrop>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.container,
          { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
        ]}
      >
        {reconnecting ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.codeHint}>
            接続を戻しています… この画面のままお待ちください。
          </Text>
        ) : null}
        <View style={styles.topBar}>
          <GameLogo compact />
          <View style={styles.topActions}>
          <PlayerSettings player={players.find(p => p.id === player.id) || player} room={room} navigation={navigation} />
          <StationeryButton
            variant="ghost"
            onPress={() => {
              leavingRef.current = true;
              leaveRoom();
              navigation.replace('Home');
            }}
            accessibilityLabel="ルームを退出"
            style={styles.exitButton}
            textStyle={styles.exitText}
          >
            ルームを退出
          </StationeryButton>
          </View>
        </View>

        <View style={[styles.lobbyTitleRow, !isPC && styles.lobbyTitleRowStacked]}>
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
          <View style={[styles.mainColumn, isPC && styles.mainColumnPC]}>
            <PaperPanel tone="cream" variant="elevated" style={styles.codePanel}>
              <View style={styles.codeTop}>
                <View>
                  <Text style={styles.codeLabel}>ルームコード</Text>
                  <Pressable
                    onPress={handleCopyCode}
                    disabled={Platform.OS !== 'web'}
                    accessibilityRole={Platform.OS === 'web' ? 'button' : undefined}
                    accessibilityLabel={`ルームコード ${room.code} をコピー`}
                    style={({ pressed }) => pressed && styles.copyPressed}
                  >
                    <Text style={styles.codeText} selectable>{room.code}</Text>
                  </Pressable>
                </View>
                <Pressable
                  onPress={handleCopyCode}
                  disabled={Platform.OS !== 'web'}
                  accessibilityRole={Platform.OS === 'web' ? 'button' : undefined}
                  accessibilityLabel="コードをコピー"
                  style={({ pressed }) => [styles.shareBadge, pressed && styles.copyPressed]}
                >
                  <Text style={styles.shareBadgeIcon}>⧉</Text>
                  <Text style={styles.shareBadgeText}>
                    {Platform.OS === 'web' ? 'コードをコピー' : 'このコードを共有'}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.codeHint} accessibilityLiveRegion="polite">
                {copyStatus || (Platform.OS === 'web'
                  ? 'コードをクリックしてコピーし、一緒に遊ぶ人へ共有できます。'
                  : '一緒に遊ぶ人へ、この6桁のコードを伝えてください。')}
              </Text>
            </PaperPanel>

            <View style={styles.sectionHeader}>
              <View style={styles.sectionMarker} />
              <Text style={styles.sectionTitle}>参加メンバー</Text>
              <Text style={styles.sectionSub}>合わせて2〜6席</Text>
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

          <View style={[styles.sideColumn, isPC && styles.sideColumnPC]}>
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

                <Text style={styles.settingsLabel}>コンピュータ回答者</Text>
                <View style={styles.roundRow}>
                  <StationeryButton variant="neutral" onPress={() => updateComputers(computerCount - 1)}
                    disabled={settingsPending || starting || computerCount === 0}
                    accessibilityLabel="コンピュータを1人減らす" style={styles.roundButton}>−</StationeryButton>
                  <Text style={styles.computerCount} accessibilityLiveRegion="polite">{computerCount}人</Text>
                  <StationeryButton variant="neutral" onPress={() => updateComputers(computerCount + 1)}
                    disabled={settingsPending || starting || players.length >= 6}
                    accessibilityLabel="コンピュータを1人増やす" style={styles.roundButton}>＋</StationeryButton>
                </View>
                <Text style={styles.startHint}>紹介文からタイトル案を自動提出します。投票と出題はしません。</Text>

                <Text style={styles.settingsLabel}>出題モード</Text>
                <View style={styles.modeStack}>
                  {humanCount > 1 ? <ModeButton
                    selected={effectiveGameMode === 'player'}
                    title="プレイヤー出題"
                    note="参加者が順番に作品を出題"
                    color={colors.red}
                    onPress={() => setGameMode('player')}
                  /> : null}
                  <ModeButton
                    selected={effectiveGameMode === 'cpu'}
                    title="CPU出題"
                    note="出典付きの作品から出題"
                    color={colors.blue}
                    onPress={() => setGameMode('cpu')}
                  />
                </View>
                {humanCount === 1 ? <Text style={styles.startHint}>ひとりでの対戦はコンピュータが出題します。</Text> : null}

                <Text style={styles.settingsLabel}>ジャンル指定</Text>
                <View style={styles.roundRow}>
                  {[false, true].map((value) => (
                    <StationeryButton key={String(value)} variant={genreDisclosure === value ? 'yellow' : 'neutral'}
                      onPress={() => updateGenreRule(value)} disabled={settingsPending || starting}
                      accessibilityLabel={`ジャンル指定${value ? 'あり' : 'なし'}`} style={styles.roundButton}>
                      {value ? 'あり' : 'なし'}
                    </StationeryButton>
                  ))}
                </View>
                <Text style={styles.startHint}>
                  {genreDisclosure ? '小説・映画・漫画・ゲームなど、ジャンルを選んでから、そのジャンルの問題を用意します。' : '作品の種類を伏せて、紹介文から自由にタイトルを考えます。'}
                </Text>

                <Text style={styles.settingsLabel}>進み方</Text>
                <View style={styles.roundRow}>{[['auto', '自動送り'], ['consent', '出題者が進める']].map(([value, label]) =>
                  <StationeryButton key={value} variant={progressSettings.advanceMode === value ? 'yellow' : 'neutral'}
                    disabled={settingsPending || starting} onPress={() => updateGenreRule(genreDisclosure, { advanceMode: value })}
                    accessibilityLabel={label}>{label}</StationeryButton>)}</View>
                <Text style={styles.settingsLabel}>回答・投票の制限時間</Text>
                <View style={styles.roundRow}>{[0, 30, 60, 120, 180].map((value) =>
                  <StationeryButton key={value} variant={progressSettings.timeLimitSeconds === value ? 'yellow' : 'neutral'}
                    disabled={settingsPending || starting} onPress={() => updateGenreRule(genreDisclosure, { timeLimitSeconds: value })}
                    accessibilityLabel={value ? `${value}秒` : '制限なし'}>{value ? `${value}秒` : 'なし'}</StationeryButton>)}</View>
                <Text style={styles.startHint}>時間が終わると提出済みの回答・投票で進みます。出題者が進める設定では同意を待ちます。タイトル案が一つもなければ提出を待ちます。</Text>

                {effectiveGameMode === 'cpu' && (
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
                    disabled={starting || settingsPending || players.length < MIN_PLAYERS || waitingForNames}
                    accessibilityLabel="ゲームを開始する"
                  >
                    ゲームを開始する →
                  </StationeryButton>
                  {waitingForNames ? (
                    <Text style={styles.startHint}>参加者の名前の入力を待っています。</Text>
                  ) : players.length < MIN_PLAYERS ? (
                    <Text style={styles.startHint}>
                      あと{MIN_PLAYERS - players.length}席必要です。人間かコンピュータを追加してください。
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
                  ジャンル指定：{genreDisclosure ? 'あり（ジャンルを選んで出題）' : 'なし（お題の種類を伏せる）'}{'\n'}
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
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
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
  lobbyTitleRowStacked: { backgroundColor: colors.canvas },
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
  mainColumn: { gap: 14 },
  mainColumnPC: { flex: 1.7 },
  sideColumn: { gap: 14 },
  sideColumnPC: { flex: 1 },
  codePanel: { padding: 20 },
  codeTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  codeLabel: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  copyPressed: { opacity: 0.65 },
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
  roundRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  roundButton: { flex: 1, minWidth: 0, minHeight: 45, paddingHorizontal: 6 },
  roundButtonText: { fontSize: 13 },
  computerCount: { alignSelf: 'center', color: colors.navy, fontSize: 18, fontWeight: '900', minWidth: 50, textAlign: 'center' },
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

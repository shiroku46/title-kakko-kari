import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { connectSocket, disconnectSocket, getCurrentUrl } from '../hooks/useSocket';
import { DEFAULT_SERVER_URL } from '../config';
import { colors, radii, shadows } from '../theme';
import {
  PaperPanel,
  StationeryButton,
  GameLogo,
  PopBackdrop,
} from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

const SAMPLE_TITLES = [
  { title: '海が見えるコンビニで', tag: '#青春', tone: colors.cyan },
  { title: '月曜のカレーは、少しだけやさしい', tag: '#日常', tone: colors.yellow },
  { title: '推しの存在が世界を救うらしい', tag: '#ファンタジー', tone: colors.pink },
];

export default function HomeScreen({ navigation }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(getCurrentUrl());
  const { isPC, contentPadding } = useResponsiveLayout();

  async function startConnect(action) {
    const targetUrl = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/$/, '');
    setLoading(true);
    setLoadingMsg('サーバーに接続しています…');

    const slowTimer = setTimeout(() => {
      setLoadingMsg('サーバーを起動中です（最大90秒）…');
    }, 4000);
    const abortCtrl = new AbortController();
    const healthTimer = setTimeout(() => abortCtrl.abort(), 90000);

    try {
      await fetch(`${targetUrl}/health`, { signal: abortCtrl.signal });
    } catch (_) {
      clearTimeout(slowTimer);
      clearTimeout(healthTimer);
      setLoading(false);
      setLoadingMsg('');
      Alert.alert('接続エラー', `サーバーに接続できません。\nURL: ${targetUrl}`);
      return;
    }

    clearTimeout(slowTimer);
    clearTimeout(healthTimer);
    setLoadingMsg('ルームを準備しています…');
    const socket = connectSocket(targetUrl);

    function proceed() {
      setLoadingMsg('');
      action(socket, () => {
        setLoading(false);
        setLoadingMsg('');
      });
    }

    if (socket.connected) {
      proceed();
      return;
    }

    const socketTimer = setTimeout(() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      setLoading(false);
      setLoadingMsg('');
      Alert.alert('接続エラー', 'ソケット接続に失敗しました。再試行してください。');
      disconnectSocket();
    }, 10000);

    function onConnect() {
      clearTimeout(socketTimer);
      socket.off('connect_error', onConnectError);
      proceed();
    }

    function onConnectError() {
      clearTimeout(socketTimer);
      socket.off('connect', onConnect);
      setLoading(false);
      setLoadingMsg('');
      Alert.alert('接続エラー', 'ソケット接続に失敗しました。再試行してください。');
      disconnectSocket();
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);
  }

  function handleCreate() {
    const nick = nickname.trim();
    if (!nick) return Alert.alert('入力してください', 'ニックネームを入力してください');
    startConnect((socket, done) => {
      socket.emit('room:create', { nickname: nick }, (res) => {
        done();
        if (!res.ok) return Alert.alert('エラー', res.error);
        navigation.replace('Lobby', {
          room: res.room,
          player: res.player,
          allPlayers: [{ id: res.player.id, nickname: nick, isHost: true, score: 0 }],
        });
      });
    });
  }

  function handleJoin() {
    const nick = nickname.trim();
    const code = roomCode.trim().toUpperCase();
    if (!nick) return Alert.alert('入力してください', 'ニックネームを入力してください');
    if (!code) return Alert.alert('入力してください', 'ルームコードを入力してください');
    startConnect((socket, done) => {
      socket.emit('room:join', { nickname: nick, code }, (res) => {
        done();
        if (!res.ok) return Alert.alert('エラー', res.error);
        navigation.replace('Lobby', {
          room: res.room,
          player: res.player,
          allPlayers: res.allPlayers,
        });
      });
    });
  }

  const formPanel = (
    <PaperPanel tone="cream" variant="elevated" style={styles.formPanel}>
      <View style={styles.formHeader}>
        <Text style={styles.formKicker}>JOIN THE GAME</Text>
        <Text style={styles.formHeading}>
          {mode === 'join' ? 'ルームに参加' : 'ゲームをはじめる'}
        </Text>
        <Text style={styles.formIntro}>
          {mode === 'join'
            ? '名前と6桁のコードを入力してください。'
            : 'まずは、ゲームで使う名前を決めましょう。'}
        </Text>
      </View>

      <Text style={styles.fieldLabel}>ニックネーム</Text>
      <TextInput
        style={styles.input}
        placeholder="例：山田太郎"
        placeholderTextColor={colors.muted}
        value={nickname}
        onChangeText={setNickname}
        maxLength={12}
        accessibilityLabel="ニックネーム入力欄"
      />

      {mode === 'join' && (
        <>
          <Text style={styles.fieldLabel}>ルームコード</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="ABC123"
            placeholderTextColor={colors.muted}
            value={roomCode}
            onChangeText={setRoomCode}
            autoCapitalize="characters"
            maxLength={6}
            accessibilityLabel="ルームコード入力欄"
          />
        </>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.red} size="large" />
          <Text style={styles.loadingMsg}>{loadingMsg}</Text>
        </View>
      ) : mode === 'home' ? (
        <View style={styles.actionStack}>
          <StationeryButton
            variant="primary"
            onPress={handleCreate}
            accessibilityLabel="ルームを作る"
          >
            ＋ ルームを作る
          </StationeryButton>
          <StationeryButton
            variant="secondary"
            onPress={() => setMode('join')}
            accessibilityLabel="ルームに参加する"
          >
            ルームに参加する →
          </StationeryButton>
        </View>
      ) : (
        <View style={styles.actionStack}>
          <StationeryButton
            variant="primary"
            onPress={handleJoin}
            accessibilityLabel="参加する"
          >
            参加する →
          </StationeryButton>
          <StationeryButton
            variant="ghost"
            onPress={() => setMode('home')}
            accessibilityLabel="戻る"
          >
            ← 作成・参加の選択へ戻る
          </StationeryButton>
        </View>
      )}

      <TouchableOpacity
        style={styles.ruleLink}
        onPress={() => navigation.navigate('Rules')}
        accessibilityRole="button"
        accessibilityLabel="遊び方を見る"
      >
        <Text style={styles.ruleLinkIcon}>?</Text>
        <Text style={styles.ruleLinkText}>遊び方を見る</Text>
        <Text style={styles.ruleLinkArrow}>›</Text>
      </TouchableOpacity>
    </PaperPanel>
  );

  return (
    <PopBackdrop>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.container,
            { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topBar}>
            <GameLogo compact />
            <View style={styles.topActions}>
              <TouchableOpacity
                style={styles.topLink}
                onPress={() => navigation.navigate('Rules')}
                accessibilityRole="button"
              >
                <Text style={styles.topLinkText}>遊び方</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.topLink}
                onPress={() => setShowSettings((value) => !value)}
                accessibilityRole="button"
              >
                <Text style={styles.topLinkText}>接続設定</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.main, isPC && styles.mainPC]}>
            <View style={[styles.hero, isPC && styles.heroPC]}>
              <View style={styles.speechTag}>
                <Text style={styles.speechTagText}>そのタイトル、本物？ それともウソ？</Text>
              </View>

              <GameLogo light={false} style={styles.heroLogo} />

              <Text style={styles.heroCopy}>
                あらすじから、ありそうなタイトルを考える。
                {'\n'}みんなで投票して、本物を見抜くパーティーゲーム。
              </Text>

              <View style={styles.sampleHeadingRow}>
                <View style={styles.sampleMark} />
                <Text style={styles.sampleHeading}>こんなタイトル、ありかも？</Text>
              </View>

              <View style={styles.sampleGrid}>
                {SAMPLE_TITLES.map((item, index) => (
                  <View
                    key={item.title}
                    style={[
                      styles.sampleCard,
                      { borderTopColor: item.tone },
                      !isPC && styles.sampleCardMobile,
                    ]}
                  >
                    <View style={[styles.sampleThumb, { backgroundColor: item.tone }]}>
                      <Text style={styles.sampleThumbText}>{String(index + 1).padStart(2, '0')}</Text>
                    </View>
                    <View style={styles.sampleBody}>
                      <Text style={styles.sampleTitle}>{item.title}</Text>
                      <Text style={styles.sampleTag}>{item.tag}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.featureRow}>
                {[
                  ['01', '知識不要', 'ひらめきと言葉で遊べます'],
                  ['02', 'みんなで盛り上がる', '4〜6人ですぐ試遊できます'],
                  ['03', '作品は自由', '映画・小説・漫画・ゲーム'],
                ].map(([num, title, desc], index) => (
                  <View key={num} style={[styles.feature, index === 1 && styles.featureBlue]}>
                    <Text style={styles.featureNum}>{num}</Text>
                    <View style={styles.featureText}>
                      <Text style={styles.featureTitle}>{title}</Text>
                      <Text style={styles.featureDesc}>{desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={[styles.formArea, isPC && styles.formAreaPC]}>
              {formPanel}
              <StationeryButton
                variant="ghost"
                onPress={() => setShowSettings((value) => !value)}
                accessibilityLabel="サーバー設定を開閉"
                textStyle={styles.settingsToggleText}
              >
                {showSettings ? '接続設定を閉じる ▲' : '接続設定を開く ▼'}
              </StationeryButton>
              {showSettings && (
                <SettingsCard serverUrl={serverUrl} setServerUrl={setServerUrl} />
              )}
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerBrand}>タイトルたほいや</Text>
            <Text style={styles.footerCopy}>言葉で、あそぶ。タイトルで、つながる。</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PopBackdrop>
  );
}

function SettingsCard({ serverUrl, setServerUrl }) {
  return (
    <PaperPanel tone="sky" style={styles.settingsCard}>
      <Text style={styles.settingsTitle}>接続設定</Text>
      <Text style={styles.fieldLabel}>サーバーURL</Text>
      <TextInput
        style={styles.input}
        value={serverUrl}
        onChangeText={setServerUrl}
        placeholder={DEFAULT_SERVER_URL}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="サーバーURL入力欄"
      />
      <Text style={styles.settingsNote}>
        通常は変更不要です。ローカル試遊ではPCのIPアドレスを指定します。
      </Text>
      <StationeryButton
        variant="neutral"
        onPress={() => setServerUrl(DEFAULT_SERVER_URL)}
        accessibilityLabel="デフォルトURLに戻す"
      >
        デフォルトに戻す
      </StationeryButton>
    </PaperPanel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  container: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 24 : 54,
    paddingBottom: 28,
  },
  topBar: {
    minHeight: 64,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    ...shadows.paper,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topLink: {
    minHeight: 42,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  topLinkText: { color: colors.navy, fontSize: 13, fontWeight: '800' },
  main: { gap: 18, marginTop: 18 },
  mainPC: { flexDirection: 'row', alignItems: 'stretch', gap: 24 },
  hero: {
    backgroundColor: colors.navy,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    padding: 22,
    overflow: 'hidden',
  },
  heroPC: { flex: 1.65, padding: 30 },
  speechTag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.yellow,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    paddingHorizontal: 12,
    paddingVertical: 7,
    transform: [{ rotate: '-2deg' }],
  },
  speechTagText: { color: colors.navy, fontWeight: '900', fontSize: 12 },
  heroLogo: {
    marginTop: 20,
    backgroundColor: colors.cream,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignSelf: 'flex-start',
    transform: [{ rotate: '-1deg' }],
  },
  heroCopy: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 28,
    fontWeight: '700',
    marginTop: 20,
    maxWidth: 620,
  },
  sampleHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    marginBottom: 10,
  },
  sampleMark: {
    width: 8,
    height: 22,
    borderRadius: 4,
    backgroundColor: colors.red,
  },
  sampleHeading: { color: colors.white, fontSize: 15, fontWeight: '900' },
  sampleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sampleCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    borderTopWidth: 6,
    padding: 10,
    flexDirection: 'row',
    gap: 10,
  },
  sampleCardMobile: { minWidth: '100%' },
  sampleThumb: {
    width: 46,
    height: 46,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sampleThumbText: { color: colors.navy, fontWeight: '900', fontSize: 13 },
  sampleBody: { flex: 1 },
  sampleTitle: { color: colors.navy, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  sampleTag: { color: colors.muted, fontSize: 10, marginTop: 5, fontWeight: '700' },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  feature: {
    flex: 1,
    minWidth: 160,
    borderRadius: radii.md,
    backgroundColor: '#E4F5E9',
    borderWidth: 2,
    borderColor: colors.navyDeep,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  featureBlue: { backgroundColor: '#DCF1FF' },
  featureNum: {
    color: colors.red,
    fontSize: 15,
    fontWeight: '900',
    width: 28,
  },
  featureText: { flex: 1 },
  featureTitle: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  featureDesc: { color: colors.muted, fontSize: 10, marginTop: 2 },
  formArea: { gap: 8 },
  formAreaPC: { width: 390, flexShrink: 0 },
  formPanel: { padding: 22 },
  formHeader: {
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    paddingBottom: 14,
    marginBottom: 16,
  },
  formKicker: {
    color: colors.red,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  formHeading: {
    color: colors.navy,
    fontSize: 25,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: 4,
  },
  formIntro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.navy,
    marginBottom: 7,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 14,
  },
  codeInput: {
    letterSpacing: 6,
    fontWeight: '900',
    fontSize: 20,
    textAlign: 'center',
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingMsg: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  actionStack: { gap: 10 },
  ruleLink: {
    marginTop: 16,
    borderTopWidth: 1.5,
    borderTopColor: colors.border,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 12,
  },
  ruleLinkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    color: colors.navy,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '900',
  },
  ruleLinkText: { flex: 1, color: colors.navy, fontSize: 13, fontWeight: '900' },
  ruleLinkArrow: { color: colors.navy, fontSize: 24 },
  settingsToggleText: { fontSize: 12, color: colors.navy },
  settingsCard: { marginTop: 2 },
  settingsTitle: { color: colors.navy, fontSize: 17, fontWeight: '900', marginBottom: 12 },
  settingsNote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 12 },
  footer: {
    marginTop: 18,
    minHeight: 58,
    borderRadius: radii.lg,
    backgroundColor: colors.navy,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerBrand: { color: colors.white, fontSize: 13, fontWeight: '900' },
  footerCopy: { color: '#BCD1E0', fontSize: 11, fontWeight: '700' },
});

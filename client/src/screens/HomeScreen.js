import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { connectSocket, disconnectSocket, getCurrentUrl } from '../hooks/useSocket';
import { DEFAULT_SERVER_URL } from '../config';
import { colors, radii, spacing } from '../theme';
import { fontFamilies } from '../theme/typography';
import { PaperPanel, StationeryButton, StickyNote, Stamp } from '../components/ui';
import { MaskingTape, Pencil, Eraser } from '../components/decor/StationeryDecor';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

const SAMPLE_TITLES = [
  'キラキラ光る海の底で',
  '夜明けまでの三角関係',
  '彼女は最終バスに乗る',
];

export default function HomeScreen({ navigation }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home'); // 'home' | 'join'
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(getCurrentUrl());
  const { isPC, isMobile, contentPadding } = useResponsiveLayout();

  async function startConnect(action) {
    const targetUrl = (serverUrl.trim() || DEFAULT_SERVER_URL).replace(/\/$/, '');
    setLoading(true);
    setLoadingMsg('接続中...');

    const slowTimer = setTimeout(() => {
      setLoadingMsg('サーバーを起動中（最大90秒）...');
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

    setLoadingMsg('ルームを準備中...');
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
      setLoading(false);
      setLoadingMsg('');
      Alert.alert('接続エラー', 'ソケット接続に失敗しました。再試行してください。');
      disconnectSocket();
    }, 10000);

    function onConnect() {
      clearTimeout(socketTimer);
      proceed();
    }
    socket.once('connect', onConnect);
  }

  function handleCreate() {
    const nick = nickname.trim();
    if (!nick) return Alert.alert('エラー', 'ニックネームを入力してください');
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
    if (!nick) return Alert.alert('エラー', 'ニックネームを入力してください');
    if (!code) return Alert.alert('エラー', 'ルームコードを入力してください');
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
    <PaperPanel variant="elevated" style={styles.formPanel}>
      <Text style={styles.formHeading}>
        {mode === 'join' ? 'ルームに参加する' : 'ゲームをはじめる'}
      </Text>

      <Text style={styles.fieldLabel}>ニックネーム</Text>
      <TextInput
        style={styles.input}
        placeholder="例: 山田太郎"
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
            placeholder="例: ABC123"
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
          <ActivityIndicator color={colors.navy} size="large" />
          {loadingMsg ? <Text style={styles.loadingMsg}>{loadingMsg}</Text> : null}
        </View>
      ) : mode === 'home' ? (
        <>
          <StationeryButton
            variant="primary"
            onPress={handleCreate}
            accessibilityLabel="ルームを作る"
            style={styles.btnMain}
          >
            ルームを作る
          </StationeryButton>
          <StationeryButton
            variant="secondary"
            onPress={() => setMode('join')}
            accessibilityLabel="ルームに参加する"
            style={styles.btnSub}
          >
            ルームに参加する
          </StationeryButton>
        </>
      ) : (
        <>
          <StationeryButton
            variant="primary"
            onPress={handleJoin}
            accessibilityLabel="参加する"
            style={styles.btnMain}
          >
            参加する
          </StationeryButton>
          <StationeryButton
            variant="ghost"
            onPress={() => setMode('home')}
            accessibilityLabel="戻る"
          >
            ← 戻る
          </StationeryButton>
        </>
      )}

      <StationeryButton
        variant="ghost"
        onPress={() => navigation.navigate('Rules')}
        accessibilityLabel="ルールを確認する"
        style={styles.rulesBtn}
        textStyle={styles.rulesBtnText}
      >
        ルールを確認する
      </StationeryButton>
    </PaperPanel>
  );

  if (isPC) {
    return (
      <View style={styles.pcRoot}>
        <View style={[styles.pcInner, { maxWidth: CONTENT_MAX_WIDTH }]}>
          {/* 左: ヒーロー */}
          <View style={styles.pcHero}>
            <View style={styles.logoArea}>
              <View style={styles.logoStampRow}>
                <Stamp type="仮" size="sm" style={styles.logoStamp} />
              </View>
              <Text style={styles.pcTitle}>タイトルの名付け親は誰だ？</Text>
              <Text style={styles.pcSubtitle}>命名系クイズゲーム</Text>
            </View>

            <View style={styles.stickyArea}>
              {SAMPLE_TITLES.map((t, i) => (
                <StickyNote key={i} color={['mustard', 'blue', 'rose'][i % 3]} style={styles.stickyNote}>
                  {t}
                </StickyNote>
              ))}
            </View>

            <View style={styles.decorRow}>
              <Pencil style={styles.decorItem} />
              <MaskingTape color={colors.mustard} angle={-2} style={styles.decorItem} />
              <Eraser style={styles.decorItem} />
            </View>

            <Text style={styles.pcDescription}>
              実在する作品のあらすじを聞いて、{'\n'}
              本物のタイトルを見抜く言葉のゲーム。{'\n'}
              偽タイトルで仲間を騙し、得点を競え！
            </Text>
          </View>

          {/* 右: フォーム */}
          <View style={styles.pcFormArea}>
            {formPanel}

            {/* サーバー設定 */}
            <StationeryButton
              variant="ghost"
              onPress={() => setShowSettings(!showSettings)}
              accessibilityLabel="サーバー設定"
              style={styles.settingsToggle}
              textStyle={styles.settingsToggleText}
            >
              {showSettings ? '▲ サーバー設定を閉じる' : '⚙ サーバー設定'}
            </StationeryButton>
            {showSettings && <SettingsCard serverUrl={serverUrl} setServerUrl={setServerUrl} />}
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.mobileContainer, { padding: contentPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヒーロー */}
        <View style={styles.mobileHero}>
          <View style={styles.logoStampRow}>
            <Stamp type="仮" size="sm" style={styles.logoStamp} />
          </View>
          <Text style={styles.mobileTitle}>タイトルの名付け親は誰だ？</Text>
          <Text style={styles.mobileSubtitle}>命名系クイズゲーム</Text>

          <View style={styles.mobileStickyRow}>
            {SAMPLE_TITLES.slice(0, 2).map((t, i) => (
              <StickyNote key={i} color={['mustard', 'rose'][i]} style={styles.mobileStickyNote}>
                {t}
              </StickyNote>
            ))}
          </View>
        </View>

        {formPanel}

        <StationeryButton
          variant="ghost"
          onPress={() => setShowSettings(!showSettings)}
          accessibilityLabel="サーバー設定"
          style={styles.settingsToggle}
          textStyle={styles.settingsToggleText}
        >
          {showSettings ? '▲ サーバー設定を閉じる' : '⚙ サーバー設定'}
        </StationeryButton>

        {showSettings && <SettingsCard serverUrl={serverUrl} setServerUrl={setServerUrl} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SettingsCard({ serverUrl, setServerUrl }) {
  return (
    <PaperPanel style={styles.settingsCard}>
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
        スマートフォン実機でテストする場合はPCのローカルIPに変更してください。{'\n'}
        例: http://192.168.1.10:3000{'\n'}
        （PCで ipconfig → IPv4アドレス を確認）
      </Text>
      <StationeryButton
        variant="ghost"
        onPress={() => setServerUrl(DEFAULT_SERVER_URL)}
        accessibilityLabel="デフォルトURLに戻す"
        textStyle={styles.resetBtnText}
      >
        デフォルトに戻す
      </StationeryButton>
    </PaperPanel>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  mobileContainer: { flexGrow: 1, justifyContent: 'center', gap: 16 },
  mobileHero: { alignItems: 'center', marginBottom: 8 },
  logoStampRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  logoStamp: { opacity: 0.7 },
  mobileTitle: {
    fontFamily: fontFamilies.serif,
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 38,
  },
  mobileSubtitle: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
  mobileStickyRow: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  mobileStickyNote: { maxWidth: 160 },
  formPanel: {},
  formHeading: { fontSize: 16, fontWeight: '700', color: colors.navy, marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: colors.muted, marginBottom: 6, letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.canvas,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 14,
  },
  codeInput: { letterSpacing: 4, fontWeight: '700', fontSize: 20, textAlign: 'center' },
  loadingBox: { alignItems: 'center', marginTop: 16, marginBottom: 8 },
  loadingMsg: { fontSize: 12, color: colors.muted, marginTop: 8 },
  btnMain: { marginBottom: 8 },
  btnSub: { marginBottom: 4 },
  rulesBtn: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  rulesBtnText: { color: colors.navy, fontSize: 13 },
  settingsToggle: { alignSelf: 'center', marginTop: 8 },
  settingsToggleText: { fontSize: 12, color: colors.muted },
  settingsCard: { marginTop: 8 },
  settingsNote: { fontSize: 11, color: colors.muted, lineHeight: 18, marginBottom: 12 },
  resetBtnText: { color: colors.muted, fontSize: 13 },

  // PC
  pcRoot: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pcInner: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 48,
    paddingVertical: 32,
    gap: 48,
  },
  pcHero: { flex: 1, paddingRight: 16 },
  logoArea: { marginBottom: 32 },
  pcTitle: {
    fontFamily: fontFamilies.serif,
    fontSize: 36,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 50,
    marginBottom: 8,
  },
  pcSubtitle: { fontSize: 14, color: colors.muted },
  stickyArea: { gap: 12, marginBottom: 32, maxWidth: 360 },
  stickyNote: {},
  decorRow: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 24 },
  decorItem: {},
  pcDescription: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 24,
  },
  pcFormArea: { width: 380 },
});

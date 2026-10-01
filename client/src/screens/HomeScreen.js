import React, { useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Text, TextInput } from '../components/ui/GameText';
import { connectSocket, disconnectSocket, getCurrentUrl } from '../hooks/useSocket';
import { DEFAULT_SERVER_URL } from '../config';
import { colors } from '../theme';
import { brandAssets } from '../theme/brand';
import {
  PaperPanel,
  StationeryButton,
  GameLogo,
} from '../components/ui';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';

export default function HomeScreen({ navigation }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(getCurrentUrl());
  const { isPC, width, height } = useResponsiveLayout();

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
    <View style={styles.formPanel}>
      <View style={styles.formHeader}>
        <Text style={[styles.formHeading, isPC && styles.formHeadingPC]}>
          {mode === 'join' ? '部屋に入る' : 'いっしょに遊ぼう'}
        </Text>
        <Text style={styles.formIntro}>
          {mode === 'join'
            ? '名前と6桁のコードを入れてね。'
            : 'ゲームで使う名前を入れてね。'}
        </Text>
      </View>

      <Text style={styles.fieldLabel}>ニックネーム</Text>
      <TextInput
        style={[styles.input, isPC && styles.inputPC]}
        placeholder="例：たろう"
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
            style={[styles.input, isPC && styles.inputPC, styles.codeInput]}
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
            style={[styles.playButton, isPC && styles.playButtonPC]}
            textStyle={styles.playButtonText}
            onPress={handleCreate}
            accessibilityLabel="部屋をつくる"
          >
            部屋をつくる
          </StationeryButton>
          <StationeryButton
            variant="neutral"
            style={[styles.playButton, styles.joinButton, isPC && styles.playButtonPC]}
            textStyle={styles.playButtonText}
            onPress={() => setMode('join')}
            accessibilityLabel="部屋に入る"
          >
            部屋に入る
          </StationeryButton>
        </View>
      ) : (
        <View style={styles.actionStack}>
          <StationeryButton
            variant="primary"
            style={[styles.playButton, isPC && styles.playButtonPC]}
            textStyle={styles.playButtonText}
            onPress={handleJoin}
            accessibilityLabel="参加する"
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
        </View>
      )}

      <TouchableOpacity
        style={styles.ruleLink}
        onPress={() => navigation.navigate('Rules')}
        accessibilityRole="button"
        accessibilityLabel="遊び方を見る"
      >
        <Text style={styles.ruleLinkText}>遊び方を見る</Text>
        <Text style={styles.ruleLinkArrow}>›</Text>
      </TouchableOpacity>
    </View>
  );

  const illustration = (
    <View
      style={[
        styles.illustration,
        isPC && { maxHeight: Math.max(250, Math.min(410, (height - 180) * 0.48)) },
      ]}
    >
      <Image
        source={brandAssets.cards}
        style={styles.illustrationImage}
        resizeMode="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </View>
  );

  return (
    <View style={styles.backdrop}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.container,
            { paddingHorizontal: isPC ? width * 0.0575 : 20 },
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
                accessibilityLabel="遊び方"
              >
                <Text style={[styles.topLinkText, isPC && styles.topLinkTextPC]}>遊び方</Text>
              </TouchableOpacity>
              <View style={styles.navDivider} />
              <TouchableOpacity
                style={styles.topLink}
                onPress={() => setShowSettings((value) => !value)}
                accessibilityRole="button"
                accessibilityLabel="接続設定"
                accessibilityState={{ expanded: showSettings }}
              >
                <Text style={[styles.topLinkText, isPC && styles.topLinkTextPC]}>接続設定</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.main, isPC && styles.mainPC]}>
            <View style={[styles.hero, isPC && styles.heroPC]}>
              <GameLogo style={isPC && { maxWidth: width * 0.52 }} />
              <Text style={[styles.tagline, isPC && styles.taglinePC]}>
                ウソの題名をつくって、{!isPC && '\n'}本物を見ぬこう。
              </Text>
              <Text style={[styles.heroCopy, isPC && styles.heroCopyPC]}>
                あらすじを読んで、ありそうな題名を考える。
                {'\n'}みんなで選んで、答え合わせ。
              </Text>
              {isPC && illustration}
            </View>

            <View style={[styles.formArea, isPC && styles.formAreaPC]}>
              {formPanel}
              {showSettings && (
                <SettingsCard serverUrl={serverUrl} setServerUrl={setServerUrl} />
              )}
            </View>
          </View>
          {!isPC && illustration}

          <View style={styles.footer}>
            <View style={styles.footerRule} />
            <Text style={styles.footerCopy}>4〜6人で遊べます</Text>
            <View style={styles.footerRule} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
        ふつうは、そのままで遊べます。
      </Text>
      <StationeryButton
        variant="neutral"
        onPress={() => setServerUrl(DEFAULT_SERVER_URL)}
        accessibilityLabel="デフォルトURLに戻す"
      >
        はじめの設定に戻す
      </StationeryButton>
    </PaperPanel>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  container: {
    width: '100%',
    maxWidth: 1586,
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 10 : 54,
    paddingBottom: 24,
  },
  topBar: {
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.navy,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topLink: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' },
  topLinkText: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  topLinkTextPC: { fontSize: 16 },
  navDivider: { width: 1, height: 18, backgroundColor: colors.border },
  main: { gap: 28, marginTop: 24 },
  mainPC: { flexDirection: 'row', alignItems: 'center', gap: 32, marginTop: 24 },
  hero: { alignItems: 'center' },
  heroPC: { flex: 1, minWidth: 0 },
  tagline: {
    color: colors.navy,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
  },
  taglinePC: { fontSize: 30, lineHeight: 42 },
  heroCopy: { color: colors.ink, fontSize: 13, lineHeight: 23, textAlign: 'center', marginTop: 10 },
  heroCopyPC: { fontSize: 20, lineHeight: 32, marginTop: 12 },
  illustration: { width: '100%', aspectRatio: 2, marginTop: 6 },
  illustrationImage: { width: '100%', height: '100%' },
  formArea: { width: '100%' },
  formAreaPC: {
    width: '34%',
    paddingLeft: 40,
    paddingVertical: 24,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  formPanel: { width: '100%' },
  formHeader: { marginBottom: 24 },
  formHeading: { color: colors.navy, fontSize: 24, lineHeight: 34, fontWeight: '700' },
  formHeadingPC: { fontSize: 36, lineHeight: 50 },
  formIntro: { color: colors.ink, fontSize: 14, lineHeight: 24, marginTop: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: colors.navy, marginBottom: 8 },
  input: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.navy,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 18,
  },
  inputPC: { minHeight: 72, fontSize: 19, marginBottom: 28 },
  codeInput: { letterSpacing: 6, fontWeight: '700', fontSize: 20, textAlign: 'center' },
  loadingBox: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  loadingMsg: { fontSize: 14, lineHeight: 22, color: colors.muted, textAlign: 'center' },
  actionStack: { gap: 14 },
  playButton: { minHeight: 56, borderRadius: 10, shadowColor: colors.navy, shadowOffset: { width: 2, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 0 },
  playButtonPC: { minHeight: 72 },
  playButtonText: { fontSize: 20, fontWeight: '700', letterSpacing: 0 },
  joinButton: { backgroundColor: colors.cream },
  ruleLink: { minHeight: 48, marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  ruleLinkText: { color: colors.navy, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
  ruleLinkArrow: { color: colors.navy, fontSize: 28, lineHeight: 32 },
  settingsCard: { marginTop: 18, padding: 16 },
  settingsTitle: { color: colors.navy, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  settingsNote: { color: colors.muted, fontSize: 12, lineHeight: 20, marginBottom: 12 },
  footer: { marginTop: 16, flexDirection: 'row', gap: 18, alignItems: 'center', justifyContent: 'center' },
  footerRule: { width: 48, height: 1, backgroundColor: colors.navy },
  footerCopy: { color: colors.navy, fontSize: 14, lineHeight: 22 },
});

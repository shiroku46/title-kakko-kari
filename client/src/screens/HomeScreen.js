import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { connectSocket, disconnectSocket, getCurrentUrl } from '../hooks/useSocket';
import { DEFAULT_SERVER_URL } from '../config';

export default function HomeScreen({ navigation }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home'); // 'home' | 'join'
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(getCurrentUrl());

  function startConnect(action) {
    setLoading(true);
    setLoadingMsg('接続中...');
    const socket = connectSocket(serverUrl.trim() || DEFAULT_SERVER_URL);

    const slowTimer = setTimeout(() => {
      setLoadingMsg('サーバーを起動中（最大30秒）...');
    }, 5000);

    const timeoutTimer = setTimeout(() => {
      clearTimeout(slowTimer);
      setLoading(false);
      setLoadingMsg('');
      Alert.alert('接続エラー', `サーバーに接続できません。\n${serverUrl.trim() || DEFAULT_SERVER_URL}`);
      disconnectSocket();
    }, 30000);

    action(socket, () => {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
      setLoading(false);
      setLoadingMsg('');
    });
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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* ヒーロー */}
        <View style={styles.hero}>
          <Text style={styles.title}>タイトル(仮)</Text>
          <Text style={styles.subtitle}>あらすじ当てゲーム</Text>
        </View>

        {/* メインカード */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>ニックネーム</Text>
          <TextInput
            style={styles.input}
            placeholder="例: 山田太郎"
            placeholderTextColor="#C0C0C0"
            value={nickname}
            onChangeText={setNickname}
            maxLength={12}
          />

          {mode === 'join' && (
            <>
              <Text style={styles.fieldLabel}>ルームコード</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                placeholder="例: ABC123"
                placeholderTextColor="#C0C0C0"
                value={roomCode}
                onChangeText={setRoomCode}
                autoCapitalize="characters"
                maxLength={6}
              />
            </>
          )}

          {loading ? (
            <View style={{ alignItems: 'center', marginTop: 20 }}>
              <ActivityIndicator color="#FF3B5C" size="large" />
              {loadingMsg ? <Text style={styles.loadingMsg}>{loadingMsg}</Text> : null}
            </View>
          ) : mode === 'home' ? (
            <>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate}>
                <Text style={styles.btnPrimaryText}>ルームを作る</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSecondary} onPress={() => setMode('join')}>
                <Text style={styles.btnSecondaryText}>ルームに参加する</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleJoin}>
                <Text style={styles.btnPrimaryText}>参加する</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setMode('home')}>
                <Text style={styles.btnGhostText}>← 戻る</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ルール */}
        <TouchableOpacity style={styles.rulesBtn} onPress={() => navigation.navigate('Rules')}>
          <Text style={styles.rulesBtnText}>ルールを確認する</Text>
        </TouchableOpacity>

        {/* サーバー設定（折りたたみ） */}
        <TouchableOpacity style={styles.settingsToggle} onPress={() => setShowSettings(!showSettings)}>
          <Text style={styles.settingsToggleText}>
            {showSettings ? '▲ サーバー設定を閉じる' : '⚙ サーバー設定'}
          </Text>
        </TouchableOpacity>

        {showSettings && (
          <View style={styles.settingsCard}>
            <Text style={styles.fieldLabel}>サーバーURL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder={DEFAULT_SERVER_URL}
              placeholderTextColor="#C0C0C0"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.settingsNote}>
              スマートフォン実機でテストする場合はPCのローカルIPに変更してください。{'\n'}
              例: http://192.168.1.10:3000{'\n'}
              （PCで ipconfig → IPv4アドレス を確認）
            </Text>
            <TouchableOpacity
              style={styles.btnReset}
              onPress={() => setServerUrl(DEFAULT_SERVER_URL)}
            >
              <Text style={styles.btnResetText}>デフォルトに戻す</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F7F7' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  hero: { alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 36, fontWeight: '800', color: '#1A1A1A', letterSpacing: -1 },
  subtitle: { fontSize: 14, color: '#999', marginTop: 4 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#1A1A1A',
    marginBottom: 16,
  },
  codeInput: { letterSpacing: 4, fontWeight: '700', fontSize: 20, textAlign: 'center' },
  btnPrimary: {
    backgroundColor: '#FF3B5C',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#1A1A1A', fontSize: 16, fontWeight: '600' },
  btnGhost: { padding: 14, alignItems: 'center' },
  btnGhostText: { color: '#999', fontSize: 15 },
  rulesBtn: { alignItems: 'center', paddingVertical: 12 },
  rulesBtnText: { fontSize: 14, color: '#FF3B5C', fontWeight: '600' },
  settingsToggle: { alignItems: 'center', paddingVertical: 16 },
  settingsToggleText: { fontSize: 13, color: '#BBB' },
  settingsCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
  },
  settingsNote: { fontSize: 11, color: '#BBB', lineHeight: 18, marginBottom: 12 },
  btnReset: { alignItems: 'center', padding: 8 },
  btnResetText: { fontSize: 13, color: '#C0C0C0' },
  loadingMsg: { fontSize: 12, color: '#999', marginTop: 8 },
});

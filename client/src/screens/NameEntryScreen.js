import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../components/ui/GameText';
import { GameLogo, StationeryButton, PopBackdrop } from '../components/ui';
import { getSocket, leaveRoom } from '../hooks/useSocket';
import useRoomRecovery from '../hooks/useRoomRecovery';
import { getRoomSession, saveRoomSession, showRoom } from '../utils/roomSession';
import { rememberedName, rememberName } from '../utils/playerProfile';
import { readAccount } from '../utils/accountAuth';
import { colors } from '../theme';

export default function NameEntryScreen({ navigation, route }) {
  const { room, player, editing = false } = route.params;
  const socket = getSocket();
  const [nickname, setNickname] = useState(() => player.profile_ready === false ? rememberedName() : player.nickname);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const requestPending = useRef(false);
  const leaving = useRef(false);
  const edited = useRef(false);
  const reconnecting = useRoomRecovery(navigation, leaving);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    if (player.profile_ready === false) readAccount().then(({ user }) => {
      if (current && !edited.current && user) setNickname(user.name?.slice(0, 12) || '');
    });
    return () => { current = false; };
  }, [player.profile_ready]);

  function save() {
    if (!nickname.trim() || requestPending.current || reconnecting) return;
    if (!socket.connected) return setError('接続を確認して、もう一度お試しください。');
    requestPending.current = true;
    setPending(true);
    setError('');
    socket.timeout(10000).emit('room:update_profile', { nickname: nickname.trim() }, (failure, result) => {
      if (!active.current || leaving.current) return;
      requestPending.current = false;
      setPending(false);
      if (failure || !result?.ok) return setError(result?.error || '保存できませんでした。もう一度お試しください。');
      rememberName(result.player.nickname);
      const session = getRoomSession();
      if (session) saveRoomSession({ ...session, nickname: result.player.nickname });
      if (editing) return navigation.goBack();
      requestPending.current = true;
      setPending(true);
      socket.timeout(10000).emit('room:resume', { code: room.code, playerId: result.player.id, token: session?.token }, (stateFailure, state) => {
        if (!active.current || leaving.current) return;
        requestPending.current = false;
        setPending(false);
        if (stateFailure || !state?.ok) return setError('部屋の情報を確認できませんでした。もう一度お試しください。');
        showRoom(navigation, state);
      });
    });
  }

  return <PopBackdrop>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}><GameLogo compact /></View>
        <View style={styles.card}>
          <Text style={styles.room}>ROOM {room.code}</Text>
          <Text accessibilityRole="header" style={styles.heading}>名前を入力してください</Text>
          <Text style={styles.note}>この部屋で使う名前を決めましょう。</Text>
          <Text style={styles.label}>あなたの名前</Text>
          <TextInput value={nickname} onChangeText={value => { edited.current = true; setNickname(value); setError(''); }}
            accessibilityLabel="ニックネーム入力欄" placeholder="例：しろく" placeholderTextColor={colors.muted}
            style={styles.input} maxLength={12} editable={!pending && !reconnecting} autoFocus
            returnKeyType="done" onSubmitEditing={save} autoCorrect={false} />
          <View style={styles.inputMeta}><Text style={styles.limit}>12文字以内</Text><Text style={styles.limit}>{nickname.length} / 12</Text></View>
          {reconnecting ? <Text style={styles.note} accessibilityLiveRegion="polite">接続を戻しています…</Text> : null}
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <StationeryButton onPress={save} loading={pending} disabled={!nickname.trim() || reconnecting}
            accessibilityLabel={editing ? '名前を保存する' : 'この名前で参加する'}>{editing ? '名前を保存する' : 'この名前で参加する'}</StationeryButton>
          <Text style={styles.required}>名前を保存すると、部屋へ進めます。</Text>
        </View>
        <StationeryButton variant="ghost" disabled={pending} onPress={() => {
          if (editing) return navigation.goBack();
          leaving.current = true;
          leaveRoom();
          navigation.replace('Home');
        }} accessibilityLabel={editing ? '名前の変更をやめる' : '部屋から退出する'}>{editing ? '戻る' : '部屋から退出する'}</StationeryButton>
      </ScrollView>
    </KeyboardAvoidingView>
  </PopBackdrop>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40, gap: 20 },
  brand: { marginBottom: 12 },
  card: { width: '100%', maxWidth: 500, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 28 },
  room: { fontSize: 12, fontWeight: '700', letterSpacing: 2, color: colors.muted, marginBottom: 16 },
  heading: { color: colors.navy, fontWeight: '800', fontSize: 25, lineHeight: 36 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 24, marginTop: 8, marginBottom: 26 },
  label: { color: colors.navy, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.paper, padding: 14, fontSize: 18, color: colors.navy },
  inputMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 24 },
  limit: { color: colors.muted, fontSize: 11 },
  error: { color: colors.redDark, lineHeight: 22, marginBottom: 16 },
  required: { color: colors.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 14 },
});

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TextInput } from './ui/GameText';
import { PaperPanel, StationeryButton } from './ui';
import { colors } from '../theme';
import { getRoomSession, saveRoomSession } from '../utils/roomSession';

const ICONS = ['🐈', '🐕', '🦊', '🐼', '🐸', '🐧'];
const PROFILE_KEY = 'title-kakko-kari:profile-v1';
function rememberedProfile() {
  try { return JSON.parse(globalThis.localStorage?.getItem(PROFILE_KEY) || 'null'); }
  catch (_) { return null; }
}

export default function PlayerSettings({ player, socket }) {
  const remembered = rememberedProfile();
  const [open, setOpen] = useState(player.profile_ready === false);
  const [nickname, setNickname] = useState(player.profile_ready === false ? remembered?.nickname || '' : player.nickname);
  const [icon, setIcon] = useState(player.icon || remembered?.icon || ICONS[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  function save() {
    if (pending || !socket.connected) return setError('接続を確認して、もう一度お試しください。');
    setPending(true);
    socket.timeout(10000).emit('room:update_profile', { nickname, icon }, (failure, result) => {
      setPending(false);
      if (failure || !result?.ok) return setError(result?.error || '保存できませんでした。もう一度お試しください。');
      const profile = { nickname: result.player.nickname, icon: result.player.icon };
      try { globalThis.localStorage?.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (_) { /* Keep this room usable. */ }
      const session = getRoomSession();
      if (session) saveRoomSession({ ...session, nickname: profile.nickname });
      setError(null);
      setOpen(false);
    });
  }
  return <View style={styles.container}>
    <StationeryButton variant="ghost" onPress={() => setOpen((value) => !value)} accessibilityLabel="名前とアイコンの設定">
      名前とアイコン
    </StationeryButton>
    {open ? <PaperPanel tone="cream">
      <Text style={styles.heading}>この部屋で使う名前</Text>
      <TextInput accessibilityLabel="ニックネーム入力欄" value={nickname} onChangeText={setNickname}
        maxLength={12} style={styles.input} placeholder="例：たろう" editable={!pending} />
      <View style={styles.icons}>{ICONS.map((value) => <StationeryButton key={value}
        variant={value === icon ? 'yellow' : 'neutral'} onPress={() => setIcon(value)} disabled={pending}
        accessibilityLabel={`アイコン ${value}`} accessibilityState={{ selected: value === icon }}>{value}</StationeryButton>)}</View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <StationeryButton onPress={save} loading={pending} disabled={!nickname.trim()} accessibilityLabel="名前とアイコンを保存する">保存して参加する</StationeryButton>
    </PaperPanel> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 12 },
  heading: { color: colors.navy, fontWeight: '700', marginBottom: 8 },
  input: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.navy, borderRadius: 8, padding: 12, fontSize: 16 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 12 },
  error: { color: colors.red, marginBottom: 8 },
});

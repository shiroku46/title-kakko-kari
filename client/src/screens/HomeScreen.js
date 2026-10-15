import AccountSettings from '../components/AccountSettings';
import React, { useState } from 'react';
import {
  View, Image, StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, TouchableOpacity,
} from 'react-native';
import { Text, TextInput } from '../components/ui/GameText';
import { getCurrentUrl } from '../hooks/useSocket';
import useRoomEntry from '../hooks/useRoomEntry';
import { getRoomSession } from '../utils/roomSession';
import { colors } from '../theme';
import { brandAssets, GAME_NAME } from '../theme/brand';
import { StationeryButton, GameLogo } from '../components/ui';
import HomeDemo from '../components/home/HomeDemo';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';

export default function HomeScreen({ navigation }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home');
  const serverUrl = getCurrentUrl();
  const { width, height } = useResponsiveLayout();
  const wide = width >= 1200;
  const entry = useRoomEntry(navigation);
  const joining = mode === 'join';
  const previousRoom = getRoomSession();

  const openRules = () => navigation.navigate('Rules');
  const start = () => entry.enterRoom({ nickname, code: roomCode, serverUrl, joining });

  const form = <View style={[styles.formArea, wide && styles.formAreaWide]}>
    <Text style={[styles.formHeading, wide && styles.formHeadingWide]}>
      {joining ? '部屋に入る' : 'ゲームをはじめる'}
    </Text>
    <Text style={styles.fieldLabel}>あなたの名前</Text>
    <TextInput style={[styles.input, wide && styles.inputWide]}
      placeholder="例：名無しの命名人" placeholderTextColor={colors.muted}
      value={nickname} onChangeText={(value) => { setNickname(value); entry.clearError(); }}
      maxLength={12} editable={!entry.busy} accessibilityLabel="ニックネーム入力欄"
      autoComplete="off" autoCorrect={false} />

    {joining ? <>
      <Text style={styles.fieldLabel}>ルームコード</Text>
      <TextInput style={[styles.input, wide && styles.inputWide, styles.codeInput]}
        placeholder="123456" placeholderTextColor={colors.muted}
        value={roomCode} onChangeText={(value) => { setRoomCode(value.replace(/\D/g, '').slice(0, 6)); entry.clearError(); }}
        keyboardType="number-pad" maxLength={6} editable={!entry.busy}
        accessibilityLabel="ルームコード入力欄" autoComplete="off" />
    </> : null}

    {entry.error ? <Text style={styles.error} accessibilityRole="alert"
      accessibilityLiveRegion="polite">{entry.error}</Text> : null}

    {entry.busy ? <View style={styles.loadingBox}>
      <ActivityIndicator color={colors.red} />
      <Text style={styles.loadingMessage} accessibilityLiveRegion="polite">{entry.message}</Text>
      <StationeryButton variant="ghost" onPress={entry.cancel} accessibilityLabel="接続をやめる">やめる</StationeryButton>
    </View> : <View style={styles.actionStack}>
      <StationeryButton variant="primary" onPress={start}
        style={[styles.playButton, wide && styles.playButtonWide]}
        textStyle={[styles.playButtonText, wide && styles.playButtonTextWide, { color: colors.white }]}
        accessibilityLabel={joining ? '参加する' : '部屋をつくる'}>
        {joining ? '参加する' : '部屋をつくる'}
      </StationeryButton>
      <StationeryButton variant={joining ? 'ghost' : 'neutral'}
        onPress={() => { setMode(joining ? 'home' : 'join'); entry.clearError(); }}
        style={[styles.playButton, styles.joinButton, wide && styles.playButtonWide]}
        textStyle={[styles.playButtonText, wide && styles.playButtonTextWide]}
        accessibilityLabel={joining ? '戻る' : '部屋に入る'}>
        {joining ? '← 戻る' : '部屋に入る'}
      </StationeryButton>
    </View>}

    <StationeryButton variant="neutral" disabled={entry.busy} style={{ marginTop: 14 }}
      onPress={() => entry.enterRoom({ ...previousRoom, serverUrl: previousRoom?.serverUrl || serverUrl, joining: true, resuming: true })}
      accessibilityLabel="落ち戻り">落ち戻り{previousRoom ? `（${previousRoom.code}）` : ''}</StationeryButton>
    <Text style={styles.settingsNote}>{previousRoom
      ? `「${previousRoom.nickname}」の席に戻ります。名前やコードの入力は不要です。`
      : '通信が切れたときや画面を閉じた後、同じ部屋・同じ席に戻れます。'}</Text>

    <TouchableOpacity style={styles.rulesLink} onPress={openRules} disabled={entry.busy}
      accessibilityRole="button" accessibilityLabel="遊び方を見る">
      <Text style={styles.rulesText}>遊び方を見る</Text><Chevron />
    </TouchableOpacity>
    <StationeryButton variant="ghost" disabled={entry.busy} onPress={() => navigation.navigate('History')}
      accessibilityLabel="遊んだ履歴を見る">遊んだ履歴を見る</StationeryButton>
  </View>;

  const hero = <View style={[styles.hero, wide && styles.heroWide]}>
    <View style={[styles.heroTop, wide && styles.heroTopWide]}>
      <View style={styles.logoArea}>
        <GameLogo />
        <Text style={[styles.tagline, wide && styles.taglineWide]}>ウソを考えて、本物を当てる。</Text>
      </View>
      <View style={[styles.cat, wide && styles.catWide]}>
        <Image source={brandAssets.homeCat} style={styles.catImage} resizeMode="contain"
          accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
    </View>
    {wide ? <HomeDemo horizontal /> : null}
  </View>;

  return <View style={styles.backdrop}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.container, {
          paddingHorizontal: wide ? width * 0.036 : width < 360 ? 16 : 20,
          minHeight: height,
        }]}>
        <View style={styles.topBar}>
          <Text style={[styles.brandName, wide && styles.brandNameWide]}>{GAME_NAME}</Text>
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.topLink} onPress={openRules} disabled={entry.busy}
              accessibilityRole="button" accessibilityLabel="遊び方">
              <Text style={[styles.topLinkText, wide && styles.topLinkTextWide]}>遊び方</Text>
            </TouchableOpacity>
            <View style={styles.navDivider} />
            <AccountSettings />
          </View>
        </View>
        <View style={[styles.main, wide && styles.mainWide]}>
          {hero}
          {form}
        </View>
        {!wide ? <View style={styles.mobileDemo}><HomeDemo /></View> : null}
        <View style={styles.footer}>
          <Text style={styles.footerBrand}>{GAME_NAME}</Text>
          <Text style={styles.footerCopy}>言葉で、あそぶ。</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

function Chevron() {
  return <View accessible={false} style={styles.chevron} />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  container: { width: '100%', maxWidth: 1586, alignSelf: 'center', paddingTop: Platform.OS === 'web' ? 10 : 50, paddingBottom: 22 },
  topBar: { minHeight: 60, borderBottomWidth: 1, borderBottomColor: colors.navy, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brandName: { color: colors.navy, fontSize: 14, lineHeight: 24, fontWeight: '700', flexShrink: 1 },
  brandNameWide: { fontSize: 24, lineHeight: 34 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topLink: { minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
  topLinkText: { color: colors.navy, fontSize: 12, fontWeight: '700', lineHeight: 24 },
  topLinkTextWide: { fontSize: 19, lineHeight: 28, paddingHorizontal: 4 },
  navDivider: { width: 1, height: 20, backgroundColor: colors.border },
  main: { gap: 24, marginTop: 24, width: '100%', maxWidth: 720, alignSelf: 'center' },
  mainWide: { flexDirection: 'row', gap: 24, alignItems: 'stretch', maxWidth: '100%', marginTop: 34 },
  hero: { width: '100%' },
  heroWide: { flex: 1, minWidth: 0, width: 'auto' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 },
  heroTopWide: { gap: 18, minHeight: 298, marginBottom: 22 },
  logoArea: { flex: 1.65, minWidth: 0 },
  tagline: { color: colors.navy, fontWeight: '700', fontSize: 18, lineHeight: 28, marginTop: 14 },
  taglineWide: { fontSize: 36, lineHeight: 52, marginTop: 26 },
  cat: { flex: 1, minWidth: 0, aspectRatio: 1428 / 1102 },
  catWide: { maxHeight: 288 },
  catImage: { width: '100%', height: '100%' },
  formArea: { width: '100%' },
  formAreaWide: { width: '30%', borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 34, paddingTop: 66 },
  formHeading: { color: colors.navy, fontSize: 25, lineHeight: 36, fontWeight: '700', marginBottom: 28 },
  formHeadingWide: { fontSize: 30, lineHeight: 42, marginBottom: 30 },
  fieldLabel: { color: colors.navy, fontSize: 16, lineHeight: 25, fontWeight: '700', marginBottom: 8 },
  input: { minHeight: 54, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 9, color: colors.ink, paddingHorizontal: 16, paddingVertical: 12, fontSize: 18, marginBottom: 18 },
  inputWide: { minHeight: 64, marginBottom: 28 },
  codeInput: { letterSpacing: 5, textAlign: 'center', fontWeight: '700', fontSize: 20 },
  error: { color: colors.redDark, fontSize: 14, lineHeight: 23, marginBottom: 16 },
  actionStack: { gap: 14 },
  playButton: { minHeight: 56, borderRadius: 10, shadowColor: colors.navy, shadowOffset: { width: 1, height: 3 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  playButtonWide: { minHeight: 72 },
  playButtonText: { color: colors.navy, fontSize: 22, fontWeight: '700', letterSpacing: 0 },
  playButtonTextWide: { fontSize: 26 },
  joinButton: { backgroundColor: '#FFF7E8' },
  rulesLink: { minHeight: 48, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  rulesText: { color: colors.navy, fontSize: 17, lineHeight: 26, fontWeight: '700', textDecorationLine: 'underline' },
  chevron: { width: 10, height: 10, borderTopWidth: 2, borderRightWidth: 2, borderColor: colors.navy, transform: [{ rotate: '45deg' }] },
  settingsNote: { color: colors.muted, fontSize: 12, lineHeight: 20, marginBottom: 10 },
  loadingBox: { alignItems: 'center', gap: 12, paddingVertical: 12 },
  loadingMessage: { color: colors.navy, fontSize: 14, lineHeight: 24, textAlign: 'center' },
  mobileDemo: { width: '100%', maxWidth: 720, alignSelf: 'center', marginTop: 28 },
  footer: { borderTopWidth: 1, borderTopColor: colors.navy, marginTop: 24, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  footerBrand: { color: colors.navy, fontSize: 12, fontWeight: '700', lineHeight: 20 },
  footerCopy: { color: colors.navy, fontSize: 12, lineHeight: 20 },
});

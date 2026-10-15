import React, { useEffect, useState } from 'react';
import { View, Modal, ScrollView, StyleSheet, Platform } from 'react-native';
import { Text, TextInput } from './ui/GameText';
import { PaperPanel, StationeryButton } from './ui';
import { colors } from '../theme';
import { authClient, accountUrl, discordCallbacks, consumeAccountError } from '../utils/accountAuth';
function resetToken() { try { return new URLSearchParams(globalThis.location?.search).get('token'); } catch (_) { return null; } }

export default function AccountSettings({ account }) {
  const { user, configuration, refresh } = account;
  const [token, setToken] = useState(resetToken);
  const [open, setOpen] = useState(Boolean(token));
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const failure = consumeAccountError();
    if (failure) { setError(failure); setOpen(true); }
  }, []);
  useEffect(() => {
    if (user) setName(user.name?.slice(0, 12) || '');
  }, [user?.id, user?.name]);
  async function action(work, success = '') {
    if (pending) return;
    setPending(true); setMessage(''); setError('');
    try {
      const result = await work();
      if (result?.error) throw result.error;
      setPassword(''); setMessage(success); await refresh();
    } catch (failure) {
      setError(failure.code === 'EMAIL_NOT_VERIFIED' ? '確認メールのリンクを開いてからログインしてください。' :
        failure.code === 'INVALID_EMAIL_OR_PASSWORD' ? 'メールアドレスかパスワードを確認してください。' : '手続きができませんでした。少し待って、もう一度お試しください。');
    } finally { setPending(false); }
  }
  if (Platform.OS !== 'web') return <StationeryButton variant="ghost" style={styles.trigger} disabled
    accessibilityLabel="アカウントのログインはブラウザー版で利用できます。">ログイン</StationeryButton>;
  if (!configuration) return null;
  if (!configuration.ready) return <StationeryButton variant="ghost" style={styles.trigger} disabled
    accessibilityLabel="アカウントログインは準備中です。ゲストで遊べます。">ログイン</StationeryButton>;
  const submit = () => action(async () => token ? authClient.resetPassword({ token, newPassword: password }).then(result => {
    if (!result.error) {
      const url = new URL(globalThis.location.href); url.searchParams.delete('token');
      globalThis.history.replaceState(null, '', url); setToken(null);
    }
    return result;
  }) :
    signup ? authClient.signUp.email({ name: name.trim(), email, password, callbackURL: `${accountUrl}/` }) :
      authClient.signIn.email({ email, password, rememberMe: remember }),
    signup ? '確認メールのリンクを開いてください。' : token ? 'パスワードを更新しました。ログインしてください。' : 'ログインしました。');
  return <View>
    <StationeryButton variant="ghost" style={styles.trigger} onPress={() => setOpen(true)}
      accessibilityLabel={user ? 'アカウントの設定' : 'ログイン'} accessibilityState={{ expanded: open }}>
      {user ? 'アカウント' : 'ログイン'}
    </StationeryButton>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <ScrollView style={styles.panel} keyboardShouldPersistTaps="handled">
          <PaperPanel tone="cream" style={styles.content}>
      <View style={styles.closeRow}>
        <StationeryButton variant="ghost" style={styles.trigger} onPress={() => setOpen(false)} accessibilityLabel="アカウント設定を閉じる">閉じる</StationeryButton>
      </View>
      <Text style={styles.title}>{user ? 'アカウントの名前' : signup ? 'アカウントをつくる' : token ? '新しいパスワード' : 'ログイン'}</Text>
      {user || signup ? <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={12}
        editable={!pending} placeholder="ゲームで使う名前" accessibilityLabel="アカウント名入力欄" /> : null}
      {user ? <>
        <StationeryButton disabled={pending || !name.trim()} onPress={() => action(() => authClient.updateUser({ name: name.trim() }), '名前を保存しました。')}
          accessibilityLabel="アカウントの名前を保存">保存する</StationeryButton>
        {configuration.discord ? <StationeryButton variant="neutral" disabled={pending} onPress={() => action(() => authClient.linkSocial({ provider: 'discord', ...discordCallbacks }))}>Discord を連携する</StationeryButton> : null}
        <StationeryButton variant="ghost" disabled={pending} onPress={() => action(() => authClient.signOut(), 'ログアウトしました。')}
          accessibilityLabel="ログアウトする">ログアウト</StationeryButton>
      </> : <>
        {configuration.email ? <>
          {!token ? <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" editable={!pending} placeholder="メールアドレス" accessibilityLabel="メールアドレス入力欄" /> : null}
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry maxLength={128}
            autoComplete={signup || token ? 'new-password' : 'current-password'} editable={!pending}
            placeholder="パスワード（8文字以上）" accessibilityLabel="アカウントのパスワード入力欄" />
          {!token && !signup ? <StationeryButton variant="ghost" disabled={pending} onPress={() => setRemember(!remember)}
            accessibilityRole="checkbox" accessibilityState={{ checked: remember }} accessibilityLabel="ログインを記憶する">{remember ? '☑' : '☐'} ログインを記憶する</StationeryButton> : null}
          <StationeryButton disabled={pending || password.length < 8 || (!token && !email.trim()) || (signup && !name.trim())}
            loading={pending} onPress={submit} accessibilityLabel={token ? 'パスワードを再設定する' : signup ? 'メールで登録する' : 'メールでログインする'}>
            {token ? 'パスワードを更新' : signup ? '登録して確認メールを送る' : 'ログインする'}
          </StationeryButton>
          {!token ? <>
            <StationeryButton variant="ghost" disabled={pending} onPress={() => { setSignup(!signup); setError(''); }}>{signup ? 'ログインに戻る' : 'アカウントをつくる'}</StationeryButton>
            <StationeryButton variant="ghost" disabled={pending || !email.trim()} onPress={() => action(() => authClient.sendVerificationEmail({ email, callbackURL: `${accountUrl}/` }), '確認メールを送信しました。')}>確認メールを再送する</StationeryButton>
            <StationeryButton variant="ghost" disabled={pending || !email.trim()} onPress={() => action(() => authClient.requestPasswordReset({ email, redirectTo: `${accountUrl}/` }), '登録済みのアドレスに再設定のメールを送信します。')}>パスワードを忘れた</StationeryButton>
          </> : null}
        </> : <Text style={styles.note}>メールログインは準備中です。</Text>}
        {configuration.discord ? <StationeryButton disabled={pending} onPress={() => action(() => authClient.signIn.social({ provider: 'discord', ...discordCallbacks }))}
          accessibilityLabel="Discordでログインする">Discord でログインする</StationeryButton> : <Text style={styles.note}>Discord ログインは準備中です。</Text>}
      </>}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          </PaperPanel>
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  trigger: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { width: '100%', maxWidth: 440, maxHeight: '90%', flexGrow: 0 },
  content: { gap: 10 },
  closeRow: { alignItems: 'flex-end' },
  title: { fontWeight: '700', color: colors.navy, marginBottom: 8 },
  input: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.navy, borderRadius: 8, padding: 12, marginBottom: 8 },
  note: { color: colors.ink, fontSize: 12, lineHeight: 20 }, error: { color: colors.red, marginTop: 8 },
});

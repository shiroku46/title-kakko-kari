import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { colors, radii } from '../../theme';
import { PaperPanel, StationeryButton, RoundHeader } from '../ui';
import { getCurrentUrl } from '../../hooks/useSocket';

export default function SelectingPhase({
  currentRound, totalRounds, questioner,
  synopsis, isQuestioner, isHost, knownDeclarations = [], allDeclared, socket,
}) {
  const [synopsisText, setSynopsisText] = useState('');
  const [realTitle, setRealTitle] = useState('');
  const [declared, setDeclared] = useState(null); // null | 'known' | 'unknown'
  const [submitted, setSubmitted] = useState(false);
  const [fetching, setFetching] = useState(false);

  async function handleAutoFetch() {
    setFetching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const baseUrl = getCurrentUrl() || 'https://title-kakko-kari.onrender.com';
      const res = await fetch(`${baseUrl}/api/random-work`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) {
        Alert.alert('取得失敗', data.error ?? '記事が見つかりませんでした。再試行してください。');
        return;
      }
      setSynopsisText(data.synopsis);
      setRealTitle(data.title);
    } catch (err) {
      if (err.name === 'AbortError') {
        Alert.alert('取得失敗', '時間がかかりすぎました。もう一度お試しください。');
      } else {
        Alert.alert('取得失敗', `サーバーに接続できませんでした\n(${err.message})`);
      }
    } finally {
      clearTimeout(timeout);
      setFetching(false);
    }
  }

  function handleSubmitSynopsis() {
    if (!synopsisText.trim()) return Alert.alert('エラー', 'あらすじを入力してください');
    if (!realTitle.trim()) return Alert.alert('エラー', '本物タイトルを入力してください');
    socket.emit('round:submit_synopsis', { synopsis: synopsisText.trim(), realTitle: realTitle.trim() }, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setSubmitted(true);
    });
  }

  function handleDeclareKnown() {
    socket.emit('round:declare_known', null, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setDeclared('known');
    });
  }

  function handleDeclareUnknown() {
    socket.emit('round:declare_unknown', null, (res) => {
      if (!res.ok) return Alert.alert('エラー', res.error);
      setDeclared('unknown');
    });
  }

  function handleReselect() {
    socket.emit('round:reselect', null, (res) => {
      if (!res.ok) Alert.alert('エラー', res.error);
      else setSubmitted(false);
    });
  }

  function handleStartSubmitting() {
    socket.emit('round:start_submitting', null, (res) => {
      if (!res.ok) Alert.alert('エラー', res.error);
    });
  }

  function handleSkipRound() {
    Alert.alert(
      'ラウンドをスキップ',
      '出題者が離脱したため、このラウンドをスキップして次へ進みますか？',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'スキップ', style: 'destructive', onPress: () => {
          socket.emit('game:next_round', null, (res) => {
            if (!res.ok) Alert.alert('エラー', res.error);
          });
        }},
      ]
    );
  }

  const hasKnown = knownDeclarations.length > 0;
  const canAdvance = allDeclared && !hasKnown;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <RoundHeader currentRound={currentRound} totalRounds={totalRounds} questioner={questioner} phase="作品を選択中" />

        {isQuestioner ? (
          !submitted ? (
            <PaperPanel variant="elevated">
              <Text style={styles.cardTitle}>あらすじを入力</Text>
              <Text style={styles.cardNote}>
                実在するマイナーな作品のあらすじを入力してください。本物タイトルは他のプレイヤーには見えません。
              </Text>
              <StationeryButton
                variant="secondary"
                onPress={handleAutoFetch}
                loading={fetching}
                accessibilityLabel="Wikipediaからランダム取得"
                style={styles.wikiBtn}
              >
                Wikipediaからランダム取得
              </StationeryButton>
              {(synopsisText || realTitle) ? (
                <Text style={styles.wikiNote}>取得後に自由に編集できます</Text>
              ) : null}
              <Text style={styles.fieldLabel}>あらすじ</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="ここにあらすじを入力..."
                placeholderTextColor={colors.muted}
                value={synopsisText}
                onChangeText={setSynopsisText}
                multiline
                numberOfLines={5}
                accessibilityLabel="あらすじ入力欄"
              />
              <Text style={styles.fieldLabel}>本物のタイトル（非公開）</Text>
              <TextInput
                style={styles.input}
                placeholder="本物のタイトル"
                placeholderTextColor={colors.muted}
                value={realTitle}
                onChangeText={setRealTitle}
                accessibilityLabel="本物タイトル入力欄"
              />
              <StationeryButton
                variant="primary"
                onPress={handleSubmitSynopsis}
                accessibilityLabel="あらすじを提示する"
              >
                あらすじを提示する
              </StationeryButton>
            </PaperPanel>
          ) : (
            <PaperPanel variant="elevated">
              <Text style={styles.cardTitle}>あらすじを提示しました</Text>
              <View style={styles.synopsisBox}>
                <Text style={styles.synopsisText}>{synopsisText}</Text>
              </View>

              {hasKnown && (
                <View style={styles.knownBox}>
                  <Text style={styles.knownTitle}>「知ってる！」宣言あり</Text>
                  {knownDeclarations.map((name, i) => (
                    <Text key={i} style={styles.knownName}>・{name}</Text>
                  ))}
                  <Text style={styles.knownNote}>作品を選び直してください</Text>
                </View>
              )}
              {!allDeclared && (
                <Text style={styles.cardNote}>全員の回答を待っています...</Text>
              )}
              {canAdvance && (
                <View style={styles.allOkBox}>
                  <Text style={styles.allOkNote}>全員が「知らない」と回答しました</Text>
                </View>
              )}

              <View style={styles.btnStack}>
                <StationeryButton
                  variant="secondary"
                  onPress={handleReselect}
                  accessibilityLabel="作品を選び直す"
                >
                  作品を選び直す
                </StationeryButton>
                <StationeryButton
                  variant="primary"
                  onPress={handleStartSubmitting}
                  disabled={!canAdvance}
                  accessibilityLabel="タイトル案提出フェーズへ進む"
                  style={styles.mt8}
                >
                  タイトル案提出フェーズへ →
                </StationeryButton>
              </View>
            </PaperPanel>
          )
        ) : (
          <PaperPanel>
            {!synopsis ? (
              <>
                <Text style={styles.cardTitle}>{questioner?.nickname} が作品を選んでいます</Text>
                <Text style={styles.waitingText}>しばらくお待ちください...</Text>
                {isHost && (
                  <StationeryButton
                    variant="secondary"
                    onPress={handleSkipRound}
                    accessibilityLabel="このラウンドをスキップ"
                    style={styles.mt20}
                  >
                    このラウンドをスキップ（ホスト）
                  </StationeryButton>
                )}
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>あらすじ</Text>
                <View style={styles.synopsisBox}>
                  <Text style={styles.synopsisText}>{synopsis}</Text>
                </View>
                {declared === null ? (
                  <View style={styles.declareRow}>
                    <StationeryButton
                      variant="secondary"
                      onPress={handleDeclareKnown}
                      accessibilityLabel="知ってると宣言"
                      style={styles.flex1}
                    >
                      知ってる！
                    </StationeryButton>
                    <StationeryButton
                      variant="primary"
                      onPress={handleDeclareUnknown}
                      accessibilityLabel="知らないと回答"
                      style={styles.flex1}
                    >
                      知らない
                    </StationeryButton>
                  </View>
                ) : declared === 'known' ? (
                  <View style={styles.declaredBox}>
                    <Text style={styles.declaredKnownText}>「知ってる！」と宣言しました</Text>
                    <Text style={styles.declaredNote}>出題者が作品を選び直します</Text>
                  </View>
                ) : (
                  <View style={styles.declaredBox}>
                    <Text style={styles.declaredText}>「知らない」と回答しました</Text>
                    <Text style={styles.declaredNote}>全員の回答が揃うのを待っています...</Text>
                  </View>
                )}
              </>
            )}
          </PaperPanel>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, paddingBottom: 40 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  cardNote: { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 6 },
  input: {
    backgroundColor: colors.canvas,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 16,
  },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  synopsisBox: {
    backgroundColor: colors.canvas,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  synopsisText: { fontSize: 15, color: colors.ink, lineHeight: 24 },
  wikiBtn: { marginBottom: 8 },
  wikiNote: { fontSize: 11, color: colors.muted, textAlign: 'center', marginBottom: 12 },
  knownBox: {
    backgroundColor: '#FBF5E6',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.mustard,
    padding: 14,
    marginBottom: 14,
  },
  knownTitle: { fontSize: 13, fontWeight: '700', color: colors.mustard, marginBottom: 6 },
  knownName: { fontSize: 14, color: colors.ink, marginBottom: 2 },
  knownNote: { fontSize: 12, color: colors.mustard, marginTop: 6 },
  allOkBox: {
    backgroundColor: '#EFF6F2',
    borderRadius: radii.md,
    padding: 10,
    marginBottom: 12,
  },
  allOkNote: { fontSize: 13, color: colors.green, fontWeight: '600', textAlign: 'center' },
  btnStack: { gap: 8 },
  mt8: { marginTop: 0 },
  mt20: { marginTop: 20 },
  declareRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  flex1: { flex: 1 },
  declaredBox: {
    borderRadius: radii.md,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declaredKnownText: { color: colors.vermilion, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  declaredText: { color: colors.navy, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  declaredNote: { fontSize: 12, color: colors.muted },
  waitingText: { color: colors.muted, textAlign: 'center', fontSize: 14, marginTop: 8 },
});

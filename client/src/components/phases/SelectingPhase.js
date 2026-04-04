import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import RoundHeader from '../RoundHeader';
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <RoundHeader currentRound={currentRound} totalRounds={totalRounds} questioner={questioner} phase="作品を選択中" />

        {isQuestioner ? (
          !submitted ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>あらすじを入力</Text>
              <Text style={styles.cardNote}>実在するマイナーな作品のあらすじを入力してください。本物タイトルは他のプレイヤーには見えません。</Text>

              {/* Wikipedia 自動取得ボタン */}
              <TouchableOpacity
                style={[styles.btnWiki, fetching && styles.btnDisabled]}
                onPress={handleAutoFetch}
                disabled={fetching}
              >
                {fetching ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.btnWikiText}>Wikipediaからランダム取得</Text>
                )}
              </TouchableOpacity>
              {(synopsisText || realTitle) && (
                <Text style={styles.wikiNote}>取得後に自由に編集できます</Text>
              )}

              <Text style={styles.fieldLabel}>あらすじ</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="ここにあらすじを入力..."
                placeholderTextColor="#C0C0C0"
                value={synopsisText}
                onChangeText={setSynopsisText}
                multiline
                numberOfLines={5}
              />
              <Text style={styles.fieldLabel}>本物のタイトル（非公開）</Text>
              <TextInput
                style={styles.input}
                placeholder="本物のタイトル"
                placeholderTextColor="#C0C0C0"
                value={realTitle}
                onChangeText={setRealTitle}
              />
              <TouchableOpacity style={styles.btnPrimary} onPress={handleSubmitSynopsis}>
                <Text style={styles.btnPrimaryText}>あらすじを提示する</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.card}>
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
                <Text style={styles.allOkNote}>全員が「知らない」と回答しました</Text>
              )}

              <TouchableOpacity style={styles.btnSecondary} onPress={handleReselect}>
                <Text style={styles.btnSecondaryText}>作品を選び直す</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { marginTop: 8 }, !canAdvance && styles.btnDisabled]}
                onPress={handleStartSubmitting}
                disabled={!canAdvance}
              >
                <Text style={styles.btnPrimaryText}>偽タイトル提出フェーズへ →</Text>
              </TouchableOpacity>
            </View>
          )
        ) : (
          <View style={styles.card}>
            {!synopsis ? (
              <>
                <Text style={styles.cardTitle}>{questioner.nickname} が作品を選んでいます</Text>
                <Text style={styles.waitingText}>しばらくお待ちください...</Text>
                {isHost && (
                  <TouchableOpacity style={[styles.btnSecondary, { marginTop: 20 }]} onPress={handleSkipRound}>
                    <Text style={styles.btnSecondaryText}>このラウンドをスキップ（ホスト）</Text>
                  </TouchableOpacity>
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
                    <TouchableOpacity style={styles.btnKnown} onPress={handleDeclareKnown}>
                      <Text style={styles.btnPrimaryText}>知ってる！</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnUnknown} onPress={handleDeclareUnknown}>
                      <Text style={styles.btnUnknownText}>知らない</Text>
                    </TouchableOpacity>
                  </View>
                ) : declared === 'known' ? (
                  <View style={styles.declaredBox}>
                    <Text style={styles.declaredKnownText}>「知ってる！」と宣言しました</Text>
                    <Text style={styles.declaredNote}>出題者が作品を選び直します</Text>
                  </View>
                ) : (
                  <View style={styles.declaredBox}>
                    <Text style={styles.declaredUnknownText}>「知らない」と回答しました</Text>
                    <Text style={styles.declaredNote}>全員の回答が揃うのを待っています...</Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  cardNote: { fontSize: 12, color: '#999', lineHeight: 18, marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#999', marginBottom: 6 },
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12,
    fontSize: 15, color: '#1A1A1A', marginBottom: 16,
  },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  synopsisBox: {
    backgroundColor: '#F5F5F5', borderRadius: 12, padding: 16, marginBottom: 16,
  },
  synopsisText: { fontSize: 15, color: '#1A1A1A', lineHeight: 24 },
  // Wikipedia 取得ボタン
  btnWiki: {
    backgroundColor: '#3D7EAA', borderRadius: 10, padding: 12,
    alignItems: 'center', marginBottom: 8,
  },
  btnWikiText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  wikiNote: { fontSize: 11, color: '#999', textAlign: 'center', marginBottom: 12 },
  btnPrimary: {
    backgroundColor: '#FF3B5C', borderRadius: 12, padding: 15, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#E0E0E0' },
  btnPrimaryText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#F5F5F5', borderRadius: 12, padding: 15, alignItems: 'center',
  },
  btnSecondaryText: { color: '#1A1A1A', fontSize: 15, fontWeight: '600' },
  declareRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  btnKnown: {
    flex: 1, backgroundColor: '#FF3B5C', borderRadius: 12,
    padding: 15, alignItems: 'center',
  },
  btnUnknown: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 12,
    padding: 15, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#E0E0E0',
  },
  btnUnknownText: { color: '#555', fontSize: 15, fontWeight: '700' },
  declaredBox: {
    borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12,
    backgroundColor: '#F5F5F5',
  },
  declaredKnownText: { color: '#FF3B5C', fontWeight: '700', fontSize: 14, marginBottom: 4 },
  declaredUnknownText: { color: '#555', fontWeight: '700', fontSize: 14, marginBottom: 4 },
  declaredNote: { fontSize: 12, color: '#999' },
  knownBox: {
    backgroundColor: '#FFF8E8', borderRadius: 12,
    padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: '#FFD966',
  },
  knownTitle: { fontSize: 13, fontWeight: '700', color: '#B8860B', marginBottom: 6 },
  knownName: { fontSize: 14, color: '#8B6914', marginBottom: 2 },
  knownNote: { fontSize: 12, color: '#B8860B', marginTop: 6 },
  allOkNote: {
    fontSize: 13, color: '#2E7D32', fontWeight: '600',
    textAlign: 'center', marginBottom: 12,
    backgroundColor: '#F1F8E9', borderRadius: 10, padding: 10,
  },
  waitingText: { color: '#BBB', textAlign: 'center', fontSize: 14, marginTop: 8 },
});

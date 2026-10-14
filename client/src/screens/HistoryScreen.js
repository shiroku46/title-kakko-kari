import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from '../components/ui/GameText';
import { PaperPanel, StationeryButton } from '../components/ui';
import { colors } from '../theme';
import { historyRequest } from '../utils/gameHistory';
import useAccount from '../hooks/useAccount';

const date = value => value ? new Date(value).toLocaleString('ja-JP') : '日時の記録なし';
const status = value => ({ finished: '終了', interrupted: '中断', playing: '進行中' }[value] || value);

export default function HistoryScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const { user } = useAccount();
  async function load(action = 'list', body = {}) {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await historyRequest(action, body);
      if (request !== generation.current) return;
      if (action === 'detail') setDetail(result);
      else {
        const page = action === 'link' ? await historyRequest('list') : result;
        if (request !== generation.current) return;
        setItems(previous => body.before ? [...previous, ...page.items] : page.items);
        setNext(page.next);
      }
    } catch (failure) { if (request === generation.current) setError(failure.message); }
    finally { if (request === generation.current) setBusy(false); }
  }
  useEffect(() => {
    setDetail(null); setItems([]); load();
    return () => { generation.current++; };
  }, [user?.id]);
  const playerName = id => detail?.players.find(player => player.id === id)?.nickname || '不明';
  return <ScrollView contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.heading}>遊んだ履歴</Text>
    <Text style={styles.note}>答え合わせ済みの問題と回答だけを表示します。ゲストの履歴はこのブラウザーで見返せます。記録を始める前に失われた試合は表示できません。</Text>
    <StationeryButton variant="ghost" onPress={() => {
      generation.current++; setBusy(false);
      if (detail) setDetail(null); else navigation.goBack();
    }}
      accessibilityLabel={detail ? '履歴一覧に戻る' : 'ホームに戻る'}>{detail ? '履歴一覧に戻る' : 'ホームに戻る'}</StationeryButton>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {detail ? <>
      <Text style={styles.title}>{date(detail.startedAt)} · {status(detail.status)}</Text>
      <Text style={styles.note}>{detail.players.map(player => `${player.nickname}${player.isComputer ? '（CPU）' : ''} ${player.score}点`).join(' / ')}</Text>
      {!detail.rounds.length ? <Text>まだ答え合わせされた問題はありません。</Text> : null}
      {detail.rounds.map(round => <PaperPanel key={round.id} tone="cream">
        <Text accessibilityRole="header" style={styles.title}>第{round.number}問 · {round.questionerId ? playerName(round.questionerId) : 'CPU出題'}</Text>
        <Text style={styles.note}>{date(round.revealedAt)}{round.workKindLabel ? ` · ${round.workKindLabel}` : ''}</Text>
        <Text style={styles.synopsis}>{round.synopsis}</Text>
        <Text style={styles.title}>正解：{round.realTitle}</Text>
        {round.answers.map(answer => <View key={answer.id} style={styles.answer}>
          <Text style={styles.body}>{answer.isReal ? '正解' : playerName(answer.playerId)}：{answer.title}{round.mvpAnswerId === answer.id ? ' ★MVP' : ''}</Text>
          <Text style={styles.note}>投票：{round.votes.filter(vote => vote.answerId === answer.id).map(vote => playerName(vote.voterId)).join('、') || 'なし'}</Text>
        </View>)}
        {round.scores.map(score => <Text key={score.playerId} style={styles.note}>{playerName(score.playerId)}：正解 {score.correct}点 / 欺き {score.deceive}点 / 合計 {score.total}点{round.answers.some(answer => answer.id === round.mvpAnswerId && answer.playerId === score.playerId) ? ' ＋MVP 1点' : ''}</Text>)}
      </PaperPanel>)}
    </> : <>
      {user ? <StationeryButton disabled={busy} onPress={() => load('link')}>この端末の履歴をアカウントに保存</StationeryButton> : null}
      <StationeryButton variant="ghost" disabled={busy} loading={busy} onPress={() => load()}>再読み込み</StationeryButton>
      {!busy && !items.length ? <Text>保存された履歴はまだありません。ログイン済みの履歴は、そのアカウントでログインすると表示されます。</Text> : null}
      {items.map(item => <PaperPanel key={item.id} tone="cream">
        <Text style={styles.title}>{date(item.startedAt)} · {status(item.status)}</Text>
        <Text style={styles.note}>{item.players.join(' / ')} · 答え合わせ {item.rounds} / {item.totalRounds}問</Text>
        <StationeryButton disabled={busy} onPress={() => load('detail', { id: item.id })} accessibilityLabel={`${date(item.startedAt)}の履歴を見る`}>問題と回答を見る</StationeryButton>
      </PaperPanel>)}
      {next ? <StationeryButton disabled={busy} onPress={() => load('list', { before: next })}>さらに表示</StationeryButton> : null}
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 20, paddingTop: 48, paddingBottom: 50, gap: 16 },
  heading: { color: colors.navy, fontSize: 28, fontWeight: '700' },
  title: { color: colors.navy, fontSize: 18, lineHeight: 28, fontWeight: '700', marginBottom: 8 },
  note: { color: colors.ink, fontSize: 14, lineHeight: 23, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 26, flexShrink: 1 },
  synopsis: { color: colors.ink, fontSize: 17, lineHeight: 30, marginVertical: 12 },
  answer: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12 },
  error: { color: colors.red },
});

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from './ui/GameText';
import { StationeryButton } from './ui';
import { colors } from '../theme';

export default function RoundProgress({ phase, deadlineAt, ready, consent, canAdvance, socket }) {
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!deadlineAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadlineAt]);
  if (!['submitting', 'voting'].includes(phase) || !deadlineAt && !consent) return null;
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const advance = () => {
    if (pending) return;
    setPending(true);
    socket.timeout(10000).emit('round:advance_phase', null, (failure, result) => {
      setPending(false);
      setError(failure || !result?.ok ? result?.error || '進められませんでした。もう一度お試しください。' : null);
    });
  };
  return <View style={{ padding: 12, backgroundColor: colors.cream, gap: 8 }}>
    <Text>{deadlineAt ? `残り ${seconds} 秒` : '時間制限なし'}</Text>
    {consent ? <Text accessibilityLiveRegion="polite">{ready ? '出題者の同意を待っています。' : '回答が揃うか、制限時間が終わるまで待っています。'}</Text> : null}
    {canAdvance && consent ? <StationeryButton disabled={!ready || pending} loading={pending} onPress={advance}
      accessibilityLabel="この段階を進める">{phase === 'submitting' ? '投票へ進める' : '正解を発表する'}</StationeryButton> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}

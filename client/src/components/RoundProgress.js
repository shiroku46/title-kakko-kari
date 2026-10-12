import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './ui/GameText';
import { StationeryButton } from './ui';
import { colors } from '../theme';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

export default function RoundProgress({ roundId, phase, deadlineAt, ready, consent, canAdvance, socket }) {
  const { isMobile } = useResponsiveLayout();
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(null);
  const timed = phase === 'submitting' && Boolean(deadlineAt) && !ready;
  useEffect(() => {
    setNotice(null);
    if (!timed) return;
    let previous = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    if (!previous) return;
    const timer = setInterval(() => {
      const time = Date.now();
      const remaining = Math.max(0, Math.ceil((deadlineAt - time) / 1000));
      setNow(time);
      const milestone = remaining <= 30 ? 30 : Math.ceil(remaining / 60) * 60;
      if (remaining > 10 && previous > milestone && remaining <= milestone) {
        setNotice({ text: milestone === 30 ? '残り30秒です。まもなく締め切ります。' : `残り${milestone / 60}分です。`, at: time });
      }
      previous = Math.min(previous, remaining);
      if (!remaining) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, timed]);
  if (!['submitting', 'voting'].includes(phase) || !(phase === 'submitting' && deadlineAt) && !consent) return null;
  const seconds = deadlineAt ? Math.max(0, Math.ceil((deadlineAt - now) / 1000)) : 0;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const urgent = timed && seconds <= 10;
  const warning = timed && seconds <= 30;
  const noticeText = urgent
    ? seconds ? `あと${seconds}秒で締め切りです。` : '時間になりました。次の段階を待っています。'
    : timed && notice && now - notice.at < 5000 ? notice.text : '';
  const advance = () => {
    if (pending || !socket?.connected) return;
    setPending(true);
    socket.timeout(10000).emit('round:advance_phase', { roundId }, (failure, result) => {
      setPending(false);
      setError(failure || !result?.ok ? result?.error || '進められませんでした。もう一度お試しください。' : null);
    });
  };
  return <View style={[styles.panel, warning && styles.warning, urgent && styles.urgent]}>
    <View style={styles.content}>
      {phase === 'submitting' ? <View style={styles.timerRow}>
        <Text style={[styles.label, warning && !urgent && styles.darkText]}>回答の残り時間</Text>
        <Text style={[styles.time, isMobile && styles.timeMobile, (!deadlineAt || ready) && styles.status,
          warning && !urgent && styles.darkText, urgent && (isMobile ? styles.countdownMobile : styles.countdown)]}
          accessibilityLabel={ready ? '受付終了' : deadlineAt ? `残り${Math.floor(seconds / 60)}分${seconds % 60}秒` : '時間制限なし'}>
          {ready ? '受付終了' : deadlineAt ? clock : '時間制限なし'}
        </Text>
      </View> : null}
      {timed ? <Text style={[styles.notice, warning && !urgent && styles.darkText]}
        accessibilityLiveRegion="polite" aria-atomic={true}>{noticeText || ' '}</Text> : null}
      {consent ? <Text style={[styles.message, warning && !urgent && styles.darkText]} accessibilityLiveRegion="polite">
        {ready ? '出題者の同意を待っています。'
          : `${phase === 'submitting' ? '回答' : '投票'}が揃う${phase === 'submitting' && deadlineAt ? 'か、制限時間が終わる' : ''}まで待っています。`}
      </Text> : null}
      {canAdvance && consent ? <StationeryButton disabled={!ready || pending} loading={pending} onPress={advance}
        accessibilityLabel="この段階を進める">{phase === 'submitting' ? '投票へ進める' : '正解を発表する'}</StationeryButton> : null}
      {error ? <Text style={[styles.message, warning && !urgent && styles.darkText]} accessibilityRole="alert">{error}</Text> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.navy },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', gap: 4 },
  timerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, minHeight: 64 },
  label: { color: colors.white, fontSize: 14, fontWeight: '700' },
  time: { color: colors.white, fontSize: 48, lineHeight: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  timeMobile: { fontSize: 42 },
  countdown: { fontSize: 56 },
  countdownMobile: { fontSize: 48 },
  status: { fontSize: 18 },
  notice: { color: colors.white, fontSize: 14, lineHeight: 22, fontWeight: '700', minHeight: 22, textAlign: 'center' },
  message: { color: colors.white, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  warning: { backgroundColor: colors.yellow },
  urgent: { backgroundColor: colors.red },
  darkText: { color: colors.navy },
});

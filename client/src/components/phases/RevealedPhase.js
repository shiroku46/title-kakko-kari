import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
  Linking,
} from 'react-native';
import { Text } from '../ui/GameText';
import { colors, radii } from '../../theme';
import {
  PaperPanel,
  StationeryButton,
  RoundHeader,
  VoteOption,
  ScoreRow,
  Stamp,
  PopBackdrop,
} from '../ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../../hooks/useResponsiveLayout';

function getHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function sourceDetails(source) {
  const details = [];
  if (source.revisionId != null) details.push(`版：${source.revisionId}`);
  if (typeof source.retrievedAt === 'string') {
    const date = new Date(source.retrievedAt);
    if (!Number.isNaN(date.getTime())) {
      details.push(`確認日：${date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    }
  }
  return details.join(' ・ ');
}

export default function RevealedPhase({
  currentRound,
  totalRounds,
  revealData,
  contentType = 'synopsis',
  isQuestioner,
  isHost,
  playerId,
  mvpData,
  socket,
}) {
  const [mvpSubmitted, setMvpSubmitted] = useState(false);
  const [selectedMvpId, setSelectedMvpId] = useState(null);
  const [sourceLinkError, setSourceLinkError] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const pendingRef = useRef(false);
  const { isPC, contentPadding } = useResponsiveLayout();

  if (!revealData) return null;

  const { realTitle, workKindLabel, answers, votes, roundScores, playerScores, sources: revealedSources } = revealData;
  const hasWorkKindLabel = typeof workKindLabel === 'string' && Boolean(workKindLabel.trim());
  const sources = Array.isArray(revealedSources)
    ? revealedSources.filter((source) => source && getHttpsUrl(source.url))
    : [];
  const fakeAnswers = answers.filter((answer) => !answer.isReal);
  const voteMap = {};

  votes.forEach(({ answerId, voterId }) => {
    if (!voteMap[answerId]) voteMap[answerId] = [];
    voteMap[answerId].push(voterId);
  });

  const myScore = roundScores?.find((score) => score.player_id === playerId);
  const canAdvance = isQuestioner || isHost;

  async function handleOpenSource(value) {
    const url = getHttpsUrl(value);
    if (!url) return;
    setSourceLinkError(null);
    try {
      await Linking.openURL(url);
    } catch (_) {
      setSourceLinkError('リンクを開けませんでした。もう一度お試しください。');
    }
  }

  function handleSubmitMvp() {
    if (!selectedMvpId || mvpSubmitted) return;
    requestAction('round:submit_mvp', { answerId: selectedMvpId }, () => setMvpSubmitted(true));
  }

  function requestAction(event, payload, onSuccess) {
    if (pendingRef.current) return;
    if (!socket?.connected) return setRequestError('接続が切れています。接続を確認してください。');
    pendingRef.current = true;
    setPendingAction(event);
    setRequestError(null);
    socket.timeout(10000).emit(event, payload, (error, res) => {
      pendingRef.current = false;
      setPendingAction(null);
      if (error) return setRequestError('返事がありません。接続を確認して、もう一度お試しください。');
      if (!res?.ok) return setRequestError(res?.error || '操作できませんでした。もう一度お試しください。');
      onSuccess?.();
    });
  }

  const answerResults = (
    <PaperPanel tone="white" variant="elevated" style={styles.answerPanel}>
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={styles.kicker}>ALL TITLES</Text>
          <Text style={styles.sectionTitle}>みんなのタイトル案</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeNumber}>{answers.length}</Text>
          <Text style={styles.totalBadgeLabel}>候補</Text>
        </View>
      </View>

      {answers.map((answer, index) => {
        const voteCount = (voteMap[answer.id] ?? []).length;
        const isOwnAnswer = !isQuestioner && !answer.isReal && Boolean(playerId)
          && answer.author?.id === playerId;
        return (
          <View
            key={answer.id}
            style={[
              styles.answerRow,
              answer.isReal && styles.answerRowReal,
              isOwnAnswer && styles.answerRowOwn,
            ]}
          >
            <View style={[styles.answerRank, answer.isReal && styles.answerRankReal]}>
              <Text style={[
                styles.answerRankText,
                answer.isReal && styles.answerRankTextReal,
              ]}>
                {index + 1}
              </Text>
            </View>
            <View style={styles.answerBody}>
              {isOwnAnswer && (
                <Text
                  testID="own-title-marker"
                  accessibilityLabel="あなたが考えたタイトル"
                  style={styles.ownTitleBadge}
                >
                  あなたのタイトル
                </Text>
              )}
              <Text
                style={[
                  styles.answerTitle,
                  answer.isReal && styles.answerTitleReal,
                ]}
                numberOfLines={3}
              >
                {answer.title}
              </Text>
              <Text style={styles.answerAuthor}>
                {answer.isReal ? '本物のタイトル' : `作：${answer.author?.nickname ?? '？'}`}
              </Text>
            </View>
            <View style={[
              styles.voteCount,
              answer.isReal && styles.voteCountReal,
            ]}>
              <Text style={[
                styles.voteCountNumber,
                answer.isReal && styles.voteCountNumberReal,
              ]}>
                {voteCount}
              </Text>
              <Text style={[
                styles.voteCountLabel,
                answer.isReal && styles.voteCountLabelReal,
              ]}>
                票
              </Text>
            </View>
          </View>
        );
      })}
    </PaperPanel>
  );

  const mvpPanel = isQuestioner && !mvpData ? (
    <PaperPanel tone="yellow" style={styles.mvpPanel}>
      <View style={styles.mvpHeadingRow}>
        <View style={styles.mvpIcon}>
          <Text style={styles.mvpIconText}>★</Text>
        </View>
        <View style={styles.mvpHeadingBody}>
          <Text style={styles.mvpKicker}>QUESTIONER'S PICK</Text>
          <Text style={styles.mvpTitle}>今回のMVPを選ぶ</Text>
          <Text style={styles.mvpNote}>いちばん好きな偽タイトルへ +1pt</Text>
        </View>
      </View>

      {fakeAnswers.map((answer) => (
        <VoteOption
          key={answer.id}
          choice={answer}
          selected={selectedMvpId === answer.id}
          disabled={mvpSubmitted || Boolean(pendingAction)}
          onPress={() => !mvpSubmitted && !pendingRef.current && setSelectedMvpId(answer.id)}
        />
      ))}

      {!mvpSubmitted ? (
        <StationeryButton
          variant="primary"
          onPress={handleSubmitMvp}
          disabled={!selectedMvpId || Boolean(pendingAction)}
          loading={pendingAction === 'round:submit_mvp'}
          accessibilityLabel="MVPを贈る"
        >
          このタイトルにMVPを贈る
        </StationeryButton>
      ) : (
        <View style={styles.mvpSent}>
          <Text style={styles.mvpSentText}>MVPを贈りました！</Text>
        </View>
      )}
    </PaperPanel>
  ) : null;

  const mvpResult = mvpData ? (
    <PaperPanel tone="yellow" variant="elevated" style={styles.mvpResultPanel}>
      <View style={styles.mvpResultTop}>
        <Stamp type="MVP" size="md" animate />
        <Text style={styles.mvpResultLabel}>今回のベストタイトル</Text>
      </View>
      <Text style={styles.mvpResultTitle}>「{mvpData.answerTitle}」</Text>
      <Text style={styles.mvpResultAuthor}>
        {mvpData.playerNickname}さんに +1pt
      </Text>
    </PaperPanel>
  ) : null;

  const scoreColumn = (
    <View style={styles.scoreColumn}>
      {myScore && (
        <PaperPanel tone="sky" style={styles.myScorePanel}>
          <Text style={styles.scoreKicker}>YOUR SCORE</Text>
          <Text style={styles.myScoreTitle}>このラウンドの得点</Text>
          <View style={styles.myScoreValueRow}>
            <Text style={styles.myScorePlus}>+</Text>
            <Text style={styles.myScoreValue}>{myScore.total_pts}</Text>
            <Text style={styles.myScoreUnit}>pt</Text>
          </View>
          <View style={styles.breakdownRow}>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownValue}>{myScore.correct_pts}</Text>
              <Text style={styles.breakdownLabel}>正解</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownValue}>{myScore.deceive_pts}</Text>
              <Text style={styles.breakdownLabel}>欺き</Text>
            </View>
          </View>
        </PaperPanel>
      )}

      <PaperPanel tone="cream" style={styles.scoreboardPanel}>
        <Text style={styles.scoreKicker}>SCORE BOARD</Text>
        <Text style={styles.scoreboardTitle}>現在の順位</Text>
        <View style={styles.scoreList}>
          {playerScores.map((score, index) => (
            <ScoreRow
              key={score.id}
              rank={index + 1}
              nickname={score.nickname}
              score={score.score}
              isMe={score.id === playerId}
              isWinner={index === 0}
            />
          ))}
        </View>
      </PaperPanel>

      {canAdvance ? (
        <StationeryButton
          variant="primary"
          onPress={() => requestAction('game:next_round', null)}
          loading={pendingAction === 'game:next_round'}
          disabled={Boolean(pendingAction)}
          accessibilityLabel={currentRound >= totalRounds ? 'ゲームを終了する' : '次のラウンドへ'}
        >
          {currentRound >= totalRounds ? '最終結果を見る →' : '次のラウンドへ →'}
        </StationeryButton>
      ) : (
        <PaperPanel tone="navy" style={styles.waitAdvancePanel}>
          <Text style={styles.waitAdvanceText}>
            出題者またはホストが次へ進めます。
          </Text>
        </PaperPanel>
      )}
    </View>
  );

  return (
    <PopBackdrop>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
        ]}
      >
        <RoundHeader
          currentRound={currentRound}
          totalRounds={totalRounds}
          questioner={null}
          phase="正解発表"
        />
        {requestError ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.requestError}>
            {requestError}
          </Text>
        ) : null}

        <View style={styles.realTitlePanel}>
          <View style={styles.confettiRow}>
            <View style={[styles.confetti, { backgroundColor: colors.yellow, transform: [{ rotate: '20deg' }] }]} />
            <View style={[styles.confetti, { backgroundColor: colors.cyan, transform: [{ rotate: '-20deg' }] }]} />
            <View style={[styles.confetti, { backgroundColor: colors.pink, transform: [{ rotate: '30deg' }] }]} />
          </View>
          <Text style={styles.realKicker}>THE REAL TITLE IS...</Text>
          {hasWorkKindLabel ? (
            <Text
              testID="revealed-work-kind"
              accessibilityLabel={`作品のジャンル：${workKindLabel}`}
              style={styles.realWorkKind}
            >
              {workKindLabel}
            </Text>
          ) : null}
          <Text style={[styles.realTitle, !isPC && styles.realTitleMobile]}>{realTitle}</Text>
          <Stamp type="正解" size="lg" animate style={isPC ? styles.realStamp : styles.realStampMobile} />
        </View>

        {sources.length > 0 ? (
          <PaperPanel tone="cream" variant="elevated" style={styles.sourcePanel}>
            <Text style={styles.kicker}>SOURCE</Text>
            <Text style={styles.sourceHeading}>出典・作品紹介</Text>
            <Text style={styles.sourceNote}>
              {contentType === 'description' ? '作品の紹介文' : '作品のあらすじ'}は、資料の文章を抜粋・短縮し、題名を伏せて作成しています。
            </Text>
            {sources.map((source, index) => {
              const label = source.label || '作品紹介';
              const licenseUrl = getHttpsUrl(source.licenseUrl);
              const details = sourceDetails(source);
              return (
                <View key={`${source.url}-${index}`} style={styles.sourceItem}>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`出典を開く：${label}`}
                    onPress={() => handleOpenSource(source.url)}
                    style={styles.sourceLink}
                  >
                    <Text style={styles.sourceLinkText}>{label} ↗</Text>
                  </Pressable>
                  {source.license ? (
                    licenseUrl ? (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`ライセンスを確認：${source.license}`}
                        onPress={() => handleOpenSource(licenseUrl)}
                        style={styles.licenseLink}
                      >
                        <Text style={styles.licenseLinkText}>ライセンス：{source.license} ↗</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.sourceMetadata}>
                        {source.provider === 'aozora' ? '著作権情報' : 'ライセンス'}：{source.license}
                      </Text>
                    )
                  ) : null}
                  {details ? <Text style={styles.sourceMetadata}>{details}</Text> : null}
                </View>
              );
            })}
            {sourceLinkError ? (
              <Text accessibilityRole="alert" style={styles.sourceError}>{sourceLinkError}</Text>
            ) : null}
          </PaperPanel>
        ) : null}

        <View style={[styles.layout, isPC && styles.layoutPC]}>
          <View style={[styles.mainColumn, isPC && styles.mainColumnPC]}>
            {answerResults}
            {mvpPanel}
            {mvpResult}
          </View>
          <View style={[styles.sideColumn, isPC && styles.sideColumnPC]}>{scoreColumn}</View>
        </View>
      </ScrollView>
    </PopBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 22 : 54,
    paddingBottom: 40,
  },
  requestError: { color: colors.redDark, backgroundColor: colors.cream, padding: 14, borderRadius: radii.md, fontSize: 14, lineHeight: 22, marginBottom: 14 },
  realTitlePanel: {
    backgroundColor: colors.navy,
    borderRadius: radii.xl,
    borderWidth: 3,
    borderColor: colors.navyDeep,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 16,
  },
  confettiRow: {
    position: 'absolute',
    top: 18,
    left: 18,
    flexDirection: 'row',
    gap: 8,
  },
  confetti: { width: 18, height: 7, borderRadius: 4 },
  realKicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  realWorkKind: { color: '#C2D5E4', fontSize: 11, lineHeight: 18, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  realTitle: {
    color: colors.white,
    fontSize: 29,
    lineHeight: 40,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 60,
  },
  realTitleMobile: { width: '100%', paddingHorizontal: 0, flexShrink: 1 },
  realStamp: { position: 'absolute', right: 18, bottom: 16 },
  realStampMobile: { alignSelf: 'flex-end', marginTop: 14 },
  sourcePanel: { marginBottom: 16 },
  sourceHeading: { color: colors.navy, fontSize: 18, fontWeight: '900', marginTop: 3 },
  sourceNote: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 6, marginBottom: 8 },
  sourceItem: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 },
  sourceLink: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  sourceLinkText: { color: colors.navy, fontSize: 15, lineHeight: 23, fontWeight: '800', textDecorationLine: 'underline' },
  licenseLink: { minHeight: 44, justifyContent: 'center', paddingVertical: 6 },
  licenseLinkText: { color: colors.ink, fontSize: 12, lineHeight: 19, textDecorationLine: 'underline' },
  sourceMetadata: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 2 },
  sourceError: { color: colors.red, fontSize: 13, lineHeight: 20, marginTop: 8 },
  layout: { gap: 14 },
  layoutPC: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  mainColumn: { gap: 14 },
  mainColumnPC: { flex: 1.6 },
  sideColumn: {},
  sideColumnPC: { flex: 0.8 },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 13,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    marginBottom: 14,
  },
  kicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  sectionTitle: { color: colors.navy, fontSize: 21, fontWeight: '900', marginTop: 3 },
  totalBadge: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.cyan,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalBadgeNumber: { color: colors.navy, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  totalBadgeLabel: { color: colors.navy, fontSize: 9, fontWeight: '900' },
  answerPanel: {},
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 66,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: '#F7FAFB',
    padding: 10,
    marginBottom: 9,
    gap: 10,
  },
  answerRowReal: {
    borderColor: colors.red,
    backgroundColor: '#FFF0F4',
  },
  answerRowOwn: {
    borderColor: colors.navy,
    backgroundColor: colors.sky,
  },
  answerRank: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerRankReal: { backgroundColor: colors.red },
  answerRankText: { color: colors.white, fontSize: 14, fontWeight: '900' },
  answerRankTextReal: { color: colors.white },
  answerBody: { flex: 1, minWidth: 0 },
  ownTitleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.cyan,
    color: colors.navy,
    borderRadius: radii.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 4,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '900',
  },
  answerTitle: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '800' },
  answerTitleReal: { color: colors.red, fontWeight: '900' },
  answerAuthor: { color: colors.muted, fontSize: 10, marginTop: 3 },
  voteCount: {
    minWidth: 50,
    alignItems: 'center',
    borderRadius: radii.md,
    backgroundColor: '#E7EEF2',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  voteCountReal: { backgroundColor: colors.yellow },
  voteCountNumber: { color: colors.navy, fontSize: 18, fontWeight: '900', lineHeight: 19 },
  voteCountNumberReal: { color: colors.red },
  voteCountLabel: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  voteCountLabelReal: { color: colors.navy },
  mvpPanel: {},
  mvpHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  mvpIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mvpIconText: { color: colors.white, fontSize: 22, fontWeight: '900' },
  mvpHeadingBody: { flex: 1 },
  mvpKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  mvpTitle: { color: colors.navy, fontSize: 19, fontWeight: '900', marginTop: 2 },
  mvpNote: { color: colors.ink, fontSize: 11, marginTop: 3 },
  mvpSent: {
    backgroundColor: '#E2F6E8',
    borderWidth: 2,
    borderColor: colors.green,
    borderRadius: radii.md,
    padding: 12,
    alignItems: 'center',
  },
  mvpSentText: { color: colors.navy, fontSize: 14, fontWeight: '900' },
  mvpResultPanel: {},
  mvpResultTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mvpResultLabel: { color: colors.navy, fontSize: 13, fontWeight: '900' },
  mvpResultTitle: { color: colors.navy, fontSize: 21, lineHeight: 29, fontWeight: '900', marginTop: 12 },
  mvpResultAuthor: { color: colors.red, fontSize: 12, fontWeight: '800', marginTop: 5 },
  scoreColumn: { gap: 14 },
  myScorePanel: {},
  scoreKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  myScoreTitle: { color: colors.navy, fontSize: 17, fontWeight: '900', marginTop: 3 },
  myScoreValueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginTop: 12 },
  myScorePlus: { color: colors.red, fontSize: 24, fontWeight: '900' },
  myScoreValue: { color: colors.red, fontSize: 52, lineHeight: 58, fontWeight: '900' },
  myScoreUnit: { color: colors.navy, fontSize: 14, fontWeight: '900', marginLeft: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  breakdownItem: { alignItems: 'center', paddingHorizontal: 22 },
  breakdownValue: { color: colors.navy, fontSize: 21, fontWeight: '900' },
  breakdownLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  breakdownDivider: { width: 2, backgroundColor: colors.border },
  scoreboardPanel: {},
  scoreboardTitle: { color: colors.navy, fontSize: 18, fontWeight: '900', marginTop: 3, marginBottom: 12 },
  scoreList: {},
  waitAdvancePanel: { alignItems: 'center' },
  waitAdvanceText: { color: colors.white, fontSize: 12, fontWeight: '800', textAlign: 'center' },
});

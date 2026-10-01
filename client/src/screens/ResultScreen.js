import { fontFamilies } from '../theme/typography';
import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { Text } from '../components/ui/GameText';
import { disconnectSocket } from '../hooks/useSocket';
import { colors, radii } from '../theme';
import {
  PaperPanel,
  StationeryButton,
  ScoreRow,
  GameLogo,
  PopBackdrop,
} from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

export default function ResultScreen({ navigation, route }) {
  const { finalScores, winner } = route.params;
  const { isPC, contentPadding } = useResponsiveLayout();

  const playAgain = () => {
    disconnectSocket();
    navigation.replace('Home');
  };

  return (
    <PopBackdrop>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: contentPadding, maxWidth: CONTENT_MAX_WIDTH },
        ]}
      >
        <View style={styles.topBar}>
          <GameLogo compact />
          <Text style={styles.topBarCopy}>おつかれさまでした！</Text>
        </View>

        <View style={[styles.layout, isPC && styles.layoutPC]}>
          <View style={styles.heroColumn}>
            <View style={styles.resultTitleBlock}>
              <Text style={styles.kicker}>FINAL RESULT</Text>
              <Text style={styles.pageTitle}>最終結果</Text>
              <Text style={styles.pageLead}>
                たくさんのタイトルが生まれました。
                {'\n'}今回のトップは…
              </Text>
            </View>

            <View style={styles.winnerPanel}>
              <View style={styles.crownBadge}>
                <Text style={styles.crownText}>★</Text>
              </View>
              <Text style={styles.winnerRank}>1位</Text>
              <Text style={styles.winnerName}>{winner?.nickname}</Text>
              <View style={styles.winnerScoreRow}>
                <Text style={styles.winnerScore}>{winner?.score}</Text>
                <Text style={styles.winnerUnit}>pt</Text>
              </View>
              <Text style={styles.winnerMessage}>発想の豊かさが光りました！</Text>
            </View>

            <PaperPanel tone="yellow" style={styles.bestTitlePanel}>
              <Text style={styles.bestTitleKicker}>TODAY'S BEST TITLE</Text>
              <Text style={styles.bestTitleHeading}>今日のベストタイトル</Text>
              <Text style={styles.bestTitleBody}>
                みんなが考えたタイトルを振り返って、いちばん好きな一案を語り合ってみましょう。
              </Text>
            </PaperPanel>
          </View>

          <View style={styles.rankColumn}>
            <PaperPanel tone="cream" variant="elevated" style={styles.rankPanel}>
              <View style={styles.rankHeadingRow}>
                <View>
                  <Text style={styles.kicker}>RANKING</Text>
                  <Text style={styles.rankHeading}>最終順位</Text>
                </View>
                <View style={styles.playerBadge}>
                  <Text style={styles.playerBadgeNum}>{finalScores.length}</Text>
                  <Text style={styles.playerBadgeText}>players</Text>
                </View>
              </View>

              <View style={styles.rankList}>
                {finalScores.map((item, index) => (
                  <ScoreRow
                    key={item.id}
                    rank={index + 1}
                    nickname={item.nickname}
                    score={item.score}
                    isWinner={index === 0}
                  />
                ))}
              </View>

              <View style={styles.actions}>
                <StationeryButton
                  variant="primary"
                  onPress={playAgain}
                  accessibilityLabel="もう一度遊ぶ"
                >
                  もう一度遊ぶ →
                </StationeryButton>
                <StationeryButton
                  variant="neutral"
                  onPress={playAgain}
                  accessibilityLabel="ホームへ戻る"
                >
                  ホームへ戻る
                </StationeryButton>
              </View>
            </PaperPanel>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>言葉で、あそぶ。タイトルで、つながる。</Text>
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
    paddingTop: Platform.OS === 'web' ? 24 : 54,
    paddingBottom: 36,
  },
  topBar: {
    minHeight: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.navy,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  topBarCopy: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  layout: { gap: 16, marginTop: 18 },
  layoutPC: { flexDirection: 'row', alignItems: 'stretch', gap: 20 },
  heroColumn: { flex: 1, gap: 14 },
  rankColumn: { flex: 1.2 },
  resultTitleBlock: {
    backgroundColor: colors.navy,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    padding: 24,
  },
  kicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  pageTitle: { fontFamily: fontFamilies.display, color: colors.white, fontSize: 36, lineHeight: 44, fontWeight: '900', marginTop: 5 },
  pageLead: { color: '#BCD1E0', fontSize: 13, lineHeight: 21, marginTop: 9 },
  winnerPanel: {
    backgroundColor: colors.yellow,
    borderRadius: radii.xl,
    borderWidth: 3,
    borderColor: colors.navy,
    padding: 24,
    alignItems: 'center',
    position: 'relative',
  },
  crownBadge: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.red,
    borderWidth: 3,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  crownText: { color: colors.white, fontSize: 29, fontWeight: '900' },
  winnerRank: { color: colors.red, fontSize: 14, fontWeight: '900' },
  winnerName: { color: colors.navy, fontSize: 30, lineHeight: 38, fontWeight: '900', marginTop: 2, textAlign: 'center' },
  winnerScoreRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 7 },
  winnerScore: { color: colors.red, fontSize: 50, lineHeight: 56, fontWeight: '900' },
  winnerUnit: { color: colors.navy, fontSize: 13, fontWeight: '900', marginLeft: 5 },
  winnerMessage: { color: colors.navy, fontSize: 12, fontWeight: '800', marginTop: 4 },
  bestTitlePanel: {},
  bestTitleKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  bestTitleHeading: { color: colors.navy, fontSize: 18, fontWeight: '900', marginTop: 3 },
  bestTitleBody: { color: colors.ink, fontSize: 12, lineHeight: 19, marginTop: 6 },
  rankPanel: { height: '100%' },
  rankHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    marginBottom: 14,
  },
  rankHeading: { fontFamily: fontFamilies.display, color: colors.navy, fontSize: 24, fontWeight: '900', marginTop: 3 },
  playerBadge: {
    width: 64,
    height: 54,
    borderRadius: 17,
    backgroundColor: colors.cyan,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerBadgeNum: { color: colors.navy, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  playerBadgeText: { color: colors.navy, fontSize: 8, fontWeight: '900' },
  rankList: { flex: 1 },
  actions: { gap: 10, marginTop: 12 },
  footer: {
    marginTop: 18,
    minHeight: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.navy,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  footerText: { color: colors.yellow, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
});

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { colors, radii } from '../theme';
import {
  PaperPanel,
  StationeryButton,
  GameLogo,
  PopBackdrop,
} from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

const FLOW = [
  {
    num: '1',
    title: 'ルームを作る・参加する',
    desc: 'ホストが6桁コードを共有し、4〜6人で集まります。',
    color: colors.red,
    symbol: '+',
  },
  {
    num: '2',
    title: '出題モードを選ぶ',
    desc: 'プレイヤー出題、またはCPU出題を選択します。',
    color: colors.blue,
    symbol: '選',
  },
  {
    num: '3',
    title: 'あらすじを読む',
    desc: '作品名を伏せたあらすじから、ジャンルや雰囲気を想像します。',
    color: colors.cyan,
    symbol: '文',
  },
  {
    num: '4',
    title: '偽タイトルを考える',
    desc: '本当にありそうな、もっともらしいタイトル案を提出します。',
    color: colors.pink,
    symbol: '✎',
  },
  {
    num: '5',
    title: 'みんなで投票する',
    desc: '本物と偽物が混ざった候補から、本物だと思う1つへ投票します。',
    color: colors.yellow,
    symbol: '票',
  },
  {
    num: '6',
    title: '得点とMVPを発表',
    desc: '正解・欺き・MVPのポイントを集計し、最終順位を競います。',
    color: colors.green,
    symbol: '★',
  },
];

const SCORES = [
  ['+1pt', '正解ポイント', '本物のタイトルへ投票できた回答者'],
  ['+Npt', '欺きポイント', '自分の偽タイトルに投票された人数分'],
  ['+1pt', 'MVPボーナス', '出題者が選んだ、いちばん好きな偽タイトル'],
];

export default function RulesScreen({ navigation }) {
  const { isPC, contentPadding } = useResponsiveLayout();

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
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="戻る"
          >
            <Text style={styles.closeButtonText}>× 閉じる</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroKicker}>HOW TO PLAY</Text>
          <Text style={styles.heroTitle}>遊び方</Text>
          <Text style={styles.heroCopy}>
            あらすじを読んで、タイトルを考えて、みんなで投票。
            {'\n'}知識がなくても、言葉のセンスで遊べるクイズゲームです。
          </Text>
        </View>

        <View style={styles.sectionHeading}>
          <View style={styles.sectionMarker} />
          <Text style={styles.sectionTitle}>ゲームの流れ</Text>
        </View>

        <View style={[styles.flowGrid, isPC && styles.flowGridPC]}>
          {FLOW.map((item) => (
            <PaperPanel
              key={item.num}
              tone="white"
              style={[styles.flowCard, isPC && styles.flowCardPC]}
            >
              <View style={styles.flowTop}>
                <View style={[styles.flowNum, { backgroundColor: item.color }]}>
                  <Text style={styles.flowNumText}>{item.num}</Text>
                </View>
                <View style={[styles.flowSymbol, { backgroundColor: item.color }]}>
                  <Text style={styles.flowSymbolText}>{item.symbol}</Text>
                </View>
              </View>
              <Text style={styles.flowTitle}>{item.title}</Text>
              <Text style={styles.flowDesc}>{item.desc}</Text>
            </PaperPanel>
          ))}
        </View>

        <View style={[styles.infoLayout, isPC && styles.infoLayoutPC]}>
          <PaperPanel tone="cream" variant="elevated" style={styles.scorePanel}>
            <Text style={styles.panelKicker}>SCORING</Text>
            <Text style={styles.panelTitle}>ポイントのルール</Text>
            <View style={styles.scoreList}>
              {SCORES.map(([pts, title, desc]) => (
                <View key={title} style={styles.scoreRow}>
                  <View style={styles.scorePtsBadge}>
                    <Text style={styles.scorePts}>{pts}</Text>
                  </View>
                  <View style={styles.scoreBody}>
                    <Text style={styles.scoreTitle}>{title}</Text>
                    <Text style={styles.scoreDesc}>{desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </PaperPanel>

          <View style={styles.tipColumn}>
            <PaperPanel tone="yellow" style={styles.tipPanel}>
              <Text style={styles.tipKicker}>TIP 01</Text>
              <Text style={styles.tipTitle}>「それっぽさ」と意外性</Text>
              <Text style={styles.tipBody}>
                あらすじに出てくる言葉や雰囲気を入れると、説得力のある偽タイトルになります。
              </Text>
            </PaperPanel>
            <PaperPanel tone="sky" style={styles.tipPanel}>
              <Text style={styles.tipKicker}>TIP 02</Text>
              <Text style={styles.tipTitle}>知っている作品だったら</Text>
              <Text style={styles.tipBody}>
                「知ってる！」を選ぶと作品を変更します。全員が知らない作品で公平に遊びます。
              </Text>
            </PaperPanel>
          </View>
        </View>

        <StationeryButton
          variant="primary"
          onPress={() => navigation.goBack()}
          accessibilityLabel="ホームへ戻る"
          style={styles.backButton}
        >
          ホームへ戻る →
        </StationeryButton>
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
    paddingBottom: 40,
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
  },
  closeButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  closeButtonText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  hero: {
    marginTop: 18,
    backgroundColor: colors.navy,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.navyDeep,
    padding: 28,
  },
  heroKicker: { color: colors.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  heroTitle: { color: colors.white, fontSize: 38, lineHeight: 46, fontWeight: '900', marginTop: 5 },
  heroCopy: { color: '#BCD1E0', fontSize: 14, lineHeight: 23, marginTop: 9 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 22,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionMarker: { width: 8, height: 26, borderRadius: 4, backgroundColor: colors.red },
  sectionTitle: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  flowGrid: { gap: 11 },
  flowGridPC: { flexDirection: 'row', flexWrap: 'wrap' },
  flowCard: {},
  flowCardPC: { width: '31%', flexGrow: 1, minWidth: 260 },
  flowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flowNum: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowNumText: { color: colors.navy, fontSize: 18, fontWeight: '900' },
  flowSymbol: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.72,
  },
  flowSymbolText: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  flowTitle: { color: colors.navy, fontSize: 17, lineHeight: 24, fontWeight: '900', marginTop: 14 },
  flowDesc: { color: colors.ink, fontSize: 12, lineHeight: 19, marginTop: 6 },
  infoLayout: { gap: 13, marginTop: 16 },
  infoLayoutPC: { flexDirection: 'row', alignItems: 'stretch' },
  scorePanel: { flex: 1.3 },
  tipColumn: { flex: 0.7, gap: 13 },
  panelKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  panelTitle: { color: colors.navy, fontSize: 21, fontWeight: '900', marginTop: 3, marginBottom: 14 },
  scoreList: { gap: 9 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 10,
  },
  scorePtsBadge: {
    width: 58,
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scorePts: { color: colors.white, fontSize: 14, fontWeight: '900' },
  scoreBody: { flex: 1 },
  scoreTitle: { color: colors.navy, fontSize: 14, fontWeight: '900' },
  scoreDesc: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 2 },
  tipPanel: { flex: 1 },
  tipKicker: { color: colors.red, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  tipTitle: { color: colors.navy, fontSize: 16, fontWeight: '900', marginTop: 3 },
  tipBody: { color: colors.ink, fontSize: 12, lineHeight: 19, marginTop: 6 },
  backButton: { marginTop: 18, alignSelf: 'center', minWidth: 260 },
});

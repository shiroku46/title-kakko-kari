import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { colors, radii, spacing } from '../theme';
import { fontFamilies } from '../theme/typography';
import { PaperPanel, StationeryButton, StickyNote } from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

const SECTIONS = [
  {
    title: 'ゲームの目的',
    content: '実在するマイナーな作品のあらすじを聞いて、本物のタイトルを見抜くゲームです。\n偽タイトルで他のプレイヤーを騙し、本物を見抜いた数でポイントを競います。',
  },
  {
    title: 'プレイヤーの役割',
    items: [
      { label: '出題者', desc: '自分が選んだマイナー作品のあらすじを提示する。1ラウンドに1人が担当し、全員が1回ずつ出題する。' },
      { label: '回答者', desc: 'あらすじを読んで偽タイトルを考え、本物のタイトルを当てる。' },
    ],
  },
  {
    title: 'ラウンドの流れ',
    steps: [
      { num: '1', label: '作品を選ぶ', desc: '出題者があらすじと本物タイトルを入力して提示する。\nすでに知っている作品が出たら「知ってる！」を押す。知らない場合は「知らない」を押す。' },
      { num: '2', label: 'タイトル案を考える', desc: '回答者は全員、本物らしいタイトル案を考えて提出する。出題者には提出数だけ通知される。' },
      { num: '3', label: '投票する', desc: '本物のタイトルと偽タイトルが混ざって表示される。本物だと思うタイトルに投票する。' },
      { num: '4', label: '結果発表', desc: '正解・各プレイヤーのタイトル案・得点が全員に公開される。\n出題者は「MVP」として気に入ったタイトル案に +1pt を贈れる。' },
    ],
  },
  {
    title: 'ポイントのルール',
    scores: [
      { pts: '+1pt', label: '正解ポイント', desc: '本物のタイトルに投票できた回答者' },
      { pts: '+Npt', label: '欺きポイント', desc: '自分のタイトル案に投票された数（N人分）' },
      { pts: '+1pt', label: 'MVPボーナス', desc: '出題者から「一番好きなタイトル案」に選ばれた回答者' },
    ],
  },
  {
    title: '知ってる！宣言について',
    content: 'あらすじを見てタイトルが分かった場合は「知ってる！」を押してください。\n誰か一人でも宣言すると、出題者は作品を選び直す必要があります。\n全員が「知らない」と回答して初めてタイトル案提出フェーズへ進みます。',
  },
];

export default function RulesScreen({ navigation }) {
  const { isPC, contentPadding } = useResponsiveLayout();

  return (
    <View style={styles.root}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="戻る"
        >
          <Text style={styles.backBtnText}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ルール</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { padding: contentPadding, maxWidth: isPC ? 800 : undefined, alignSelf: isPC ? 'center' : undefined, width: '100%' }]}>
        <StickyNote color="mustard" style={styles.tipNote}>
          本物っぽく聞こえるタイトル案を作ると欺きポイントが稼げます！
        </StickyNote>

        {SECTIONS.map((section, i) => (
          <PaperPanel key={i} style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{section.title}</Text>

            {section.content && (
              <Text style={styles.bodyText}>{section.content}</Text>
            )}

            {section.items && section.items.map((item, j) => (
              <View key={j} style={styles.roleRow}>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{item.label}</Text>
                </View>
                <Text style={styles.roleDesc}>{item.desc}</Text>
              </View>
            ))}

            {section.steps && section.steps.map((step, j) => (
              <View key={j} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{step.num}</Text>
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}

            {section.scores && section.scores.map((score, j) => (
              <View key={j} style={[styles.scoreRow, j < section.scores.length - 1 && styles.scoreRowBorder]}>
                <Text style={styles.scorePts}>{score.pts}</Text>
                <View style={styles.scoreInfo}>
                  <Text style={styles.scoreLabel}>{score.label}</Text>
                  <Text style={styles.scoreDesc}>{score.desc}</Text>
                </View>
              </View>
            ))}
          </PaperPanel>
        ))}

        <StickyNote color="blue" style={styles.tipNote2}>
          あらすじに登場するキーワードを使ったタイトルは説得力が増します。あまりにも変なタイトルは逆効果かも？
        </StickyNote>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
  backBtn: {
    minWidth: 60,
    minHeight: 44,
    paddingVertical: 4,
    justifyContent: 'center',
  },
  backBtnText: { color: colors.navy, fontSize: 15, fontWeight: '600' },
  headerSpacer: { width: 60 },
  content: { gap: 12, paddingBottom: 40 },
  tipNote: { marginBottom: 4 },
  tipNote2: { marginTop: 4 },
  sectionCard: {},
  sectionTitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.navy,
    paddingLeft: 10,
  },
  bodyText: { fontSize: 14, color: colors.ink, lineHeight: 22 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 10, alignItems: 'flex-start' },
  roleBadge: {
    backgroundColor: colors.navy,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  roleBadgeText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  roleDesc: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 20 },
  stepRow: { flexDirection: 'row', gap: 14, marginBottom: 14, alignItems: 'flex-start' },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  stepBody: { flex: 1 },
  stepLabel: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 3 },
  stepDesc: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  scoreRow: { flexDirection: 'row', gap: 14, paddingVertical: 10, alignItems: 'center' },
  scoreRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  scorePts: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.vermilion,
    width: 48,
    textAlign: 'center',
  },
  scoreInfo: { flex: 1 },
  scoreLabel: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 2 },
  scoreDesc: { fontSize: 12, color: colors.muted },
});

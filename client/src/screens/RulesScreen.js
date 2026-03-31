import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';

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
      { num: '2', label: '偽タイトルを考える', desc: '回答者は全員、本物らしい偽タイトルを考えて提出する。出題者には提出数だけ通知される。' },
      { num: '3', label: '投票する', desc: '本物のタイトルと偽タイトルが混ざって表示される。本物だと思うタイトルに投票する。' },
      { num: '4', label: '結果発表', desc: '正解・各プレイヤーの偽タイトル・得点が全員に公開される。\n出題者は「MVP」として気に入った偽タイトルに +1pt を贈れる。' },
    ],
  },
  {
    title: 'ポイントのルール',
    scores: [
      { pts: '+1pt', label: '正解ポイント', desc: '本物のタイトルに投票できた回答者' },
      { pts: '+Npt', label: '欺きポイント', desc: '自分の偽タイトルに投票された数（N人分）' },
      { pts: '+1pt', label: 'MVPボーナス', desc: '出題者から「一番好きな偽タイトル」に選ばれた回答者' },
    ],
  },
  {
    title: '知ってる！宣言について',
    content: 'あらすじを見てタイトルが分かった場合は「知ってる！」を押してください。\n誰か一人でも宣言すると、出題者は作品を選び直す必要があります。\n全員が「知らない」と回答して初めて偽タイトル提出フェーズへ進みます。',
  },
];

export default function RulesScreen({ navigation }) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ルール</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map((section, i) => (
          <View key={i} style={styles.card}>
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
          </View>
        ))}

        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>攻略のヒント</Text>
          <Text style={styles.tipText}>
            {'・ '}本物っぽく聞こえる偽タイトルを作ると欺きポイントが稼げます{'\n'}
            {'・ '}あらすじに登場するキーワードを使ったタイトルは説得力が増します{'\n'}
            {'・ '}あまりにも変なタイトルは逆効果かも？
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F7F7' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1, borderBottomColor: '#EBEBEB',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  backBtn: { width: 60, paddingVertical: 4 },
  backBtnText: { color: '#FF3B5C', fontSize: 15, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: {
    fontSize: 15, fontWeight: '700', color: '#FF3B5C',
    marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#FF3B5C',
    paddingLeft: 10,
  },
  bodyText: { fontSize: 14, color: '#444', lineHeight: 22 },
  // 役割
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 10, alignItems: 'flex-start' },
  roleBadge: {
    backgroundColor: '#FF3B5C', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4, minWidth: 60, alignItems: 'center',
  },
  roleBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  roleDesc: { flex: 1, fontSize: 13, color: '#444', lineHeight: 20 },
  // ステップ
  stepRow: { flexDirection: 'row', gap: 14, marginBottom: 14, alignItems: 'flex-start' },
  stepNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FF3B5C', alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  stepBody: { flex: 1 },
  stepLabel: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', marginBottom: 3 },
  stepDesc: { fontSize: 13, color: '#666', lineHeight: 20 },
  // スコア
  scoreRow: { flexDirection: 'row', gap: 14, paddingVertical: 10, alignItems: 'center' },
  scoreRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  scorePts: {
    fontSize: 16, fontWeight: '800', color: '#FF3B5C',
    width: 48, textAlign: 'center',
  },
  scoreInfo: { flex: 1 },
  scoreLabel: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginBottom: 2 },
  scoreDesc: { fontSize: 12, color: '#888' },
  // ヒント
  tipCard: {
    backgroundColor: '#FFF8E8', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#FFD966',
  },
  tipTitle: { fontSize: 14, fontWeight: '700', color: '#B8860B', marginBottom: 8 },
  tipText: { fontSize: 13, color: '#7A6020', lineHeight: 22 },
});

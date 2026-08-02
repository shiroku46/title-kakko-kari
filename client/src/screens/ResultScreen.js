import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { disconnectSocket } from '../hooks/useSocket';
import { colors, radii, spacing } from '../theme';
import { fontFamilies } from '../theme/typography';
import { PaperPanel, StationeryButton, ScoreRow, Stamp } from '../components/ui';
import { useResponsiveLayout, CONTENT_MAX_WIDTH } from '../hooks/useResponsiveLayout';

export default function ResultScreen({ navigation, route }) {
  const { finalScores, winner } = route.params;
  const { isPC, contentPadding } = useResponsiveLayout();

  return (
    <View style={styles.root}>
      <View style={[styles.content, isPC && styles.contentPC, { maxWidth: isPC ? CONTENT_MAX_WIDTH : undefined }]}>

        {/* 優勝 */}
        <PaperPanel variant="elevated" style={styles.winnerCard}>
          <Stamp type="得" size="lg" style={styles.winnerStamp} />
          <Text style={styles.winnerLabel}>優勝</Text>
          <Text style={styles.winnerName}>{winner?.nickname}</Text>
          <Text style={styles.winnerScore}>{winner?.score} pt</Text>
        </PaperPanel>

        {/* スコア一覧 */}
        <PaperPanel style={styles.scoreListCard}>
          <Text style={styles.sectionTitle}>最終スコア</Text>
          {finalScores.map((item, index) => (
            <ScoreRow
              key={item.id}
              rank={index + 1}
              nickname={item.nickname}
              score={item.score}
              isWinner={index === 0}
            />
          ))}
        </PaperPanel>

        {/* アクション */}
        <View style={styles.actions}>
          <StationeryButton
            variant="primary"
            onPress={() => { disconnectSocket(); navigation.replace('Home'); }}
            accessibilityLabel="タイトル画面へ戻る"
          >
            タイトルへ戻る
          </StationeryButton>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 32,
    gap: 16,
  },
  contentPC: {
    paddingHorizontal: 32,
    maxWidth: 600,
    alignSelf: 'center',
  },
  winnerCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  winnerStamp: { marginBottom: 12 },
  winnerLabel: { fontSize: 12, color: colors.muted, fontWeight: '600', letterSpacing: 0.5 },
  winnerName: {
    fontFamily: fontFamilies.serif,
    fontSize: 32,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 6,
  },
  winnerScore: { fontSize: 20, color: colors.vermilion, fontWeight: '700', marginTop: 6 },
  scoreListCard: { flex: 1 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  actions: { gap: 8 },
});

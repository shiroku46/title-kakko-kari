import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './GameText';
import { colors } from '../../theme';

export default function WorkIntroduction({ synopsis, workKindLabel, realTitle }) {
  return <View style={styles.introduction}>
    <View style={styles.meta}>
      {workKindLabel ? <View testID="work-genre" style={styles.genre}>
        <Text style={styles.genreLabel}>ジャンル</Text><Text style={styles.genreValue}>{workKindLabel}</Text>
      </View> : null}
      <Text style={styles.label}>作品の紹介文</Text>
    </View>
    <Text style={styles.synopsis}>{synopsis}</Text>
    {realTitle ? <View style={styles.answer}>
      <Text style={styles.answerLabel}>本物のタイトル・出題者だけに表示</Text>
      <Text testID="questioner-real-title" style={styles.title}>{realTitle}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  introduction: { width: '100%', gap: 14 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  genre: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.sky, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  genreLabel: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  genreValue: { color: colors.navy, fontSize: 12, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  synopsis: { color: colors.ink, fontSize: 17, lineHeight: 31 },
  answer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, marginTop: 8, gap: 8, alignItems: 'center' },
  answerLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  title: { color: colors.navy, fontSize: 22, fontWeight: '800', lineHeight: 34, textAlign: 'center' },
});

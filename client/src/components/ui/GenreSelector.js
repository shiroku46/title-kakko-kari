import React from 'react';
import { View } from 'react-native';
import { Text } from './GameText';
import StationeryButton from './StationeryButton';

export default function GenreSelector({ workKind, onSelect, disabled }) {
  const selectedKind = ['short-story', 'literary-work'].includes(workKind) ? 'novel' : workKind;
  return (
    <View style={{ gap: 10, marginBottom: 16 }}>
      <Text>出題するジャンルを選んでください</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[['any', 'ノンジャンル'], ['novel', '小説'], ['film', '映画'], ['manga', '漫画'], ['game', 'ゲーム']].map(([kind, label]) => (
          <StationeryButton key={kind} variant={selectedKind === kind ? 'yellow' : 'neutral'}
            onPress={() => onSelect(kind)} disabled={disabled} accessibilityLabel={`出題ジャンルを${label}にする`}>
            {label}
          </StationeryButton>
        ))}
      </View>
      {workKind ? <Text>{selectedKind === 'any' ? 'ジャンルを限定せずに問題を検索します。' : '選んだジャンルの作品から問題を用意します。ジャンルは参加者にも表示します。'}</Text> : null}
      {selectedKind === 'novel' ? <Text>小説には短編小説・文学作品も含みます。</Text> : null}
    </View>
  );
}

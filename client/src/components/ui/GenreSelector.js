import React from 'react';
import { View } from 'react-native';
import { Text } from './GameText';
import StationeryButton from './StationeryButton';

export default function GenreSelector({ workKind, onSelect, disabled }) {
  return (
    <View style={{ gap: 10, marginBottom: 16 }}>
      <Text>出題するジャンルを選んでください</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[['novel', '小説'], ['film', '映画'], ['manga', '漫画'], ['game', 'ゲーム'],
          ['short-story', '短編小説'], ['literary-work', '文学作品']].map(([kind, label]) => (
          <StationeryButton key={kind} variant={workKind === kind ? 'yellow' : 'neutral'}
            onPress={() => onSelect(kind)} disabled={disabled} accessibilityLabel={`出題ジャンルを${label}にする`}>
            {label}
          </StationeryButton>
        ))}
      </View>
      {workKind ? <Text>選んだジャンルの作品から問題を用意します。ジャンルは参加者にも表示します。</Text> : null}
    </View>
  );
}

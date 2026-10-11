import React from 'react';
import { StationeryButton } from './ui';

export default function PlayerSettings({ player, room, navigation }) {
  return <StationeryButton variant="ghost"
    onPress={() => navigation.navigate('NameEntry', { room, player, editing: true })}
    accessibilityLabel="名前を変更する">名前を変更</StationeryButton>;
}

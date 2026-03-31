import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useSocketListeners, getSocket } from '../hooks/useSocket';

import SelectingPhase from '../components/phases/SelectingPhase';
import SubmittingPhase from '../components/phases/SubmittingPhase';
import VotingPhase from '../components/phases/VotingPhase';
import RevealedPhase from '../components/phases/RevealedPhase';

export default function GameScreen({ navigation, route }) {
  const { room, player, gameData } = route.params;
  const socket = getSocket();

  const [phase, setPhase] = useState('selecting');
  const [round, setRound] = useState(gameData.round);
  const [currentRound, setCurrentRound] = useState(gameData.currentRound);
  const [totalRounds, setTotalRounds] = useState(gameData.totalRounds);
  const [questioner, setQuestioner] = useState(gameData.questioner);

  // 各フェーズのデータ
  const [synopsis, setSynopsis] = useState(null);
  const [choices, setChoices] = useState([]);
  const [revealData, setRevealData] = useState(null);
  const [fakeSubmittedCount, setFakeSubmittedCount] = useState(0);
  const [voteProgress, setVoteProgress] = useState({ voted: 0, total: 0 });
  const [knownDeclarations, setKnownDeclarations] = useState([]);
  const [allDeclared, setAllDeclared] = useState(false);
  const [mvpData, setMvpData] = useState(null);
  const [selectingKey, setSelectingKey] = useState(0);

  const isQuestioner = player.id === questioner.id;

  useEffect(() => {
    const onDisconnect = () => {
      Alert.alert('切断', 'サーバーとの接続が切れました', [
        { text: 'タイトルへ戻る', onPress: () => navigation.replace('Home') },
      ]);
    };
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, []);

  useSocketListeners({
    'game:round_started': (data) => {
      setRound(data.round);
      setCurrentRound(data.currentRound);
      setTotalRounds(data.totalRounds);
      setQuestioner(data.questioner);
      setPhase('selecting');
      setSynopsis(null);
      setChoices([]);
      setRevealData(null);
      setFakeSubmittedCount(0);
      setVoteProgress({ voted: 0, total: 0 });
      setKnownDeclarations([]);
      setAllDeclared(false);
      setSelectingKey((k) => k + 1);
    },
    'round:synopsis_presented': (data) => {
      setSynopsis(data.synopsis);
    },
    'round:known_declared': ({ player: p }) => {
      setKnownDeclarations((prev) => [...prev, p.nickname]);
    },
    'round:unknown_declared': () => {},
    'round:all_declared': ({ knownPlayerIds }) => {
      setAllDeclared(true);
      setKnownDeclarations((prev) =>
        knownPlayerIds.length === 0 ? [] : prev
      );
    },
    'round:reselect_started': () => {
      setSynopsis(null);
      setKnownDeclarations([]);
      setAllDeclared(false);
      setSelectingKey((k) => k + 1);
    },
    'round:submitting_started': () => {
      setPhase('submitting');
    },
    'round:fake_submitted': (data) => {
      setFakeSubmittedCount(data.submittedCount);
    },
    'round:choices_presented': (data) => {
      setChoices(data.choices);
      setPhase('voting');
    },
    'round:vote_progress': (data) => {
      setVoteProgress({ voted: data.votedCount, total: data.totalCount });
    },
    'round:revealed': (data) => {
      setRevealData(data);
      setMvpData(null);
      setPhase('revealed');
    },
    'round:mvp_selected': (data) => {
      setMvpData(data);
      setRevealData((prev) => prev ? { ...prev, playerScores: data.playerScores } : prev);
    },
    'game:finished': (data) => {
      navigation.replace('Result', { finalScores: data.finalScores, winner: data.winner });
    },
    'room:player_disconnected': ({ nickname }) => {
      Alert.alert('プレイヤー退出', `${nickname} が退出しました`);
    },
    'game:questioner_disconnected': ({ nickname: qNickname, fallbackHostId, roundStatus }) => {
      // 出題者が落ちた場合の通知
      // selecting/submitting/voting 中なら、ホストが次のラウンドへ進める旨を案内
      const isMe = player.id === fallbackHostId;
      const msg = roundStatus === 'selecting'
        ? `出題者 ${qNickname} が離脱しました。\nホストがラウンドをスキップできます。`
        : `出題者 ${qNickname} が離脱しました。\n結果確認後、ホストが次のラウンドへ進めます。`;
      Alert.alert('出題者が離脱しました', msg + (isMe ? '\n\nあなたがホストです。' : ''));
    },
  });

  function renderPhase() {
    // isQuestioner は questioner.id で毎回再計算
    const amQuestioner = player.id === questioner.id;

    switch (phase) {
      case 'selecting':
        return (
          <SelectingPhase
            key={selectingKey}
            round={round}
            currentRound={currentRound}
            totalRounds={totalRounds}
            questioner={questioner}
            synopsis={synopsis}
            isQuestioner={amQuestioner}
            isHost={player.is_host}
            playerId={player.id}
            knownDeclarations={knownDeclarations}
            allDeclared={allDeclared}
            socket={socket}
          />
        );
      case 'submitting':
        return (
          <SubmittingPhase
            round={round}
            currentRound={currentRound}
            totalRounds={totalRounds}
            questioner={questioner}
            synopsis={synopsis}
            isQuestioner={amQuestioner}
            playerId={player.id}
            fakeSubmittedCount={fakeSubmittedCount}
            socket={socket}
          />
        );
      case 'voting':
        return (
          <VotingPhase
            round={round}
            currentRound={currentRound}
            totalRounds={totalRounds}
            questioner={questioner}
            synopsis={synopsis}
            choices={choices}
            isQuestioner={amQuestioner}
            playerId={player.id}
            voteProgress={voteProgress}
            socket={socket}
          />
        );
      case 'revealed':
        return (
          <RevealedPhase
            round={round}
            currentRound={currentRound}
            totalRounds={totalRounds}
            revealData={revealData}
            isQuestioner={amQuestioner}
            isHost={player.is_host}
            playerId={player.id}
            mvpData={mvpData}
            socket={socket}
          />
        );
      default:
        return null;
    }
  }

  return <View style={styles.container}>{renderPhase()}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
});

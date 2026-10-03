import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSocketListeners, getSocket, disconnectSocket } from '../hooks/useSocket';
import { colors } from '../theme';
import { Text } from '../components/ui/GameText';
import { StationeryButton } from '../components/ui';
import { Alert } from '../utils/alert';

import ConfirmingPhase from '../components/phases/ConfirmingPhase';
import SelectingPhase from '../components/phases/SelectingPhase';
import SubmittingPhase from '../components/phases/SubmittingPhase';
import VotingPhase from '../components/phases/VotingPhase';
import RevealedPhase from '../components/phases/RevealedPhase';

function normalizeContentType(value) {
  return value === 'description' ? 'description' : 'synopsis';
}

export default function GameScreen({ navigation, route }) {
  const { room, player, gameData } = route.params;
  const socket = getSocket();
  const [isHost, setIsHost] = useState(player.is_host);
  const [synopsisError, setSynopsisError] = useState(null);

  const [mode, setMode] = useState(gameData.mode ?? 'player');
  const [phase, setPhase] = useState(gameData.mode === 'cpu' ? 'confirming' : 'selecting');
  const [round, setRound] = useState(gameData.round);
  const [currentRound, setCurrentRound] = useState(gameData.currentRound);
  const [totalRounds, setTotalRounds] = useState(gameData.totalRounds);
  const [questioner, setQuestioner] = useState(gameData.questioner);
  const [contentType, setContentType] = useState(normalizeContentType(gameData.round?.contentType));

  const [synopsis, setSynopsis] = useState(null);
  const [fetchedSynopsis, setFetchedSynopsis] = useState(null);
  const [choices, setChoices] = useState([]);
  const [ownAnswerId, setOwnAnswerId] = useState(null);
  const [revealData, setRevealData] = useState(null);
  const [fakeSubmittedCount, setFakeSubmittedCount] = useState(0);
  const [voteProgress, setVoteProgress] = useState({ voted: 0, total: 0 });
  const [knownDeclarations, setKnownDeclarations] = useState([]);
  const [allDeclared, setAllDeclared] = useState(false);
  const [mvpData, setMvpData] = useState(null);
  const [selectingKey, setSelectingKey] = useState(0);
  const [questionerDisconnected, setQuestionerDisconnected] = useState(false);
  const [departureNotice, setDepartureNotice] = useState(null);
  const [stoppedMessage, setStoppedMessage] = useState(null);
  const [discardedTitle, setDiscardedTitle] = useState(null);
  const leavingRef = useRef(false);

  const isQuestioner = player.id === questioner?.id;

  function leaveGame() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    disconnectSocket();
    navigation.replace('Home');
  }

  function confirmLeaveGame() {
    Alert.alert('部屋から出る', 'この部屋から出ますか？', [
      { text: '戻る', style: 'cancel' },
      { text: '部屋から出る', style: 'destructive', onPress: leaveGame },
    ]);
  }

  useEffect(() => {
    const onDisconnect = () => {
      if (leavingRef.current) return;
      // A fresh socket has no membership. Leave immediately rather than allow
      // buffered game actions to run against a different connection.
      leaveGame();
      Alert.alert('接続が切れました', 'ホームに戻りました。もう一度、部屋を作るか参加してください。');
    };
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, [navigation, socket]);

  useEffect(() => {
    let active = true;
    // A future questioner may have left during an earlier round. The existing
    // authenticated room snapshot also covers that case, without restoring an
    // old identity or exposing answers.
    socket.timeout(10000).emit('room:get_state', null, (error, response) => {
      if (!active || leavingRef.current || error || !response?.ok) return;
      setIsHost(Boolean(response.room.players.find((p) => p.id === player.id)?.is_host));
      const currentQuestioner = response.room.players.find((p) => p.id === questioner?.id);
      setQuestionerDisconnected(Boolean(questioner?.id && !currentQuestioner?.is_connected));
      if (response.room.status === 'finished' && response.room.players.filter((p) => p.is_connected).length === 1) {
        // The stop notification can arrive while navigation mounts this page.
        setStoppedMessage('ほかの人がいなくなったため、ゲームを終わります。ホームに戻って、部屋を作り直してください。');
        setDepartureNotice(null);
      }
    });
    return () => { active = false; };
  }, [round.id, questioner?.id, player.id, socket]);

  useSocketListeners({
    'game:round_started': (data) => {
      setRound(data.round);
      setCurrentRound(data.currentRound);
      setTotalRounds(data.totalRounds);
      setQuestioner(data.questioner);
      setContentType(normalizeContentType(data.round?.contentType));
      if (data.mode) setMode(data.mode);
      setPhase(data.mode === 'cpu' ? 'confirming' : 'selecting');
      setSynopsis(null);
      setFetchedSynopsis(null);
      setSynopsisError(null);
      setChoices([]);
      setOwnAnswerId(null);
      setRevealData(null);
      setFakeSubmittedCount(0);
      setVoteProgress({ voted: 0, total: 0 });
      setKnownDeclarations([]);
      setAllDeclared(false);
      setSelectingKey((k) => k + 1);
      setQuestionerDisconnected(false);
      setDepartureNotice(null);
      setStoppedMessage(null);
      setDiscardedTitle(null);
    },
    'round:synopsis_loading': (data) => {
      if (data.roundId !== round.id) return;
      setFetchedSynopsis(null);
      setContentType('synopsis');
      setSynopsisError(null);
    },
    'round:synopsis_fetch_failed': (data) => {
      if (data.roundId !== round.id) return;
      setFetchedSynopsis(null);
      setSynopsisError(data.error);
    },
    'round:synopsis_fetched': (data) => {
      if (data.roundId !== round.id) return;
      setSynopsisError(null);
      setFetchedSynopsis(data.synopsis);
      setContentType(normalizeContentType(data.contentType));
    },
    'round:synopsis_presented': (data) => {
      setSynopsis(data.synopsis);
      setContentType(normalizeContentType(data.contentType));
    },
    'round:known_declared': ({ player: p }) => {
      setKnownDeclarations((prev) => [...new Set([...prev, p.nickname])]);
    },
    'round:unknown_declared': () => {},
    'round:all_declared': ({ knownPlayerIds }) => {
      setAllDeclared(true);
      setKnownDeclarations((prev) =>
        knownPlayerIds.length === 0 ? [] : prev
      );
    },
    'round:declaration_started': ({ roundId }) => {
      if (roundId === round.id) setPhase('selecting');
    },
    'round:question_discarded': ({ roundId, realTitle }) => {
      if (roundId === round.id) setDiscardedTitle(realTitle);
    },
    'round:reselect_started': ({ mode: nextMode }) => {
      setSynopsis(null);
      setFetchedSynopsis(null);
      setSynopsisError(null);
      setContentType('synopsis');
      setKnownDeclarations([]);
      setAllDeclared(false);
      setSelectingKey((k) => k + 1);
      if (nextMode === 'cpu') setPhase('confirming');
    },
    'round:submitting_started': () => {
      if (mode === 'cpu' && fetchedSynopsis) setSynopsis(fetchedSynopsis);
      setPhase('submitting');
    },
    'round:fake_submitted': (data) => {
      setFakeSubmittedCount(data.submittedCount);
    },
    'round:choices_presented': (data) => {
      setChoices(data.choices);
      setOwnAnswerId(data.ownAnswerId ?? null);
      setPhase('voting');
    },
    'round:vote_progress': (data) => {
      setVoteProgress({ voted: data.votedCount, total: data.totalCount });
    },
    'round:revealed': (data) => {
      setRevealData(data);
      setContentType(normalizeContentType(data.contentType ?? contentType));
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
    'game:stopped': ({ message }) => {
      setStoppedMessage(message || 'ほかの人がいなくなったため、ゲームを終わります。');
      setDepartureNotice(null);
    },
    'room:player_disconnected': ({ playerId, nickname }) => {
      if (playerId === questioner?.id) setQuestionerDisconnected(true);
      setKnownDeclarations((prev) => prev.filter((name) => name !== nickname));
      socket.timeout(10000).emit('room:get_state', null, (error, res) => {
        if (!leavingRef.current && !error && res?.ok) {
          setIsHost(Boolean(res.room.players.find((p) => p.id === player.id)?.is_host));
        }
      });
      setDepartureNotice(`${nickname}さんが部屋から出ました。`);
    },
    'game:questioner_disconnected': ({ nickname: qNickname, fallbackHostId, roundStatus }) => {
      const isMe = player.id === fallbackHostId;
      const msg = roundStatus === 'selecting'
        ? `出題者 ${qNickname} が離脱しました。\nホストがラウンドをスキップできます。`
        : `出題者 ${qNickname} が離脱しました。\n結果確認後、ホストが次のラウンドへ進めます。`;
      setQuestionerDisconnected(true);
      setIsHost(isMe);
      setDepartureNotice(msg + (isMe ? '\nあなたがホストです。' : ''));
    },
  });

  useEffect(() => {
    if (mode !== 'cpu' || phase !== 'confirming' || !isHost) return;
    let active = true;
    socket.timeout(10000).emit('round:get_synopsis', { roomId: room.id, roundId: round.id }, (error, response) => {
      if (!active) return;
      if (error || !response?.ok) {
        setFetchedSynopsis(null);
        setSynopsisError(error
          ? 'サーバーから応答がありません。接続を確認して再取得してください。'
          : response?.error || '紹介文を確認できませんでした。もう一度取得してください。');
        return;
      }
      setFetchedSynopsis(response.synopsis);
      setContentType(normalizeContentType(response.contentType));
      setSynopsisError(null);
    });
    return () => { active = false; };
  }, [mode, phase, isHost, room.id, round.id, socket]);

  useEffect(() => {
    if (phase === 'submitting' && mode === 'cpu' && fetchedSynopsis && !synopsis) {
      setSynopsis(fetchedSynopsis);
    }
  }, [phase, mode, fetchedSynopsis]);

  function renderPhase() {
    const amQuestioner = player.id === questioner?.id;

    switch (phase) {
      case 'confirming':
        return (
          <ConfirmingPhase
            currentRound={currentRound}
            totalRounds={totalRounds}
            fetchedSynopsis={fetchedSynopsis}
            synopsisError={synopsisError}
            isHost={isHost}
            socket={socket}
            onRerollStart={() => {
              setFetchedSynopsis(null);
              setSynopsisError(null);
            }}
          />
        );
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
            isHost={isHost}
            isCpu={mode === 'cpu'}
            questionerDisconnected={questionerDisconnected}
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
            ownAnswerId={ownAnswerId}
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
            contentType={contentType}
            isQuestioner={amQuestioner}
            isHost={isHost}
            playerId={player.id}
            mvpData={mvpData}
            socket={socket}
          />
        );
      default:
        return null;
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.gameControls}>
        <Text style={styles.roomLabel}>部屋 {room.code}</Text>
        <StationeryButton
          variant="ghost"
          onPress={confirmLeaveGame}
          accessibilityLabel="ゲームから退出する"
          style={styles.exitButton}
        >
          部屋から出る
        </StationeryButton>
      </View>
      {stoppedMessage ? (
        <View style={styles.stoppedPanel}>
          <Text accessibilityRole="alert" style={styles.stoppedTitle}>遊ぶ人がいなくなりました</Text>
          <Text style={styles.stoppedBody}>{stoppedMessage}</Text>
          <StationeryButton
            variant="primary"
            onPress={leaveGame}
            accessibilityLabel="ホームへ戻る"
          >
            ホームへ戻る
          </StationeryButton>
        </View>
      ) : (
        <>
          {departureNotice ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.departureNotice}>
              {departureNotice}
            </Text>
          ) : null}
          {discardedTitle ? (
            <View style={styles.discardedPanel} accessibilityLiveRegion="polite">
              <Text style={styles.discardedLabel}>変更したお題の答え</Text>
              <Text style={styles.discardedTitle}>{discardedTitle}</Text>
            </View>
          ) : null}
          {renderPhase()}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  gameControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'web' ? 0 : 54, backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.border },
  roomLabel: { fontSize: 12, color: colors.muted },
  exitButton: { minHeight: 44, paddingVertical: 6 },
  departureNotice: { color: colors.navy, backgroundColor: colors.cream, paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, lineHeight: 20 },
  discardedPanel: { backgroundColor: colors.cream, paddingHorizontal: 20, paddingVertical: 12 },
  discardedLabel: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  discardedTitle: { color: colors.navy, fontSize: 18, lineHeight: 27, fontWeight: '700' },
  stoppedPanel: { width: '100%', maxWidth: 540, alignSelf: 'center', padding: 24, gap: 18 },
  stoppedTitle: { fontSize: 22, lineHeight: 30, fontWeight: '700', color: colors.navy },
  stoppedBody: { fontSize: 15, lineHeight: 25, color: colors.ink },
});

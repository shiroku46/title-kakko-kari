import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSocketListeners, getSocket, leaveRoom } from '../hooks/useSocket';
import useRoomRecovery from '../hooks/useRoomRecovery';
import PlayerSettings from '../components/PlayerSettings';
import RoundProgress from '../components/RoundProgress';
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
  const saved = gameData.resumeState || {};
  const socket = getSocket();
  const genreDisclosure = Boolean(gameData.settings?.genreDisclosure);
  const [workKindLabel, setWorkKindLabel] = useState(gameData.round?.workKindLabel || null);
  const [isHost, setIsHost] = useState(player.is_host);
  const [humanCount, setHumanCount] = useState(gameData.humanCount ?? 4);
  const [synopsisError, setSynopsisError] = useState(saved.synopsisError || null);

  const [mode, setMode] = useState(gameData.mode ?? 'player');
  const [phase, setPhase] = useState(saved.phase || (gameData.mode === 'cpu' ? 'confirming' : 'selecting'));
  const [deadlineAt, setDeadlineAt] = useState(gameData.round.deadlineAt);
  const [phaseReady, setPhaseReady] = useState(Boolean(gameData.round.phaseReady));
  const [round, setRound] = useState(gameData.round);
  const [currentRound, setCurrentRound] = useState(gameData.currentRound);
  const [totalRounds, setTotalRounds] = useState(gameData.totalRounds);
  const [questioner, setQuestioner] = useState(gameData.questioner);
  const [contentType, setContentType] = useState(normalizeContentType(gameData.round?.contentType));

  const [synopsis, setSynopsis] = useState(saved.synopsis || null);
  const [questionerView, setQuestionerView] = useState(saved.questionerView || null);
  const [fetchedSynopsis, setFetchedSynopsis] = useState(saved.fetchedSynopsis || null);
  const [choices, setChoices] = useState(saved.choices || []);
  const [ownAnswerId, setOwnAnswerId] = useState(saved.ownAnswerId || null);
  const [revealData, setRevealData] = useState(saved.revealData || null);
  const [fakeSubmittedCount, setFakeSubmittedCount] = useState(saved.fakeSubmittedCount || 0);
  const [voteProgress, setVoteProgress] = useState(saved.voteProgress || { voted: 0, total: 0 });
  const [roomPlayers, setRoomPlayers] = useState(room.players);
  const [knownPlayerIds, setKnownPlayerIds] = useState(saved.knownPlayerIds ||
    room.players.filter((p) => (saved.knownDeclarations || []).includes(p.nickname)).map((p) => p.id));
  const knownDeclarations = knownPlayerIds.map((id) => roomPlayers.find((p) => p.id === id)?.nickname).filter(Boolean);
  const [allDeclared, setAllDeclared] = useState(Boolean(saved.allDeclared));
  const [mvpData, setMvpData] = useState(saved.mvpData || null);
  const [selectingKey, setSelectingKey] = useState(0);
  const [questionerDisconnected, setQuestionerDisconnected] = useState(Boolean(saved.questionerDisconnected));
  const [departureNotice, setDepartureNotice] = useState(null);
  const [stoppedMessage, setStoppedMessage] = useState(null);
  const [discardedTitle, setDiscardedTitle] = useState(null);
  const leavingRef = useRef(false);
  const reconnecting = useRoomRecovery(navigation, leavingRef);
  const resumed = round.id === gameData.round.id ? saved : {};

  const isQuestioner = player.id === questioner?.id;

  function leaveGame() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    leaveRoom();
    navigation.replace('Home');
  }

  function confirmLeaveGame() {
    Alert.alert('部屋から出る', 'この部屋から出ますか？', [
      { text: '戻る', style: 'cancel' },
      { text: '部屋から出る', style: 'destructive', onPress: leaveGame },
    ]);
  }

  useEffect(() => {
    let active = true;
    // A future questioner may have left during an earlier round. The existing
    // authenticated room snapshot also covers that case, without restoring an
    // old identity or exposing answers.
    socket.timeout(10000).emit('room:get_state', null, (error, response) => {
      if (!active || leavingRef.current || error || !response?.ok) return;
      setRoomPlayers(response.room.players);
      setIsHost(Boolean(response.room.players.find((p) => p.id === player.id)?.is_host));
      setHumanCount(response.room.players.filter((p) => p.is_connected && !p.is_computer).length);
      const currentQuestioner = response.room.players.find((p) => p.id === questioner?.id);
      setQuestionerDisconnected(Boolean(questioner?.id && !currentQuestioner?.is_connected));
      if (response.room.status === 'finished' && response.room.players.filter((p) => p.is_connected && !p.is_computer).length === 1 &&
          (questioner?.id || !response.room.players.some((p) => p.is_computer))) {
        // The stop notification can arrive while navigation mounts this page.
        setStoppedMessage('ほかの人がいなくなったため、ゲームを終わります。ホームに戻って、部屋を作り直してください。');
        setDepartureNotice(null);
      }
    });
    return () => { active = false; };
  }, [round.id, questioner?.id, player.id, socket]);

  useSocketListeners({
    'room:players_updated': ({ players }) => {
      if (!players) return;
      setRoomPlayers(players);
      setQuestioner((current) => current ? { ...current, nickname: players.find((p) => p.id === current.id)?.nickname || current.nickname } : current);
      setMvpData((current) => current ? { ...current, playerNickname: players.find((p) => p.id === current.playerId)?.nickname || current.playerNickname } : current);
      setRevealData((current) => current ? { ...current,
        playerScores: current.playerScores.map((score) => ({ ...score, nickname: players.find((p) => p.id === score.id)?.nickname || score.nickname })),
        answers: current.answers.map((answer) => ({ ...answer, author: answer.author ? { ...answer.author,
          nickname: players.find((p) => p.id === answer.author.id)?.nickname || answer.author.nickname } : null })),
      } : current);
    },
    'game:round_started': (data) => {
      setRound(data.round);
      setCurrentRound(data.currentRound);
      setTotalRounds(data.totalRounds);
      setQuestioner(data.questioner);
      setHumanCount(data.humanCount ?? 4);
      setContentType(normalizeContentType(data.round?.contentType));
      if (data.mode) setMode(data.mode);
      setPhase(data.mode === 'cpu' ? 'confirming' : 'selecting');
      setSynopsis(null);
      setQuestionerView(null);
      setWorkKindLabel(null);
      setFetchedSynopsis(null);
      setSynopsisError(null);
      setChoices([]);
      setOwnAnswerId(null);
      setRevealData(null);
      setFakeSubmittedCount(0);
      setVoteProgress({ voted: 0, total: 0 });
      setKnownPlayerIds([]);
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
      setWorkKindLabel(null);
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
      setWorkKindLabel(data.workKindLabel || null);
      setContentType(normalizeContentType(data.contentType));
    },
    'round:synopsis_presented': (data) => {
      setSynopsis(data.synopsis);
      setWorkKindLabel(data.workKindLabel || null);
      setContentType(normalizeContentType(data.contentType));
    },
    'round:questioner_view': (data) => {
      if (data.roundId === round.id) setQuestionerView(data);
    },
    'round:known_declared': ({ player: p }) => {
      setKnownPlayerIds((prev) => [...new Set([...prev, p.id])]);
    },
    'round:unknown_declared': ({ player: p }) => {
      setKnownPlayerIds((prev) => prev.filter((id) => id !== p.id));
    },
    'round:all_declared': ({ knownPlayerIds }) => {
      setAllDeclared(true);
      setKnownPlayerIds(knownPlayerIds);
    },
    'round:declaration_started': ({ roundId }) => {
      if (roundId === round.id) setPhase('selecting');
    },
    'round:question_discarded': ({ roundId, realTitle }) => {
      if (roundId === round.id) setDiscardedTitle(realTitle);
    },
    'round:reselect_started': ({ mode: nextMode }) => {
      setSynopsis(null);
      setQuestionerView(null);
      setWorkKindLabel(null);
      setFetchedSynopsis(null);
      setSynopsisError(null);
      setContentType('synopsis');
      setKnownPlayerIds([]);
      setAllDeclared(false);
      setSelectingKey((k) => k + 1);
      if (nextMode === 'cpu') setPhase('confirming');
    },
    'round:phase_ready': ({ roundId }) => { if (roundId === round.id) setPhaseReady(true); },
    'round:submitting_started': (data) => {
      setDeadlineAt(data.deadlineAt);
      setPhaseReady(false);
      if (mode === 'cpu' && fetchedSynopsis) setSynopsis(fetchedSynopsis);
      setPhase('submitting');
    },
    'round:fake_submitted': (data) => {
      setFakeSubmittedCount(data.submittedCount);
    },
    'round:choices_presented': (data) => {
      setDeadlineAt(data.deadlineAt);
      setPhaseReady(false);
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
      setKnownPlayerIds((prev) => prev.filter((id) => id !== playerId));
      socket.timeout(10000).emit('room:get_state', null, (error, res) => {
        if (!leavingRef.current && !error && res?.ok) {
          setRoomPlayers(res.room.players);
          setIsHost(Boolean(res.room.players.find((p) => p.id === player.id)?.is_host));
          setHumanCount(res.room.players.filter((p) => p.is_connected && !p.is_computer).length);
        }
      });
      setDepartureNotice(`${nickname}さんが部屋から出ました。`);
    },
    'game:questioner_disconnected': ({ nickname: qNickname, fallbackHostId, roundStatus }) => {
      const isMe = player.id === fallbackHostId;
      const msg = roundStatus === 'selecting'
        ? `出題者 ${qNickname} が離脱しました。\nホストがラウンドをスキップできます。`
        : `出題者 ${qNickname} が離脱しました。\n結果確認後、ホストがMVPを選んで次へ進めます。`;
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
      setWorkKindLabel(response.workKindLabel || null);
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
            workKindLabel={genreDisclosure ? workKindLabel : null}
            synopsisError={synopsisError}
            isHost={isHost}
            canUseManual={humanCount >= 2}
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
            workKindLabel={genreDisclosure ? workKindLabel : null}
            isQuestioner={amQuestioner}
            isHost={isHost}
            isCpu={mode === 'cpu'}
            genreDisclosure={genreDisclosure}
            questionerDisconnected={questionerDisconnected}
            playerId={player.id}
            knownDeclarations={knownDeclarations}
            allDeclared={allDeclared}
            initialTitle={questionerView?.realTitle}
            initialDeclaration={resumed.declaration}
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
            workKindLabel={genreDisclosure ? workKindLabel : null}
            isQuestioner={amQuestioner}
            playerId={player.id}
            fakeSubmittedCount={fakeSubmittedCount}
            consent={gameData.settings?.advanceMode === 'consent'}
            realTitle={amQuestioner ? questionerView?.realTitle : null}
            submittedAnswers={amQuestioner ? questionerView?.answers : []}
            initialSubmitted={resumed.submitted}
            initialTitle={resumed.submittedTitle}
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
            workKindLabel={genreDisclosure ? workKindLabel : null}
            choices={choices}
            ownAnswerId={ownAnswerId}
            isQuestioner={amQuestioner}
            playerId={player.id}
            voteProgress={voteProgress}
            consent={gameData.settings?.advanceMode === 'consent'}
            realTitle={amQuestioner ? questionerView?.realTitle : null}
            initialVoted={resumed.voted}
            initialAnswerId={resumed.voteAnswerId}
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
            hasQuestioner={Boolean(questioner?.id)}
            questionerDisconnected={questionerDisconnected}
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
      <PlayerSettings player={roomPlayers.find((p) => p.id === player.id) || player} socket={socket} />
      {reconnecting ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.departureNotice}>
          接続を戻しています… この画面のままお待ちください。
        </Text>
      ) : null}
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
          <RoundProgress phase={phase} deadlineAt={deadlineAt} ready={phaseReady}
            consent={gameData.settings?.advanceMode === 'consent'}
            canAdvance={isQuestioner || isHost && (!questioner?.id || questionerDisconnected)} socket={socket} />
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
  genreNotice: { color: colors.navy, backgroundColor: colors.cream, paddingHorizontal: 20, paddingVertical: 12, fontSize: 16, fontWeight: '700' },
  departureNotice: { color: colors.navy, backgroundColor: colors.cream, paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, lineHeight: 20 },
  discardedPanel: { backgroundColor: colors.cream, paddingHorizontal: 20, paddingVertical: 12 },
  discardedLabel: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  discardedTitle: { color: colors.navy, fontSize: 18, lineHeight: 27, fontWeight: '700' },
  stoppedPanel: { width: '100%', maxWidth: 540, alignSelf: 'center', padding: 24, gap: 18 },
  stoppedTitle: { fontSize: 22, lineHeight: 30, fontWeight: '700', color: colors.navy },
  stoppedBody: { fontSize: 15, lineHeight: 25, color: colors.ink },
});

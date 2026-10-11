const { randomUUID } = require('node:crypto');
const { shuffle } = require('../utils/shuffle');
const { selectQuestionAsync } = require('../questions');
const { getKind } = require('../questions/kinds');
const { MAX_LENGTH } = require('../questions/quality');
const { generateComputerTitles } = require('../computerTitles');
const { commitGameAction } = require('./commitGameAction');
const {
  rooms, getMember, getCurrentRound, connectedAnswerers, publicRound,
  playerScores, textInput, persistRooms, publicSettings,
} = require('../gameState');

// WeakMap entries cannot leak through the public round/room serializers.
const helperStates = new WeakMap();
const cpuFetchControllers = new WeakMap();
function cancelCpuFetch(round) {
  cpuFetchControllers.get(round)?.abort();
  cpuFetchControllers.delete(round);
}
function invalidateHelper(round) {
  const state = helperStates.get(round);
  if (state) { state.controller?.abort(); state.version++; state.loading = false; state.question = null; }
}

function discardQuestion(io, room, round) {
  if (round.real_title) io.to(room.code).emit('round:question_discarded', {
    roundId: round.id, realTitle: round.real_title,
  });
}

function isRoundController(round, player) {
  return round.questioner_id === null ? player.is_host : round.questioner_id === player.id;
}

function publicGenre(room, round) {
  const kind = room.settings.genreDisclosure && getKind(round.workKind);
  return kind ? { workKind: round.workKind, workKindLabel: kind.label } : {};
}

function sendQuestionerView(io, room, round) {
  const questioner = room.players.find((p) => p.id === round.questioner_id);
  if (!questioner?.is_connected || !questioner.socket_id) return;
  io.to(questioner.socket_id).emit('round:questioner_view', {
    roundId: round.id, realTitle: round.real_title,
    answers: round.answers.filter((a) => !a.is_real).map(({ id, title }) => ({ id, title })),
  });
}

function resetCpuSynopsis(round) {
  ++round.fetchVersion;
  round.synopsis = null;
  round.real_title = null;
  round.sourceQuestion = null;
  round.contentType = null;
  round.workKind = null;
  round.fetchError = null;
  round.previewConfirmed = false;
  round.declarations.clear();
}

async function loadCpuSynopsis(io, room, round) {
  cancelCpuFetch(round);
  const controller = new AbortController();
  cpuFetchControllers.set(round, controller);
  const version = round.fetchVersion;
  const loadingHost = room.players.find((p) => p.is_host && p.is_connected);
  if (loadingHost) io.to(loadingHost.socket_id).emit('round:synopsis_loading', { roundId: round.id });
  let work;
  let failure;
  try {
    work = await selectQuestionAsync(room.usedQuestionIds, { signal: controller.signal });
  } catch (error) {
    failure = error.message;
  } finally {
    if (cpuFetchControllers.get(round) === controller) cpuFetchControllers.delete(round);
  }
  // A late selection must not overwrite a confirmed, skipped or abandoned round.
  if (rooms.get(room.code) !== room || getCurrentRound(room) !== round ||
      room.status !== 'playing' || round.status !== 'selecting' ||
      round.questioner_id !== null || round.previewConfirmed || round.fetchVersion !== version) return;
  const host = room.players.find((p) => p.is_host && p.is_connected);
  try {
    commitGameAction(io, room, persistRooms, (stagedIo) => {
      if (!work) round.fetchError = failure || '出典付きの問題を用意できませんでした。再取得してください。';
      else {
        round.synopsis = work.synopsis;
        round.real_title = work.realTitle;
        round.sourceQuestion = work;
        round.workKind = work.kind;
        round.contentType = work.contentType || (getKind(work.kind)?.contentMode === 'description' ? 'description' : 'synopsis');
        room.usedQuestionIds.push(work.id);
      }
      if (host) stagedIo.to(host.socket_id).emit(round.fetchError ? 'round:synopsis_fetch_failed' : 'round:synopsis_fetched',
        round.fetchError ? { roundId: round.id, error: round.fetchError } :
          { roundId: round.id, synopsis: round.synopsis, contentType: round.contentType, ...publicGenre(room, round) });
    });
  } catch (error) {
    round.fetchError = error.message;
    if (host) io.to(host.socket_id).emit('round:synopsis_fetch_failed', { roundId: round.id, error: error.message });
  }
}

function startRound(io, room, mode, event, playerOrder, defer) {
  const questioner = mode === 'cpu' ? null :
    room.players.find((p) => p.turn_order === room.current_round);
  const round = {
    id: randomUUID(), room_id: room.id, round_number: room.current_round,
    questioner_id: questioner?.id ?? null, status: 'selecting',
    synopsis: null, contentType: null, workKind: null, real_title: null, answers: [], votes: [],
    declarations: new Map(), fetchVersion: 0, fetchError: null, mvpAnswerId: null, sourceQuestion: null,
    previewConfirmed: false, manualCpu: false,
  };
  room.rounds.push(round);
  io.to(room.code).emit(event, {
    totalRounds: room.total_rounds, currentRound: room.current_round,
    humanCount: room.players.filter((p) => p.is_connected && !p.is_computer).length,
    questioner: questioner ? { id: questioner.id, nickname: questioner.nickname } : null,
    round: publicRound(round, room), mode, settings: publicSettings(room.settings), ...(playerOrder && { playerOrder }),
  });
  if (mode === 'cpu') { resetCpuSynopsis(round); defer(() => loadCpuSynopsis(io, room, round)); }
}

function requirePhase(round, phase) {
  if (round.status !== phase) throw new Error('現在この操作はできません');
}

function startSubmitting(io, room, round) {
  const computers = room.players.filter((p) => p.is_computer);
  const titles = generateComputerTitles(round.synopsis, computers.length);
  computers.forEach((player, index) => round.answers.push({
    id: randomUUID(), round_id: round.id, player_id: player.id, title: titles[index], is_real: false,
  }));
  round.status = 'submitting';
  setDeadline(room, round);
  // CPU synopsis was private to the host until confirmation. Every answerer
  // needs it now; reuse the existing public synopsis event.
  io.to(room.code).emit('round:synopsis_presented', {
    roundId: round.id, synopsis: round.synopsis, contentType: round.contentType, ...publicGenre(room, round),
  });
  io.to(room.code).emit('round:submitting_started', { roundId: round.id, deadlineAt: round.deadline_at });
  checkRoundProgress(io, room, round);
}

function registerGameHandlers(io, socket) {
  function on(event, handler) {
    socket.on(event, (payload, callback) => {
      try {
        const { room, player } = getMember(socket);
        if (event !== 'game:start' && room.status !== 'playing') {
          throw new Error('ゲームが開始していないか、終了しています');
        }
        const result = event === 'round:get_synopsis' ? handler(payload, room, player, io) :
          commitGameAction(io, room, persistRooms,
            (stagedIo, defer) => handler(payload, room, player, stagedIo, defer));
        if (typeof callback === 'function') callback({ ok: true, ...result });
      } catch (error) {
        if (typeof callback === 'function') callback({ ok: false, error: error.message });
      }
    });
  }

  socket.on('round:prepare_question', async (payload, callback) => {
    if (typeof callback !== 'function') return;
    let state;
    let version;
    try {
      const { room, player } = getMember(socket);
      const round = getCurrentRound(room);
      const check = () => {
        const member = getMember(socket);
        if (member.room !== room || member.player !== player || room.status !== 'playing' ||
            getCurrentRound(room) !== round || payload?.roomId !== room.id || payload?.roundId !== round.id) {
          throw new Error('現在の部屋とラウンドを指定してください');
        }
        if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
        requirePhase(round, 'selecting');
        if (round.synopsis) throw new Error('作品を選び直してから補助を使ってください');
      };
      check();
      state = helperStates.get(round) || { version: 0, loading: false, question: null };
      if (state.loading) throw new Error('問題の補助を取得中です');
      helperStates.set(round, state);
      version = ++state.version;
      state.loading = true;
      state.controller = new AbortController();
      const work = await selectQuestionAsync([...room.usedQuestionIds], { signal: state.controller.signal });
      check();
      if (state.version !== version) throw new Error('取得中に出題内容が変更されました。もう一度お試しください');
      commitGameAction(io, room, persistRooms, () => room.usedQuestionIds.push(work.id));
      state.question = work;
      callback({ ok: true, roundId: round.id, questionId: work.id, title: work.realTitle,
        synopsis: work.synopsis, kind: work.kind, contentType: work.contentType || 'synopsis' });
    } catch (error) {
      callback({ ok: false, error: error.message });
    } finally {
      if (state && version !== undefined && state.version === version) state.loading = false;
    }
  });

  on('game:start', (payload, room, player, io, defer) => {
    if (!player.is_host) throw new Error('ゲーム開始はホストのみ操作できます');
    if (room.status !== 'waiting') throw new Error('すでにゲームが開始しています');
    const mode = payload?.mode ?? 'player';
    if (!['player', 'cpu'].includes(mode)) throw new Error('出題形式が不正です');
    if (payload?.genreDisclosure !== undefined && typeof payload.genreDisclosure !== 'boolean') throw new Error('ジャンル指定の設定が不正です');
    const requestedRounds = payload?.totalRounds ?? 5;
    if (mode === 'cpu' && !Number.isInteger(requestedRounds)) throw new Error('ラウンド数が不正です');
    const connectedPlayers = room.players.filter((p) => p.is_connected);
    const _isDev = process.env.NODE_ENV === 'development';
    const _allowThree = process.env.ALLOW_THREE_PLAYER_DEV === 'true';
    const minPlayers = (_isDev && _allowThree) ? 3 : 4;
    if (connectedPlayers.length < minPlayers) throw new Error(`最低${minPlayers}人が必要です（推奨4〜6人）`);
    if (connectedPlayers.length > 6) throw new Error('最大6人です');
    const humans = connectedPlayers.filter((p) => !p.is_computer);
    if (humans.some((p) => p.profile_ready === false)) throw new Error('全員の名前とアイコンの入力を待ってください');
    if (mode === 'player' && humans.length < 2) throw new Error('プレイヤー出題には人間が2人以上必要です。1人で遊ぶ場合はCPU出題を選んでください');
    const ordered = mode === 'player' ? shuffle(humans) : [];
    ordered.forEach((p, i) => { p.turn_order = i + 1; });
    room.settings.genreDisclosure = payload?.genreDisclosure ?? room.settings.genreDisclosure;
    room.status = 'playing';
    room.current_round = 1;
    room.total_rounds = mode === 'cpu' ? Math.min(Math.max(requestedRounds, 1), 20) : ordered.length;
    startRound(io, room, mode, 'game:started', ordered.map((p) => ({
      id: p.id, nickname: p.nickname, turnOrder: p.turn_order,
    })), defer);
  });

  // The initial preview can arrive while navigation is still mounting the game
  // screen. Recover it after listeners are registered, without revealing an answer.
  on('round:get_synopsis', (payload, room, player, io) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (payload?.roomId !== room.id || payload?.roundId !== round.id) throw new Error('現在の部屋とラウンドを指定してください');
    if (!round.synopsis && !round.fetchError) return { roundId: round.id, synopsis: null, loading: true };
    if (!round.synopsis) throw new Error(round.fetchError);
    return { roundId: round.id, synopsis: round.synopsis, contentType: round.contentType, ...publicGenre(room, round) };
  });

  on('round:confirm_synopsis', (_, room, player, io) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (!round.synopsis) throw new Error('作品の紹介文がまだ取得されていません');
    if (round.previewConfirmed) throw new Error('すでに紹介文を提示しています');
    round.previewConfirmed = true;
    round.declarations.clear();
    io.to(room.code).emit('round:synopsis_presented', {
      roundId: round.id, synopsis: round.synopsis, contentType: round.contentType, ...publicGenre(room, round),
    });
    io.to(room.code).emit('round:declaration_started', { roundId: round.id });
  });

  on('round:reroll_synopsis', (_, room, player, io, defer) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (round.previewConfirmed) throw new Error('提示した作品は確認画面から選び直してください');
    discardQuestion(io, room, round);
    resetCpuSynopsis(round);
    defer(() => loadCpuSynopsis(io, room, round));
  });

  on('round:use_manual', (_, room, player, io, defer) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null || round.previewConfirmed) throw new Error('CPUの取得待ち画面から操作してください');
    if (connectedAnswerers(room, round).length < 2) throw new Error('手動出題には人間が2人以上必要です。もう一度検索してください');
    discardQuestion(io, room, round);
    defer(() => cancelCpuFetch(round));
    ++round.fetchVersion;
    round.questioner_id = player.id;
    round.manualCpu = true;
    round.synopsis = null;
    round.real_title = null;
    round.sourceQuestion = null;
    round.contentType = null;
    round.workKind = null;
    round.fetchError = null;
    round.declarations.clear();
    io.to(room.code).emit('game:round_started', {
      totalRounds: room.total_rounds, currentRound: room.current_round,
      humanCount: room.players.filter((p) => p.is_connected && !p.is_computer).length,
      questioner: { id: player.id, nickname: player.nickname }, round: publicRound(round, room), mode: 'player', settings: publicSettings(room.settings),
    });
  });

  on('round:submit_synopsis', (payload, room, player, io, defer) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    const synopsis = textInput(payload?.synopsis, '作品の紹介文', MAX_LENGTH);
    const title = textInput(payload?.realTitle, '本物のタイトル', 500);
    let sourceQuestion = null;
    if (typeof payload?.questionId === 'string') {
      const original = helperStates.get(round)?.question;
      if (original?.id === payload.questionId && original.realTitle === title && original.synopsis === synopsis) sourceQuestion = original;
    }
    const workKind = payload?.workKind ?? sourceQuestion?.kind ?? null;
    if (sourceQuestion && workKind !== sourceQuestion.kind) sourceQuestion = null;
    if (room.settings.genreDisclosure && !getKind(workKind)) throw new Error('作品のジャンルを選択してください');
    if (workKind !== null && !getKind(workKind)) throw new Error('作品のジャンルが不正です');
    defer(() => invalidateHelper(round));
    round.workKind = workKind;
    round.synopsis = synopsis;
    round.real_title = title;
    round.sourceQuestion = sourceQuestion;
    round.contentType = sourceQuestion?.contentType || (getKind(sourceQuestion?.kind)?.contentMode === 'description' ? 'description' : 'synopsis');
    round.declarations.clear();
    io.to(room.code).emit('round:synopsis_presented', { roundId: round.id, synopsis, contentType: round.contentType, ...publicGenre(room, round) });
    sendQuestionerView(io, room, round);
  });

  for (const kind of ['known', 'unknown']) {
    on(`round:declare_${kind}`, (_, room, player, io) => {
      const round = getCurrentRound(room);
      if (round.questioner_id === player.id) throw new Error('回答者のみ操作できます');
      requirePhase(round, 'selecting');
      if (!round.synopsis) throw new Error('作品の紹介文が提示されていません');
      if (round.questioner_id === null && !round.previewConfirmed) throw new Error('ホストの紹介文提示を待ってください');
      round.declarations.set(player.id, kind);
      io.to(room.code).emit(`round:${kind}_declared`, { player: { id: player.id, nickname: player.nickname } });
      checkAllDeclared(io, room, round);
    });
  }

  on('round:reselect', (_, room, player, io, defer) => {
    const round = getCurrentRound(room);
    if (!isRoundController(round, player)) throw new Error('出題者またはCPU出題のホストのみ操作できます');
    requirePhase(round, 'selecting');
    discardQuestion(io, room, round);
    defer(() => invalidateHelper(round));
    round.synopsis = null;
    round.real_title = null;
    round.sourceQuestion = null;
    round.contentType = null;
    round.workKind = null;
    round.declarations.clear();
    io.to(room.code).emit('round:reselect_started', { roundId: round.id,
      mode: round.questioner_id === null ? 'cpu' : 'player', message: '別の作品を選んでいます...' });
    if (round.questioner_id === null) {
      resetCpuSynopsis(round);
      defer(() => loadCpuSynopsis(io, room, round));
    }
  });

  on('round:start_submitting', (_, room, player, io) => {
    const round = getCurrentRound(room);
    if (!isRoundController(round, player)) throw new Error('出題者またはCPU出題のホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id === null && !round.previewConfirmed) throw new Error('先に紹介文を提示してください');
    if (!round.synopsis || !round.real_title) throw new Error('作品の紹介文が設定されていません');
    const answerers = connectedAnswerers(room, round);
    if (answerers.some((p) => round.declarations.get(p.id) === 'known')) {
      throw new Error('「知ってる！」宣言をしたプレイヤーがいます。作品を選び直してください');
    }
    if (!answerers.length || answerers.some((p) => round.declarations.get(p.id) !== 'unknown')) {
      throw new Error('全員の「知らない」宣言を待ってください');
    }
    startSubmitting(io, room, round);
  });

  on('round:submit_fake', (payload, room, player, io) => {
    const round = getCurrentRound(room);
    if (round.questioner_id === player.id) throw new Error('出題者は偽タイトルを提出できません');
    requirePhase(round, 'submitting');
    const title = textInput(payload?.title, 'タイトル', 500);
    if (round.answers.some((a) => a.player_id === player.id)) throw new Error('すでに偽タイトルを提出しています');
    round.answers.push({ id: randomUUID(), round_id: round.id, player_id: player.id, title, is_real: false });
    io.to(player.socket_id).emit('round:fake_saved', { roundId: round.id });
    checkRoundProgress(io, room, round);
  });

  on('round:submit_vote', (payload, room, player, io) => {
    const round = getCurrentRound(room);
    if (round.questioner_id === player.id) throw new Error('出題者は投票できません');
    requirePhase(round, 'voting');
    const answer = round.answers.find((a) => a.id === payload?.answerId);
    if (!answer) throw new Error('選択した回答が見つかりません');
    if (answer.player_id === player.id) throw new Error('自分のタイトルには投票できません');
    if (round.votes.some((v) => v.voter_id === player.id)) throw new Error('すでに投票しています');
    round.votes.push({ voter_id: player.id, answer_id: answer.id });
    io.to(player.socket_id).emit('round:vote_saved', { roundId: round.id });
    checkRoundProgress(io, room, round);
  });

  on('round:submit_mvp', (payload, room, player, io) => {
    const round = getCurrentRound(room);
    const questioner = room.players.find((p) => p.id === round.questioner_id);
    if (round.questioner_id !== player.id && !(questioner && !questioner.is_connected && player.is_host)) {
      throw new Error('出題者のみ操作できます。出題者が退出した場合はホストが選出してください');
    }
    requirePhase(round, 'revealed');
    if (round.mvpAnswerId) throw new Error('すでにMVPを選出しています');
    const answer = round.answers.find((a) => a.id === payload?.answerId && !a.is_real);
    if (!answer) throw new Error('選択した回答が見つかりません');
    const author = room.players.find((p) => p.id === answer.player_id);
    author.score += 1;
    round.mvpAnswerId = answer.id;
    io.to(room.code).emit('round:mvp_selected', {
      answerId: answer.id, answerTitle: answer.title, playerNickname: author.nickname,
      playerId: author.id, playerScores: playerScores(room),
    });
  });

  on('round:advance_phase', (_, room, player, io) => {
    const round = getCurrentRound(room);
    const questioner = room.players.find((p) => p.id === round.questioner_id);
    if (!isRoundController(round, player) && !(questioner && !questioner.is_connected && player.is_host)) {
      throw new Error('出題者またはCPU出題のホストが進めてください');
    }
    if (!round.phase_ready) throw new Error('回答が揃うか、制限時間が終わるまでお待ちください');
    if (round.status === 'submitting') transitionToVoting(io, room, round);
    else if (round.status === 'voting') revealRound(io, room, round);
    else throw new Error('現在この操作はできません');
  });

  on('game:next_round', (_, room, player, io, defer) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id && !player.is_host) {
      throw new Error('次のラウンドへの移行は出題者またはホストのみ操作できます');
    }
    const questioner = room.players.find((p) => p.id === round.questioner_id);
    const canSkip = round.status === 'selecting' && questioner && !questioner.is_connected;
    if (round.status !== 'revealed' && !canSkip) throw new Error('結果発表を待ってください');
    if (round.status === 'revealed' && round.questioner_id !== null && !round.mvpAnswerId) {
      throw new Error('MVPを選出してから次へ進んでください');
    }
    if (room.current_round >= room.total_rounds) {
      room.status = 'finished';
      const scores = playerScores(room);
      io.to(room.code).emit('game:finished', { finalScores: scores, winner: scores[0] });
      return;
    }
    room.current_round += 1;
    startRound(io, room, round.questioner_id === null || round.manualCpu ? 'cpu' : 'player', 'game:round_started', undefined, defer);
  });
}

function checkAllDeclared(io, room, round) {
  const answerers = connectedAnswerers(room, round);
  const declared = answerers.filter((p) => round.declarations.has(p.id));
  if (answerers.length && declared.length === answerers.length) {
    io.to(room.code).emit('round:all_declared', {
      knownPlayerIds: declared.filter((p) => round.declarations.get(p.id) === 'known').map((p) => p.id),
      declaredCount: declared.length, totalCount: answerers.length,
    });
  }
}

function checkRoundProgress(io, room, round) {
  const answerers = connectedAnswerers(room, round);
  if (round.status === 'submitting') {
    sendQuestionerView(io, room, round);
    const submittedCount = answerers.filter((p) => round.answers.some((a) => a.player_id === p.id)).length;
    const computerCount = room.players.filter((p) => p.is_computer).length;
    const questioner = room.players.find((p) => p.id === round.questioner_id);
    if (questioner?.socket_id) io.to(questioner.socket_id).emit('round:fake_submitted', {
      submittedCount: submittedCount + computerCount, totalCount: answerers.length + computerCount,
    });
    if (round.answers.some((a) => !a.is_real) && (submittedCount === answerers.length || deadlinePassed(round))) {
      readyPhase(io, room, round, transitionToVoting);
    }
  } else if (round.status === 'voting') {
    const votedCount = answerers.filter((p) => round.votes.some((v) => v.voter_id === p.id)).length;
    io.to(room.code).emit('round:vote_progress', { votedCount, totalCount: answerers.length });
    if (votedCount === answerers.length || deadlinePassed(round)) readyPhase(io, room, round, revealRound);
  } else if (round.status === 'selecting' && round.synopsis) {
    checkAllDeclared(io, room, round);
  }
}

function setDeadline(room, round) {
  round.deadline_at = room.settings.timeLimitSeconds ? Date.now() + room.settings.timeLimitSeconds * 1000 : null;
  round.phase_ready = false;
  round.timer_notified = false;
}
function deadlinePassed(round) { return Boolean(round.deadline_at && round.deadline_at <= Date.now()); }
function readyPhase(io, room, round, advance) {
  if (room.settings.advanceMode !== 'consent') return advance(io, room, round);
  if (round.phase_ready) return;
  round.phase_ready = true;
  io.to(room.code).emit('round:phase_ready', { roundId: round.id, phase: round.status });
}
function checkRoundTimers(io) {
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    const round = getCurrentRound(room);
    if (!['submitting', 'voting'].includes(round.status) || round.timer_notified || !deadlinePassed(round)) continue;
    try {
      commitGameAction(io, room, persistRooms, (stagedIo) => {
        round.timer_notified = true;
        checkRoundProgress(stagedIo, room, round);
      });
    } catch (_) { console.error('[Game] 制限時間の進行を保存できませんでした'); }
  }
}

function transitionToVoting(io, room, round) {
  if (round.status !== 'submitting') return;
  round.answers.push({ id: randomUUID(), player_id: null, title: round.real_title, is_real: true });
  round.answers = shuffle(round.answers);
  round.answers.forEach((a, i) => { a.display_order = i + 1; });
  round.status = 'voting';
  setDeadline(room, round);
  const choices = round.answers.map((a) => ({ id: a.id, title: a.title, displayOrder: a.display_order }));
  for (const player of room.players) {
    if (!player.is_connected || !player.socket_id) continue;
    // Identify only the recipient's own answer; other authors remain private.
    const ownAnswerId = round.answers.find((a) => a.player_id === player.id)?.id ?? null;
    io.to(player.socket_id).emit('round:choices_presented', {
      roundId: round.id, choices, ownAnswerId, deadlineAt: round.deadline_at,
    });
  }
}

function revealRound(io, room, round) {
  if (round.status !== 'voting') return;
  const realAnswer = round.answers.find((a) => a.is_real);
  round.roundScores = room.players.filter((p) => p.id !== round.questioner_id).map((p) => {
    const correct_pts = Number(round.votes.some((v) => v.voter_id === p.id && v.answer_id === realAnswer.id));
    const fake = round.answers.find((a) => a.player_id === p.id);
    const deceive_pts = fake ? round.votes.filter((v) => v.answer_id === fake.id).length : 0;
    const total_pts = correct_pts + deceive_pts;
    p.score += total_pts;
    return { player_id: p.id, correct_pts, deceive_pts, total_pts };
  });
  round.status = 'revealed';
  round.deadline_at = null;
  round.phase_ready = false;
  io.to(room.code).emit('round:revealed', getRevealedRound(room, round));
}

function getRevealedRound(room, round) {
  return {
    roundId: round.id, realTitle: round.real_title,
    contentType: round.contentType || 'synopsis',
    workKind: round.workKind || round.sourceQuestion?.kind || null,
    workKindLabel: getKind(round.workKind || round.sourceQuestion?.kind)?.label || null,
    sources: round.sourceQuestion?.sources || [],
    answers: round.answers.map((a) => {
      const author = room.players.find((p) => p.id === a.player_id);
      return { id: a.id, title: a.title, isReal: a.is_real, displayOrder: a.display_order,
        author: author ? { id: author.id, nickname: author.nickname } : null };
    }),
    votes: round.votes.map((v) => ({ voterId: v.voter_id, answerId: v.answer_id })),
    roundScores: round.roundScores, playerScores: playerScores(room),
  };
}

function getResumeGame(room, player) {
  const round = getCurrentRound(room);
  const answerers = connectedAnswerers(room, round);
  const questioner = room.players.find((p) => p.id === round.questioner_id);
  const isQuestioner = round.questioner_id === player.id;
  const mode = round.questioner_id === null ? 'cpu' : 'player';
  const mvpAnswer = round.answers.find((a) => a.id === round.mvpAnswerId);
  const mvpAuthor = mvpAnswer && room.players.find((p) => p.id === mvpAnswer.player_id);
  const synopsisPublic = round.questioner_id !== null || round.previewConfirmed;
  return {
    totalRounds: room.total_rounds, currentRound: room.current_round, mode, settings: publicSettings(room.settings),
    humanCount: room.players.filter((p) => p.is_connected && !p.is_computer).length,
    questioner: questioner ? { id: questioner.id, nickname: questioner.nickname } : null,
    round: { ...publicRound(round, room), synopsis: synopsisPublic ? round.synopsis : null },
    resumeState: {
      phase: mode === 'cpu' && round.status === 'selecting' && !round.previewConfirmed ? 'confirming' : round.status,
      synopsis: synopsisPublic ? round.synopsis : null,
      fetchedSynopsis: mode === 'cpu' && player.is_host ? round.synopsis : null,
      synopsisError: mode === 'cpu' && player.is_host ? round.fetchError : null,
      questionerView: isQuestioner ? { roundId: round.id, realTitle: round.real_title,
        answers: round.answers.filter((a) => !a.is_real).map(({ id, title }) => ({ id, title })) } : null,
      choices: round.status === 'voting' ? round.answers.map((a) => ({ id: a.id, title: a.title, displayOrder: a.display_order })) : [],
      ownAnswerId: round.answers.find((a) => a.player_id === player.id)?.id || null,
      submitted: round.answers.some((a) => a.player_id === player.id),
      submittedTitle: round.answers.find((a) => a.player_id === player.id)?.title || '',
      voted: round.votes.some((v) => v.voter_id === player.id),
      voteAnswerId: round.votes.find((v) => v.voter_id === player.id)?.answer_id || null,
      declaration: round.declarations.get(player.id) || null,
      knownPlayerIds: answerers.filter((p) => round.declarations.get(p.id) === 'known').map((p) => p.id),
      // Retain the legacy display field while older clients remain in service.
      knownDeclarations: answerers.filter((p) => round.declarations.get(p.id) === 'known').map((p) => p.nickname),
      allDeclared: answerers.length > 0 && answerers.every((p) => round.declarations.has(p.id)),
      fakeSubmittedCount: round.answers.filter((a) => !a.is_real).length,
      voteProgress: { voted: round.votes.length, total: answerers.length },
      revealData: round.status === 'revealed' ? getRevealedRound(room, round) : null,
      questionerDisconnected: Boolean(questioner && !questioner.is_connected),
      mvpData: mvpAnswer ? { answerId: mvpAnswer.id, answerTitle: mvpAnswer.title,
        playerNickname: mvpAuthor.nickname, playerId: mvpAuthor.id, playerScores: playerScores(room) } : null,
    },
  };
}

module.exports = { registerGameHandlers, checkRoundProgress, checkRoundTimers, getResumeGame };

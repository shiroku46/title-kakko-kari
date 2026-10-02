const { randomUUID } = require('node:crypto');
const { shuffle } = require('../utils/shuffle');
const { selectQuestionAsync, findQuestion } = require('../questions');
const { getKind } = require('../questions/kinds');
const {
  rooms, getMember, getCurrentRound, connectedAnswerers, publicRound,
  playerScores, textInput,
} = require('../gameState');

async function loadCpuSynopsis(io, room, round) {
  const version = ++round.fetchVersion;
  round.synopsis = null;
  round.real_title = null;
  round.sourceQuestion = null;
  round.contentType = null;
  round.fetchError = null;
  round.declarations.clear();
  io.to(room.code).emit('round:synopsis_loading', { roundId: round.id });
  let work;
  let failure;
  try {
    work = await selectQuestionAsync(room.usedQuestionIds);
  } catch (error) {
    failure = error.message;
  }
  // A late selection must not overwrite a confirmed, skipped or abandoned round.
  if (rooms.get(room.code) !== room || getCurrentRound(room) !== round ||
      room.status !== 'playing' || round.status !== 'selecting' ||
      round.fetchVersion !== version) return;
  if (!work) {
    round.fetchError = failure || '出典付きの問題を用意できませんでした。再取得してください。';
    io.to(room.code).emit('round:synopsis_fetch_failed', {
      roundId: round.id, error: round.fetchError,
    });
    return;
  }
  round.synopsis = work.synopsis;
  round.real_title = work.realTitle;
  round.sourceQuestion = work;
  round.contentType = work.contentType || (getKind(work.kind)?.contentMode === 'description' ? 'description' : 'synopsis');
  room.usedQuestionIds.push(work.id);
  io.to(room.code).emit('round:synopsis_fetched', {
    roundId: round.id, synopsis: work.synopsis, contentType: round.contentType,
  });
}

function startRound(io, room, mode, event, playerOrder) {
  const questioner = mode === 'cpu' ? null :
    room.players.find((p) => p.turn_order === room.current_round);
  const round = {
    id: randomUUID(), room_id: room.id, round_number: room.current_round,
    questioner_id: questioner?.id ?? null, status: 'selecting',
    synopsis: null, contentType: null, real_title: null, answers: [], votes: [],
    declarations: new Map(), fetchVersion: 0, fetchError: null, mvpAnswerId: null, sourceQuestion: null,
  };
  room.rounds.push(round);
  io.to(room.code).emit(event, {
    totalRounds: room.total_rounds, currentRound: room.current_round,
    questioner: questioner ? { id: questioner.id, nickname: questioner.nickname } : null,
    round: publicRound(round), mode, ...(playerOrder && { playerOrder }),
  });
  if (mode === 'cpu') void loadCpuSynopsis(io, room, round);
}

function requirePhase(round, phase) {
  if (round.status !== phase) throw new Error('現在この操作はできません');
}

function startSubmitting(io, room, round) {
  round.status = 'submitting';
  // Keep the synopsis available to every answerer when entering submission.
  io.to(room.code).emit('round:synopsis_presented', {
    roundId: round.id, synopsis: round.synopsis, contentType: round.contentType,
  });
  io.to(room.code).emit('round:submitting_started', { roundId: round.id });
}

function hasKnown(round) {
  return [...round.declarations.values()].includes('known');
}

function requireUnknown(room, round) {
  if (hasKnown(round)) throw new Error('「知ってる！」の回答があります。確認して作品を選び直してください');
  const answerers = connectedAnswerers(room, round);
  if (!answerers.length || answerers.some((p) => round.declarations.get(p.id) !== 'unknown')) {
    throw new Error('全員の「知らない」宣言を待ってください');
  }
}

function rejectQuestion(io, room, round) {
  round.status = 'rejected';
  io.to(room.code).emit('round:question_rejected', {
    roundId: round.id, realTitle: round.real_title, synopsis: round.synopsis,
  });
}

function registerGameHandlers(io, socket) {
  // All state mutations are synchronous: validation and updates finish before
  // another socket event can run. Question preparation is separate from gameplay.
  function on(event, handler) {
    socket.on(event, (payload, callback) => {
      try {
        const { room, player } = getMember(socket);
        if (event !== 'game:start' && room.status !== 'playing') {
          throw new Error('ゲームが開始していないか、終了しています');
        }
        const result = handler(payload, room, player);
        if (typeof callback === 'function') callback({ ok: true, ...result });
      } catch (error) {
        if (typeof callback === 'function') callback({ ok: false, error: error.message });
      }
    });
  }

  on('game:start', (payload, room, player) => {
    if (!player.is_host) throw new Error('ゲーム開始はホストのみ操作できます');
    if (room.status !== 'waiting') throw new Error('すでにゲームが開始しています');
    const mode = payload?.mode ?? 'player';
    if (!['player', 'cpu'].includes(mode)) throw new Error('出題形式が不正です');
    const requestedRounds = payload?.totalRounds ?? 5;
    if (mode === 'cpu' && !Number.isInteger(requestedRounds)) throw new Error('ラウンド数が不正です');
    const connectedPlayers = room.players.filter((p) => p.is_connected);
    const _isDev = process.env.NODE_ENV === 'development';
    const _allowThree = process.env.ALLOW_THREE_PLAYER_DEV === 'true';
    const minPlayers = (_isDev && _allowThree) ? 3 : 4;
    if (connectedPlayers.length < minPlayers) throw new Error(`最低${minPlayers}人が必要です（推奨4〜6人）`);
    if (connectedPlayers.length > 6) throw new Error('最大6人です');
    const ordered = mode === 'player' ? shuffle(connectedPlayers) : [];
    ordered.forEach((p, i) => { p.turn_order = i + 1; });
    room.status = 'playing';
    room.current_round = 1;
    room.total_rounds = mode === 'cpu' ? Math.min(Math.max(requestedRounds, 1), 20) : ordered.length;
    startRound(io, room, mode, 'game:started', ordered.map((p) => ({
      id: p.id, nickname: p.nickname, turnOrder: p.turn_order,
    })));
  });

  // The initial preview can arrive while navigation is still mounting the game
  // screen. Recover it after listeners are registered, without revealing an answer.
  on('round:get_synopsis', (payload, room) => {
    const round = getCurrentRound(room);
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (payload?.roomId !== room.id || payload?.roundId !== round.id) throw new Error('現在の部屋とラウンドを指定してください');
    if (!round.synopsis && !round.fetchError) return { roundId: round.id, synopsis: null, loading: true };
    if (!round.synopsis) throw new Error(round.fetchError);
    return { roundId: round.id, synopsis: round.synopsis, contentType: round.contentType };
  });

  on('round:confirm_synopsis', (_, room, player) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (!round.synopsis) throw new Error('作品の紹介文がまだ取得されていません');
    requireUnknown(room, round);
    startSubmitting(io, room, round);
  });

  on('round:reroll_synopsis', (_, room, player) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (hasKnown(round)) {
      rejectQuestion(io, room, round);
      return;
    }
    void loadCpuSynopsis(io, room, round);
  });

  on('round:submit_synopsis', (payload, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    if (round.synopsis) throw new Error('提示済みの作品は先に選び直してください');
    const synopsis = textInput(payload?.synopsis, '作品の紹介文', 10000);
    const title = textInput(payload?.realTitle, '本物のタイトル', 500);
    let sourceQuestion = null;
    if (typeof payload?.questionId === 'string') {
      const original = findQuestion(payload.questionId);
      if (original && original.realTitle === title && original.synopsis === synopsis) sourceQuestion = original;
    }
    round.synopsis = synopsis;
    round.real_title = title;
    round.sourceQuestion = sourceQuestion;
    round.contentType = sourceQuestion?.contentType || (getKind(sourceQuestion?.kind)?.contentMode === 'description' ? 'description' : 'synopsis');
    round.declarations.clear();
    io.to(room.code).emit('round:synopsis_presented', { roundId: round.id, synopsis, contentType: round.contentType });
  });

  for (const kind of ['known', 'unknown']) {
    on(`round:declare_${kind}`, (_, room, player) => {
      const round = getCurrentRound(room);
      if (round.questioner_id === player.id) throw new Error('回答者のみ操作できます');
      requirePhase(round, 'selecting');
      if (!round.synopsis) throw new Error('作品の紹介文が提示されていません');
      if (round.declarations.has(player.id)) throw new Error('すでに回答しています');
      round.declarations.set(player.id, kind);
      io.to(room.code).emit(`round:${kind}_declared`, { player: { id: player.id, nickname: player.nickname } });
      checkAllDeclared(io, room, round);
    });
  }

  on('round:reselect', (_, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    if (hasKnown(round)) {
      rejectQuestion(io, room, round);
      return;
    }
    round.synopsis = null;
    round.real_title = null;
    round.sourceQuestion = null;
    round.contentType = null;
    round.declarations.clear();
    io.to(room.code).emit('round:reselect_started', { message: '出題者が新しい作品を選んでいます...' });
  });

  on('round:next_question', (_, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id === null ? !player.is_host : round.questioner_id !== player.id) {
      throw new Error('CPU出題はホスト、人間出題は出題者のみ操作できます');
    }
    requirePhase(round, 'rejected');
    round.status = 'selecting';
    if (round.questioner_id === null) {
      void loadCpuSynopsis(io, room, round);
    } else {
      round.synopsis = null;
      round.real_title = null;
      round.sourceQuestion = null;
      round.contentType = null;
      round.declarations.clear();
      io.to(room.code).emit('round:reselect_started', { message: '出題者が新しい作品を選んでいます...' });
    }
  });

  on('round:start_submitting', (_, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    if (!round.synopsis || !round.real_title) throw new Error('作品の紹介文が設定されていません');
    requireUnknown(room, round);
    startSubmitting(io, room, round);
  });

  on('round:submit_fake', (payload, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id === player.id) throw new Error('出題者は偽タイトルを提出できません');
    requirePhase(round, 'submitting');
    const title = textInput(payload?.title, 'タイトル', 500);
    if (round.answers.some((a) => a.player_id === player.id)) throw new Error('すでに偽タイトルを提出しています');
    round.answers.push({ id: randomUUID(), round_id: round.id, player_id: player.id, title, is_real: false });
    checkRoundProgress(io, room, round);
  });

  on('round:submit_vote', (payload, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id === player.id) throw new Error('出題者は投票できません');
    requirePhase(round, 'voting');
    const answer = round.answers.find((a) => a.id === payload?.answerId);
    if (!answer) throw new Error('選択した回答が見つかりません');
    if (answer.player_id === player.id) throw new Error('自分のタイトルには投票できません');
    if (round.votes.some((v) => v.voter_id === player.id)) throw new Error('すでに投票しています');
    round.votes.push({ voter_id: player.id, answer_id: answer.id });
    checkRoundProgress(io, room, round);
  });

  on('round:submit_mvp', (payload, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
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

  on('game:next_round', (_, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id && !player.is_host) {
      throw new Error('次のラウンドへの移行は出題者またはホストのみ操作できます');
    }
    const questioner = room.players.find((p) => p.id === round.questioner_id);
    const canSkip = ['selecting', 'rejected'].includes(round.status) && questioner && !questioner.is_connected;
    if (round.status !== 'revealed' && !canSkip) throw new Error('結果発表を待ってください');
    if (room.current_round >= room.total_rounds) {
      room.status = 'finished';
      const scores = playerScores(room);
      io.to(room.code).emit('game:finished', { finalScores: scores, winner: scores[0] });
      return;
    }
    room.current_round += 1;
    startRound(io, room, round.questioner_id === null ? 'cpu' : 'player', 'game:round_started');
  });
}

function checkAllDeclared(io, room, round) {
  const answerers = connectedAnswerers(room, round);
  const declared = answerers.filter((p) => round.declarations.has(p.id));
  if (answerers.length && declared.length === answerers.length) {
    io.to(room.code).emit('round:all_declared', {
      knownPlayerIds: [...round.declarations].filter(([, kind]) => kind === 'known').map(([id]) => id),
      declaredCount: declared.length, totalCount: answerers.length,
    });
  }
}

function checkRoundProgress(io, room, round) {
  const answerers = connectedAnswerers(room, round);
  if (round.status === 'submitting') {
    const submittedCount = answerers.filter((p) => round.answers.some((a) => a.player_id === p.id)).length;
    const questioner = room.players.find((p) => p.id === round.questioner_id);
    if (questioner?.socket_id) io.to(questioner.socket_id).emit('round:fake_submitted', {
      submittedCount, totalCount: answerers.length,
    });
    if (answerers.length && submittedCount === answerers.length) transitionToVoting(io, room, round);
  } else if (round.status === 'voting') {
    const votedCount = answerers.filter((p) => round.votes.some((v) => v.voter_id === p.id)).length;
    io.to(room.code).emit('round:vote_progress', { votedCount, totalCount: answerers.length });
    if (answerers.length && votedCount === answerers.length) revealRound(io, room, round);
  } else if (round.status === 'selecting' && round.synopsis) {
    checkAllDeclared(io, room, round);
  }
}

function transitionToVoting(io, room, round) {
  if (round.status !== 'submitting') return;
  round.answers.push({ id: randomUUID(), player_id: null, title: round.real_title, is_real: true });
  round.answers = shuffle(round.answers);
  round.answers.forEach((a, i) => { a.display_order = i + 1; });
  round.status = 'voting';
  const choices = round.answers.map((a) => ({ id: a.id, title: a.title, displayOrder: a.display_order }));
  for (const player of room.players) {
    if (!player.is_connected || !player.socket_id) continue;
    // Identify only the recipient's own answer; other authors remain private.
    const ownAnswerId = round.answers.find((a) => a.player_id === player.id)?.id ?? null;
    io.to(player.socket_id).emit('round:choices_presented', {
      roundId: round.id, choices, ownAnswerId,
    });
  }
}

function revealRound(io, room, round) {
  if (round.status !== 'voting') return;
  const realAnswer = round.answers.find((a) => a.is_real);
  const roundScores = room.players.filter((p) => p.id !== round.questioner_id).map((p) => {
    const correct_pts = Number(round.votes.some((v) => v.voter_id === p.id && v.answer_id === realAnswer.id));
    const fake = round.answers.find((a) => a.player_id === p.id);
    const deceive_pts = fake ? round.votes.filter((v) => v.answer_id === fake.id).length : 0;
    const total_pts = correct_pts + deceive_pts;
    p.score += total_pts;
    return { player_id: p.id, correct_pts, deceive_pts, total_pts };
  });
  round.status = 'revealed';
  io.to(room.code).emit('round:revealed', {
    roundId: round.id, realTitle: round.real_title,
    contentType: round.contentType || 'synopsis',
    workKind: round.sourceQuestion?.kind || null,
    workKindLabel: getKind(round.sourceQuestion?.kind)?.label || null,
    sources: round.sourceQuestion?.sources || [],
    answers: round.answers.map((a) => {
      const author = room.players.find((p) => p.id === a.player_id);
      return { id: a.id, title: a.title, isReal: a.is_real, displayOrder: a.display_order,
        author: author ? { id: author.id, nickname: author.nickname } : null };
    }),
    votes: round.votes.map((v) => ({ voterId: v.voter_id, answerId: v.answer_id })),
    roundScores, playerScores: playerScores(room),
  });
}

module.exports = { registerGameHandlers, checkRoundProgress };

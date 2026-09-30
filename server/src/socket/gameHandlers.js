const { randomUUID } = require('node:crypto');
const { shuffle } = require('../utils/shuffle');
const {
  rooms, getMember, getCurrentRound, connectedAnswerers, publicRound,
  playerScores, textInput,
} = require('../gameState');

async function fetchWikipediaSynopsis() {
  for (let i = 0; i < 5; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://ja.wikipedia.org/api/rest_v1/page/random/summary', { signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json();
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const synopsis = typeof data.extract === 'string' ? data.extract.trim() : '';
      if (!title || synopsis.length < 100) continue;
      return { title, synopsis: synopsis.split(title).join('■■■') };
    } catch (_) {
      // Retry transient upstream failures without exposing response details.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function loadCpuSynopsis(io, room, round) {
  const version = ++round.fetchVersion;
  const work = await fetchWikipediaSynopsis();
  // A late response must not overwrite a confirmed, skipped or abandoned round.
  if (rooms.get(room.code) !== room || getCurrentRound(room) !== round ||
      room.status !== 'playing' || round.status !== 'selecting' ||
      round.fetchVersion !== version) return;
  const host = room.players.find((p) => p.is_host && p.is_connected);
  if (!work) {
    if (host) io.to(host.socket_id).emit('round:synopsis_fetch_failed', {
      roundId: round.id, error: '記事を取得できませんでした。再取得してください。',
    });
    return;
  }
  round.synopsis = work.synopsis;
  round.real_title = work.title;
  if (host) io.to(host.socket_id).emit('round:synopsis_fetched', {
    roundId: round.id, synopsis: work.synopsis,
  });
}

function startRound(io, room, mode, event, playerOrder) {
  const questioner = mode === 'cpu' ? null :
    room.players.find((p) => p.turn_order === room.current_round);
  const round = {
    id: randomUUID(), room_id: room.id, round_number: room.current_round,
    questioner_id: questioner?.id ?? null, status: 'selecting',
    synopsis: null, real_title: null, answers: [], votes: [],
    declarations: new Map(), fetchVersion: 0, mvpAnswerId: null,
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
  // CPU synopsis was private to the host until confirmation. Every answerer
  // needs it now; reuse the existing public synopsis event.
  io.to(room.code).emit('round:synopsis_presented', { roundId: round.id, synopsis: round.synopsis });
  io.to(room.code).emit('round:submitting_started', { roundId: round.id });
}

function registerGameHandlers(io, socket) {
  // All state mutations are synchronous: validation and updates finish before
  // another socket event can run. Only Wikipedia I/O runs asynchronously.
  function on(event, handler) {
    socket.on(event, (payload, callback) => {
      try {
        const { room, player } = getMember(socket);
        if (event !== 'game:start' && room.status !== 'playing') {
          throw new Error('ゲームが開始していないか、終了しています');
        }
        handler(payload, room, player);
        if (typeof callback === 'function') callback({ ok: true });
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

  on('round:confirm_synopsis', (_, room, player) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    if (!round.synopsis) throw new Error('あらすじがまだ取得されていません');
    startSubmitting(io, room, round);
  });

  on('round:reroll_synopsis', (_, room, player) => {
    const round = getCurrentRound(room);
    if (!player.is_host) throw new Error('ホストのみ操作できます');
    requirePhase(round, 'selecting');
    if (round.questioner_id !== null) throw new Error('CPUモード以外では操作できません');
    void loadCpuSynopsis(io, room, round);
  });

  on('round:submit_synopsis', (payload, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    const synopsis = textInput(payload?.synopsis, 'あらすじ', 10000);
    const title = textInput(payload?.realTitle, '本物のタイトル', 500);
    round.synopsis = synopsis;
    round.real_title = title;
    round.declarations.clear();
    io.to(room.code).emit('round:synopsis_presented', { roundId: round.id, synopsis });
  });

  for (const kind of ['known', 'unknown']) {
    on(`round:declare_${kind}`, (_, room, player) => {
      const round = getCurrentRound(room);
      if (round.questioner_id === player.id || round.questioner_id === null) throw new Error('回答者のみ操作できます');
      requirePhase(round, 'selecting');
      if (!round.synopsis) throw new Error('あらすじが提示されていません');
      round.declarations.set(player.id, kind);
      io.to(room.code).emit(`round:${kind}_declared`, { player: { id: player.id, nickname: player.nickname } });
      checkAllDeclared(io, room, round);
    });
  }

  on('round:reselect', (_, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    round.synopsis = null;
    round.real_title = null;
    round.declarations.clear();
    io.to(room.code).emit('round:reselect_started', { message: '出題者が新しい作品を選んでいます...' });
  });

  on('round:start_submitting', (_, room, player) => {
    const round = getCurrentRound(room);
    if (round.questioner_id !== player.id) throw new Error('出題者のみ操作できます');
    requirePhase(round, 'selecting');
    if (!round.synopsis || !round.real_title) throw new Error('あらすじが設定されていません');
    const answerers = connectedAnswerers(room, round);
    if (answerers.some((p) => round.declarations.get(p.id) === 'known')) {
      throw new Error('「知ってる！」宣言をしたプレイヤーがいます。作品を選び直してください');
    }
    if (!answerers.length || answerers.some((p) => round.declarations.get(p.id) !== 'unknown')) {
      throw new Error('全員の「知らない」宣言を待ってください');
    }
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
    const canSkip = round.status === 'selecting' && questioner && !questioner.is_connected;
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
      knownPlayerIds: declared.filter((p) => round.declarations.get(p.id) === 'known').map((p) => p.id),
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
  io.to(room.code).emit('round:choices_presented', {
    roundId: round.id,
    choices: round.answers.map((a) => ({ id: a.id, title: a.title, displayOrder: a.display_order })),
  });
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

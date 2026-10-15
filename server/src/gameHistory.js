const { createHash, timingSafeEqual } = require('node:crypto');

// shortcut: history shares the existing single-writer snapshot; move to indexed
// tables when archive size makes whole-snapshot room saves too expensive.
function recordHistory(rooms, now = Date.now()) {
  const history = new Map(rooms.history || []);
  for (const room of rooms.values()) {
    if (!room.current_round) continue;
    const previous = history.get(room.id);
    const access = { ...previous?.access };
    for (const player of room.players) {
      if (!player.is_computer && player.history_hash) {
        access[player.id] = { hash: player.history_hash, userId: access[player.id]?.userId || player.history_user_id || null };
      }
    }
    if (!Object.keys(access).length) continue;
    const rounds = room.rounds.filter(round => round.status === 'revealed').map(round => ({
      id: round.id, number: round.round_number, revealedAt: round.revealed_at || null,
      questionerId: round.questioner_id, synopsis: round.synopsis,
      realTitle: round.real_title, contentType: round.contentType || 'synopsis',
      workKind: round.workKind || round.sourceQuestion?.kind || null,
      workKindLabel: require('./questions/kinds').getGameGenre(round.workKind || round.sourceQuestion?.kind)?.label || null,
      answers: round.answers.map(answer => ({ id: answer.id, title: answer.title,
        playerId: answer.player_id, isReal: Boolean(answer.is_real) })),
      votes: round.votes.map(vote => ({ voterId: vote.voter_id, answerId: vote.answer_id })),
      scores: (round.roundScores || []).map(score => ({ playerId: score.player_id,
        correct: score.correct_pts, deceive: score.deceive_pts, total: score.total_pts })),
      mvpAnswerId: round.mvpAnswerId || null,
    }));
    history.set(room.id, { access, detail: {
      id: room.id, startedAt: room.started_at || null, recordedAt: previous?.detail.recordedAt || now,
      status: room.history_interrupted || room.status === 'playing' && room.expires_at && room.expires_at <= now ? 'interrupted' : room.status,
      totalRounds: room.total_rounds,
      players: room.players.map(player => ({ id: player.id, nickname: player.nickname,
        isComputer: Boolean(player.is_computer), score: player.score })), rounds,
    } });
  }
  return history;
}

function validReceipts(receipts) {
  if (!Array.isArray(receipts) || receipts.length > 200) throw new Error('INVALID_HISTORY_REQUEST');
  return receipts.filter(receipt => receipt && typeof receipt.id === 'string' && receipt.id.length <= 64 &&
    typeof receipt.playerId === 'string' && receipt.playerId.length <= 64 &&
    typeof receipt.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(receipt.token));
}

function ownsReceipt(entry, receipt) {
  const owner = entry.access[receipt.playerId];
  return owner && /^[a-f0-9]{64}$/.test(owner.hash) && timingSafeEqual(Buffer.from(owner.hash, 'hex'),
    createHash('sha256').update(receipt.token).digest());
}

function canRead(entry, id, receipts, userId) {
  return Object.values(entry.access).some(owner => userId && owner.userId === userId) ||
    receipts.some(receipt => receipt.id === id && ownsReceipt(entry, receipt) && !entry.access[receipt.playerId].userId);
}

function readHistory(rooms, receipts, userId, id, before) {
  receipts = validReceipts(receipts);
  const now = Date.now();
  const active = new Set([...rooms.values()].filter(room => !room.expires_at || room.expires_at > now).map(room => room.id));
  const status = detail => detail.status === 'playing' && !active.has(detail.id) ? 'interrupted' : detail.status;
  if (id !== undefined) {
    const entry = rooms.history?.get(id);
    return entry && canRead(entry, id, receipts, userId) ? { ...entry.detail, status: status(entry.detail) } : null;
  }
  const order = ([a, first], [b, second]) => second.detail.recordedAt - first.detail.recordedAt || a.localeCompare(b);
  const cursor = rooms.history?.get(before);
  const entries = [...(rooms.history || new Map())].filter(([key, entry]) => canRead(entry, key, receipts, userId))
    .sort(order);
  const page = entries.filter(entry => !before || cursor && order(entry, [before, cursor]) > 0).slice(0, 51);
  return { items: page.slice(0, 50).map(([, { detail }]) => ({ id: detail.id,
    startedAt: detail.startedAt, recordedAt: detail.recordedAt, status: status(detail),
    rounds: detail.rounds.length, totalRounds: detail.totalRounds,
    players: detail.players.map(player => player.nickname) })),
    next: page.length > 50 ? page[49][0] : null };
}

function linkHistory(rooms, receipts, userId) {
  if (!userId) throw new Error('UNAUTHORIZED');
  for (const receipt of validReceipts(receipts)) {
    const room = [...rooms.values()].find(room => room.id === receipt.id);
    const player = room?.players.find(player => player.id === receipt.playerId && !player.is_computer);
    if (player?.history_hash && ownsReceipt({ access: { [player.id]: { hash: player.history_hash } } }, receipt) &&
        !player.history_user_id) player.history_user_id = userId;
    const entry = rooms.history?.get(receipt.id);
    if (!entry || !ownsReceipt(entry, receipt)) continue;
    const owner = entry.access[receipt.playerId];
    if (!owner.userId) owner.userId = userId;
  }
}

function registerHistoryRoutes(app, { rooms, persist, requireStorage, run, getSession, origin }) {
  const express = require('express');
  app.use('/api/history', express.json({ limit: '64kb' }));
  for (const action of ['list', 'detail', 'link']) app.post(`/api/history/${action}`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin && req.headers.origin !== origin()) return res.sendStatus(403);
    try {
      const session = await getSession(req.headers);
      await run(async () => {
        requireStorage();
        const receipts = validReceipts(req.body?.receipts);
        if (action === 'link') {
          if (!session?.user?.id) return res.sendStatus(401);
          const before = structuredClone(rooms.history);
          const owners = [...rooms.values()].flatMap(room => room.players.map(player => [player, player.history_user_id]));
          try { linkHistory(rooms, receipts, session.user.id); await persist(); }
          catch (error) {
            rooms.history = before;
            for (const [player, userId] of owners) player.history_user_id = userId;
            throw error;
          }
          return res.json({ ok: true });
        }
        if (action === 'detail' && typeof req.body.id !== 'string') return res.sendStatus(400);
        const result = readHistory(rooms, receipts, session?.user?.id,
          action === 'detail' ? req.body.id : undefined, req.body.before);
        return result ? res.json(result) : res.sendStatus(404);
      });
    } catch (error) {
      res.sendStatus(error.message === 'INVALID_HISTORY_REQUEST' ? 400 : 503);
    }
  });
}

module.exports = { recordHistory, readHistory, linkHistory, registerHistoryRoutes };

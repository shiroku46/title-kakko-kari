const { isDeepStrictEqual } = require('node:util');
let operationQueue = Promise.resolve();

// A snapshot covers every room. Reads, timers and writes share one queue.
function runStateOperation(operation) {
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => {});
  return result;
}

// For synchronous answer/score commands: persist before publishing their events.
// Validation failures keep object identity, so unrelated pending fetches continue.
function commitGameAction(io, room, persist, mutate, onRollback) {
  const before = structuredClone(room);
  const originalPlayers = room.players?.slice();
  const originalRounds = room.rounds?.slice();
  const events = [];
  const effects = [];
  let status = 'pending';
  const stagedIo = {
    to(target) {
      return {
        emit(event, ...args) {
          if (status === 'failed') return false;
          if (status === 'committed') return io.to(target).emit(event, ...args);
          events.push({ target, event, args: structuredClone(args) });
          return true;
        },
      };
    },
  };
  function rollback(error) {
    status = 'failed';
    events.length = 0;
    if (!isDeepStrictEqual(room, before)) {
      try { onRollback?.(); } catch (_) { /* Keep the original failure and restore state. */ }
      for (const key of Object.keys(room)) delete room[key];
      Object.assign(room, before);
      // Pending question fetches identify the same player and round objects.
      for (const [key, originals] of [['players', originalPlayers], ['rounds', originalRounds]]) {
        if (!originals) continue;
        room[key] = before[key].map((saved) => {
          const original = originals.find((item) => item.id === saved.id);
          if (!original) return saved;
          for (const field of Object.keys(original)) delete original[field];
          return Object.assign(original, saved);
        });
      }
    }
    throw error;
  }
  function publish(result) {
    status = 'committed';
    for (const { target, event, args } of events) {
      try { io.to(target).emit(event, ...args); }
      catch (_) { console.error('[Game] 保存済みの更新を配信できませんでした。復帰で状態を再取得してください。'); }
    }
    const failedEffect = () => console.error('[Game] 保存済みの進行処理に失敗しました。復帰で状態を再取得してください。');
    for (const effect of effects) {
      try { effect()?.catch(failedEffect); } catch (_) { failedEffect(); }
    }
    return result;
  }
  try {
    const result = mutate(stagedIo, (effect) => effects.push(effect));
    if (result && typeof result.then === 'function') throw new Error('ゲームの状態変更は同期で実行してください');
    const saved = persist();
    return saved && typeof saved.then === 'function'
      ? saved.then(() => publish(result), rollback) : publish(result);
  } catch (error) { return rollback(error); }
}
module.exports = { commitGameAction, runStateOperation };

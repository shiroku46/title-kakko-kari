const { randomInt } = require('node:crypto');
const { readBankSync, readStore, saveStore, defaultPaths, withStoreLock } = require('./store');
const { questionIsValid } = require('./validation');

const STATUS_FAILURE_MESSAGES = Object.freeze({
  failed: '作品の自動収集に失敗しました。保存済みの問題は引き続き使用できます。',
  no_new_work: '新しい作品を確認できませんでした。次回の自動収集で続けます。',
  timed_out: '資料の取得に時間がかかりました。次回の自動収集で続けます。',
  cancelled: '作品の自動収集を停止しました。',
});

function createQuestionService({
  bankPath, statePath, seedPath,
  enabled = true, collectImpl, fetchImpl,
  collectionTimeoutMilliseconds = 60000,
  collectionOptions = {}, minimumAvailable = 8,
  cooldownMilliseconds = 300000, intervalMilliseconds = 3600000,
  now = Date.now, validateQuestion = questionIsValid,
} = {}) {
  const paths = bankPath ? { bankPath, statePath: statePath || `${bankPath}.discovery.json`, seedPath } : defaultPaths();
  let pending = null;
  let controller = null;
  let interval = null;
  let failedAt = null;
  let lastError = null;
  let generation = 0;
  let lastStartedAt = null;
  let lastCompletedAt = null;
  let lastSuccessfulAt = null;
  let nextScheduledAt = null;
  let statusFailure = null;

  function getStatus() {
    return {
      enabled: Boolean(enabled), running: Boolean(pending), scheduled: Boolean(interval),
      lastStartedAt, lastCompletedAt, lastSuccessfulAt, nextScheduledAt, intervalMilliseconds,
      failure: statusFailure ? { ...statusFailure } : null,
    };
  }

  function available(excludedIds = []) {
    const excluded = new Set(excludedIds);
    return readBankSync(paths).questions.filter((q) => validateQuestion(q) && !excluded.has(q.id));
  }

  function collectNow() {
    if (!enabled) return Promise.resolve({ added: [], disabled: true });
    if (pending) return pending;
    if (failedAt !== null && now() - failedAt < cooldownMilliseconds) {
      return Promise.resolve({ added: [], coolingDown: true, error: lastError });
    }
    controller = new AbortController();
    const activeController = controller;
    const collectionGeneration = generation;
    lastStartedAt = new Date(now()).toISOString();
    let timedOut = false;
    let completionFailure = null;
    let savedNewWork = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, collectionTimeoutMilliseconds);
    pending = (async () => {
      try {
        return await withStoreLock(paths, async () => {
          const { questions, state } = await readStore(paths);
          const collector = collectImpl || require('./collector').collectQuestions;
          const collection = collector({
            ...collectionOptions, questions, state, ...(fetchImpl && { fetchImpl }),
            signal: activeController.signal, validateQuestion,
          });
          let onAbort;
          const aborted = new Promise((_, reject) => {
            onAbort = () => reject(new Error('作品収集が中断されました。'));
            if (activeController.signal.aborted) onAbort();
            else activeController.signal.addEventListener('abort', onAbort, { once: true });
          });
          let result;
          try {
            try { result = await Promise.race([collection, aborted]); }
            catch (error) {
              if (!activeController.signal.aborted || generation !== collectionGeneration) throw error;
              // The real collector returns verified partial work after its fetch
              // aborts. Give it a short grace period to save that progress; a
              // transport that ignores abort still cannot hold the game forever.
              let grace;
              try {
                result = await Promise.race([collection, new Promise((_, reject) => {
                  grace = setTimeout(() => reject(error), 1500);
                })]);
              } finally { clearTimeout(grace); }
            }
          }
          finally { activeController.signal.removeEventListener('abort', onAbort); }
          if (generation !== collectionGeneration) throw new Error('作品収集を停止しました。');
          if (!result || !Array.isArray(result.questions)
            || result.questions.some((question) => !validateQuestion(question))) {
            throw new Error('自動収集した問題を確認できません。');
          }
          await saveStore(paths, { questions: result.questions, state: result.state }, { lockHeld: true });
          const count = Array.isArray(result.added) ? result.added.length : Number(result.added || 0);
          if (!count) {
            failedAt = now();
            lastError = '新しい作品を確認できませんでした。時間をおいて再取得してください。';
            completionFailure = timedOut ? 'timed_out' : 'no_new_work';
          } else {
            failedAt = null;
            lastError = null;
            savedNewWork = true;
            completionFailure = timedOut ? 'timed_out' : null;
          }
          return result;
        }, { signal: activeController.signal, timeoutMilliseconds: collectionTimeoutMilliseconds });
      } catch (_) {
        failedAt = now();
        completionFailure = generation !== collectionGeneration ? 'cancelled' : timedOut ? 'timed_out' : 'failed';
        lastError = STATUS_FAILURE_MESSAGES[completionFailure];
        return { added: [], error: lastError };
      } finally {
        clearTimeout(timeout);
        if (generation !== collectionGeneration) completionFailure = 'cancelled';
        lastCompletedAt = new Date(now()).toISOString();
        if (savedNewWork) lastSuccessfulAt = lastCompletedAt;
        statusFailure = completionFailure
          ? { code: completionFailure, message: STATUS_FAILURE_MESSAGES[completionFailure], at: lastCompletedAt }
          : null;
        controller = null;
        pending = null;
      }
    })();
    return pending;
  }

  async function selectQuestion(excludedIds = []) {
    let choices = available(excludedIds);
    if (!choices.length && enabled) {
      await collectNow();
      choices = available(excludedIds);
    }
    if (!choices.length) {
      throw new Error(lastError || (excludedIds.length
        ? '未使用の問題をまだ用意できません。時間をおいて再取得してください。'
        : '出題できる問題がありません。問題の自動収集を再試行してください。'));
    }
    const chosen = choices[randomInt(choices.length)];
    if (enabled && choices.length < minimumAvailable) void collectNow();
    return chosen;
  }

  function start() {
    if (!enabled || interval) return;
    nextScheduledAt = new Date(now() + intervalMilliseconds).toISOString();
    void collectNow();
    interval = setInterval(() => {
      nextScheduledAt = new Date(now() + intervalMilliseconds).toISOString();
      void collectNow();
    }, intervalMilliseconds);
    interval.unref?.();
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
    nextScheduledAt = null;
    generation++;
    controller?.abort();
  }

  return { selectQuestion, collectNow, start, stop, getStatus };
}

module.exports = { createQuestionService };

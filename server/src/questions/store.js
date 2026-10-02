const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function defaultPaths() {
  const directory = process.env.QUESTION_DATA_DIR || path.resolve(__dirname, '../../data/questions');
  const bankPath = process.env.QUESTION_BANK_PATH || path.join(directory, 'bank.json');
  return {
    bankPath,
    statePath: process.env.QUESTION_DISCOVERY_STATE_PATH || (process.env.QUESTION_BANK_PATH
      ? `${bankPath}.discovery.json` : path.join(directory, 'discovery.json')),
    seedPath: process.env.QUESTION_BANK_PATH ? undefined : path.join(__dirname, 'bank.json'),
  };
}

function readBankSync({ bankPath, seedPath }) {
  let contents;
  try { contents = fs.readFileSync(bankPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('保存した問題集を読み込めませんでした。');
    if (!seedPath) return { schemaVersion: 1, questions: [] };
    try { contents = fs.readFileSync(seedPath, 'utf8'); }
    catch (_) { return { schemaVersion: 1, questions: [] }; }
  }
  let bank;
  try { bank = JSON.parse(contents); }
  catch (_) { throw new Error('保存した問題集の形式を確認してください。'); }
  if (bank.schemaVersion !== 1 || !Array.isArray(bank.questions)) {
    throw new Error('保存した問題集の形式を確認してください。');
  }
  return bank;
}

async function readStore(paths) {
  const bank = readBankSync(paths);
  let state = {};
  try { state = JSON.parse(await fsp.readFile(paths.statePath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('作品収集の進行状況を読み込めませんでした。');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('作品収集の進行状況の形式を確認してください。');
  }
  return { questions: bank.questions, state };
}

function identity(question) {
  try {
    const source = new URL(question.sources?.[0]?.url);
    return question.sources[0].provider === 'web' ? source.href : `${source.hostname}${source.pathname}`;
  } catch (_) { return question.id; }
}

async function atomicJSON(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fsp.rename(temporary, filePath);
  } finally { await fsp.rm(temporary, { force: true }); }
}

async function withStoreLock(paths, action, { signal, timeoutMilliseconds = 120000 } = {}) {
  await fsp.mkdir(path.dirname(paths.bankPath), { recursive: true });
  const lockPath = `${paths.bankPath}.collection.lock`;
  const token = randomUUID();
  const started = Date.now();
  let handle;
  while (!handle) {
    signal?.throwIfAborted();
    try {
      handle = await fsp.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
    } catch (error) {
      if (handle) {
        await handle.close();
        await fsp.rm(lockPath, { force: true });
        throw error;
      }
      if (error.code !== 'EEXIST') throw error;
      try {
        const contents = await fsp.readFile(lockPath, 'utf8');
        const owner = JSON.parse(contents);
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (failure) {
            if (failure.code === 'ESRCH' && await fsp.readFile(lockPath, 'utf8') === contents) {
              await fsp.rm(lockPath, { force: true });
              continue;
            }
          }
        }
      } catch (failure) {
        if (failure.code === 'ENOENT') continue;
        // An interrupted creation can leave an empty lock. A live writer fills
        // it immediately; do not steal it during that short creation window.
        try {
          const stat = await fsp.stat(lockPath);
          if (Date.now() - stat.mtimeMs > 120000) {
            await fsp.rm(lockPath, { force: true });
            continue;
          }
        } catch (_) { /* Retry acquisition and observe the latest lock. */ }
      }
      if (Date.now() - started >= timeoutMilliseconds) {
        throw new Error('別の作品収集が進行中です。時間をおいて再取得してください。');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try { signal?.throwIfAborted(); return await action(); }
  finally {
    await handle.close();
    try {
      if (JSON.parse(await fsp.readFile(lockPath, 'utf8')).token === token) {
        await fsp.rm(lockPath, { force: true });
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function saveStore(paths, { questions, state }, { lockHeld = false } = {}) {
  if (!lockHeld) return withStoreLock(paths, () => saveStore(paths, { questions, state }, { lockHeld: true }));
  const existing = readBankSync(paths).questions;
  const merged = new Map(existing.map((question) => [identity(question), question]));
  for (const question of questions) merged.set(identity(question), question);
  const storedQuestions = [...merged.values()];
  // Write the bank first. A crash before checkpoint replacement only causes a
  // repeated discovery; source-identity deduplication preserves the saved work.
  await atomicJSON(paths.bankPath, {
    schemaVersion: 1, generatedAt: new Date().toISOString(), questions: storedQuestions,
  });
  await atomicJSON(paths.statePath, state);
  return { questions: storedQuestions, state };
}

module.exports = { defaultPaths, readBankSync, readStore, saveStore, withStoreLock };

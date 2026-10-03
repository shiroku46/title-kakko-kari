// Read-only live-source verification. Does not change the production question bank.
const fs = require('node:fs');
const { collectQuestions, createSourceFetch } = require('../src/questions/collector');
const { questionIsValid } = require('../src/questions/validation');
const { SEARCH_KINDS } = require('../src/questions/web-search');

async function main() {
  const args = process.argv.slice(2);
  const options = { kind: 'film', batches: '4', 'max-requests': '20' };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/u, '');
    if (!['kind','batches','max-requests','output'].includes(name) || !args[i + 1]) throw new Error('Use --kind GENRE --batches 1..10 --max-requests 1..60 [--output PATH]');
    options[name] = args[i + 1];
  }
  const batches = Number(options.batches);
  const maxRequests = Number(options['max-requests']);
  if (!SEARCH_KINDS.includes(options.kind) || !Number.isInteger(batches) || batches < 1 || batches > 10 ||
      !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 60) throw new Error('Invalid bounded verification options');
  const fetchImpl = createSourceFetch();
  let state = {};
  let questions = [];
  const attempts = [];
  for (let batch = 0; batch < batches; batch++) {
    const result = await collectQuestions({ state, questions, providers: ['web'], webKinds: [options.kind], fetchImpl,
      limit: 3, maxRequests, throttleMilliseconds: 1000, validateQuestion: questionIsValid, signal: AbortSignal.timeout(45000) });
    state = result.state;
    questions = result.questions;
    const report = { batch: batch + 1, requests: result.requests, added: result.added.map((q) => ({ title: q.realTitle,
      kind: q.kind, length: q.synopsis.length, source: q.sources[0].url })), rejected: result.rejected };
    attempts.push(report);
    console.log(JSON.stringify(report));
    if (questions.some((q) => q.kind === options.kind && questionIsValid(q))) break;
    // Respect search-engine cooldowns rather than repeatedly retrying them.
    const cooldowns = state.providers?.web?.byKind?.[options.kind]?.cooldowns || {};
    if (!state.collector.pendingCandidates.length && ['duckduckgo','bing'].every((e) => cooldowns[e] > Date.now())) break;
  }
  if (options.output) fs.writeFileSync(options.output, JSON.stringify({ kind: options.kind, questions, state, attempts }, null, 2));
  if (!questions.some((q) => q.kind === options.kind && questionIsValid(q))) throw new Error(`No verified ${options.kind} question in this bounded run`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

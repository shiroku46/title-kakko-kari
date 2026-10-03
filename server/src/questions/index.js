const { readBankSync, defaultPaths } = require('./store');
const { questionIsValid, prepareQuestion } = require('./validation');
const { createQuestionService } = require('./service');
const { createSelectionPolicy } = require('./selection-policy');

const paths = defaultPaths();
const selection = createSelectionPolicy(paths.seedPath ? readBankSync({ bankPath: paths.seedPath }).questions : []);
const service = createQuestionService({
  ...paths, enabled: process.env.QUESTION_COLLECTION_ENABLED !== 'false',
});

function getQuestionBank() {
  const bank = readBankSync(paths);
  const questions = bank.questions.map(prepareQuestion).filter(Boolean);
  if (!questions.length) throw new Error('出題できる問題がありません。問題集を自動生成して補充してください。');
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error('問題集に重複した問題IDがあります。問題集を再生成してください。');
  }
  return questions;
}

function selectQuestion(excludedIds = []) {
  const excluded = new Set(excludedIds);
  const available = getQuestionBank().filter((question) => !excluded.has(question.id));
  if (!available.length) throw new Error('この部屋でまだ出していない問題がありません。問題集を補充してください。');
  return selection.select(available);
}

function findQuestion(questionId) {
  return getQuestionBank().find((question) => question.id === questionId) || null;
}

// Preserve deterministic fixture behavior when automatic collection is disabled.
function selectQuestionAsync(excludedIds = []) {
  return process.env.QUESTION_COLLECTION_ENABLED === 'false'
    ? Promise.resolve().then(() => selectQuestion(excludedIds))
    : service.selectQuestion(excludedIds);
}

module.exports = {
  getQuestionBank, selectQuestion, selectQuestionAsync, findQuestion, questionIsValid,
  startQuestionCollection: service.start, stopQuestionCollection: service.stop,
  getQuestionCollectionStatus: () => service.getStatus(),
};

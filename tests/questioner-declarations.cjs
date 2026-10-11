const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const { runInNewContext } = require('node:vm');
const clientRequire = createRequire(join(__dirname, '../client/package.json'));
const React = clientRequire('react');
const { renderToStaticMarkup } = clientRequire('react-dom/server');
const babel = clientRequire('@babel/core');
const Box = ({ children }) => React.createElement('div', null, children);
const Input = () => null;
const Button = ({ children, accessibilityLabel, disabled }) =>
  React.createElement('button', { 'aria-label': accessibilityLabel, disabled }, children);
const socket = { connected: true };
const mocks = {
  react: React,
  'react-native': { View: Box, ScrollView: Box, KeyboardAvoidingView: Box,
    Platform: { OS: 'web' }, StyleSheet: { create: value => value } },
};
const ui = { PaperPanel: Box, StationeryButton: Button, PopBackdrop: Box, GameLogo: Box,
  RoundHeader: ({ phase }) => React.createElement('h1', null, phase) };

function loadScreen(path, overrides = {}) {
  const module = { exports: {} };
  const source = babel.transformSync(readFileSync(join(__dirname, '../client/src', path), 'utf8'), {
    babelrc: false, configFile: false,
    plugins: [clientRequire.resolve('@babel/plugin-transform-react-jsx'), clientRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  runInNewContext(source, { module, exports: module.exports, require(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.endsWith('/theme')) return { colors: {}, radii: {} };
    if (name.endsWith('/ui/GameText')) return { Text: Box, TextInput: Input };
    if (name.endsWith('/ui')) return ui;
    if (name.endsWith('/ui/WorkIntroduction')) return ({ synopsis, realTitle }) => React.createElement('article', null, synopsis, realTitle);
    if (name.endsWith('/hooks/useResponsiveLayout')) return { useResponsiveLayout: () => ({ isPC: true, contentPadding: 16 }), CONTENT_MAX_WIDTH: 1000 };
    if (name.endsWith('/hooks/useSocket')) return { useSocketListeners() {}, getSocket: () => socket, leaveRoom() {} };
    if (name.endsWith('/hooks/useRoomRecovery')) return () => false;
    if (name.endsWith('/utils/alert')) return { Alert: { alert() {} } };
    if (name.endsWith('/utils/roomSession')) return {};
    if (name.endsWith('/utils/playerProfile')) return { rememberedName: () => '', rememberName() {} };
    if (name.endsWith('/phases/SelectingPhase')) return selecting;
    if (/\/(PlayerSettings|RoundProgress|ConfirmingPhase|SubmittingPhase|VotingPhase|RevealedPhase)$/.test(name)) return Box;
    throw new Error(`Unmocked screen dependency: ${name}`);
  } });
  return module.exports.default;
}
const selecting = loadScreen('components/phases/SelectingPhase.js');
const GameScreen = loadScreen('screens/GameScreen.js');
function gameHtml(playerId, { cpu = false, questioner = { id: 'q', nickname: '出題者' }, allDeclared = false } = {}) {
  const player = { id: playerId, nickname: playerId, is_host: playerId === 'q' };
  return renderToStaticMarkup(React.createElement(GameScreen, {
    navigation: {}, route: { params: { player, room: { code: '123456', players: [player] }, gameData: {
      mode: cpu ? 'cpu' : 'player', questioner, currentRound: 1, totalRounds: 2,
      round: { id: 'round', questioner_id: cpu ? null : 'q' },
      resumeState: { phase: 'selecting', synopsis: '港町で手紙を探す物語。', allDeclared,
        ...(playerId === 'q' && !cpu && { questionerView: { realTitle: '秘密の正解' } }) },
    } } },
  }));
}
function assertChoices(html, visible) {
  for (const label of ['知ってると宣言', '知らないと回答']) {
    assert.equal(html.includes(`aria-label="${label}"`), visible);
  }
}

test('human questioner has no known/unknown choices, including a restored seat with missing display metadata', () => {
  for (const questioner of [{ id: 'q', nickname: '出題者' }, null]) {
    const html = gameHtml('q', { questioner });
    assertChoices(html, false);
    assert.match(html, /回答者の確認を待つ/);
    assert.match(html, /秘密の正解/);
    assert.match(html, /aria-label="タイトル案提出へ進む" disabled=""/);
  }
});
test('answerer choices remain available and do not reveal the real title', () => {
  const html = gameHtml('a', { questioner: { id: 'a', nickname: '古い表示情報' } });
  assertChoices(html, true);
  assert.doesNotMatch(html, /秘密の正解/);
});
test('only answerer declarations enable the questioner to advance', () => {
  const html = gameHtml('q', { allDeclared: true });
  assertChoices(html, false);
  assert.match(html, /回答者全員が「知らない」と回答しました/);
  assert.doesNotMatch(html, /aria-label="タイトル案提出へ進む" disabled/);
});
test('CPU host remains an answerer and still chooses known/unknown', () => {
  assertChoices(gameHtml('q', { cpu: true, questioner: null }), true);
});
test('account name autofill never replaces a name already edited in the entry screen', async () => {
  for (const edit of [false, true]) {
    const states = [], effects = [];
    const screen = loadScreen('screens/NameEntryScreen.js', {
      react: { ...React, useState(value) {
        const index = states.length;
        states.push(typeof value === 'function' ? value() : value);
        return [states[index], next => { states[index] = next; }];
      }, useRef: value => ({ current: value }), useEffect: effect => effects.push(effect) },
      '../utils/accountAuth': { readAccount: async () => ({ user: { name: 'アカウントの名前' } }) },
    });
    const tree = screen({ navigation: {}, route: { params: { room: { code: '123456' }, player: { profile_ready: false } } } });
    function findInput(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === Input) return node;
      for (const child of React.Children.toArray(node.props?.children)) {
        const found = findInput(child);
        if (found) return found;
      }
    }
    if (edit) findInput(tree).props.onChangeText('自分で入力');
    const cleanup = effects.map(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states[0], edit ? '自分で入力' : 'アカウントの名前');
    cleanup.forEach(fn => fn?.());
  }
});

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
    ActivityIndicator: Box, Platform: { OS: 'web' }, StyleSheet: { create: value => value } },
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
    if (name.endsWith('/ui/GenreSelector')) return loadScreen('components/ui/GenreSelector.js', overrides);
    if (name === './StationeryButton') return Button;
    if (name === './GameText') return { Text: Box };
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
test('title fields use a 200-character multiline limit and show the answer count', () => {
  const inputs = [];
  const CaptureInput = props => { inputs.push(props); return null; };
  const form = loadScreen('components/phases/SelectingPhase.js', {
    '../ui/GameText': { Text: Box, TextInput: CaptureInput },
  });
  renderToStaticMarkup(React.createElement(form, { round: { id: 'r' }, isQuestioner: true, socket }));
  const real = inputs.find(input => input.accessibilityLabel === '本物タイトル入力欄');
  assert.equal(real.maxLength, 200);
  assert.equal(real.multiline, true);
  const sheet = loadScreen('components/ui/TitleInputSheet.js', {
    '../../theme/typography': { fontFamilies: {} },
    './GameText': { Text: Box, TextInput: CaptureInput },
    './PaperPanel': Box, './Stamp': Box, './WorkIntroduction': Box,
  });
  const html = renderToStaticMarkup(React.createElement(sheet, { value: '案'.repeat(200) }));
  const answer = inputs.find(input => input.accessibilityLabel === 'タイトル案の入力欄');
  assert.equal(answer.maxLength, 200);
  assert.equal(answer.multiline, true);
  assert.match(html, /200 \/ 200/);
});
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

test('human and CPU controls select a genre before requesting a question and discard a mismatched preview', async () => {
  for (const cpu of [false, true]) for (const [firstKind, firstLabel] of [['film', '映画'], ['any', 'ノンジャンル'], ['novel', '小説']]) {
    const state = [], requests = [];
    let cursor = 0, tree;
    const screen = loadScreen(`components/phases/${cpu ? 'Confirming' : 'Selecting'}Phase.js`, {
      react: { ...React, useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      }, useRef(initial) { return state[cursor++] ||= { current: initial }; }, useEffect() {} },
    });
    const props = { round: { id: 'r', room_id: 'room' }, isQuestioner: true, isHost: true,
      genreDisclosure: true, workKind: null, socket: { connected: true,
        timeout: () => ({ emit(name, payload, reply) { requests.push({ name, payload, reply }); } }) },
      onRerollStart(kind) { props.workKind = kind; props.fetchedSynopsis = null; },
    };
    const render = () => { cursor = 0; tree = screen(props); };
    function find(label, node = tree) {
      if (!node || typeof node !== 'object') return;
      if (node.props?.accessibilityLabel === label) return node;
      const children = typeof node.type === 'function' ? node.type(node.props) : node.props?.children;
      for (const child of React.Children.toArray(children)) {
        const found = find(label, child); if (found) return found;
      }
    }
    const action = cpu ? '選んだジャンルで問題を選ぶ' : '出題の補助を使う';
    render();
    for (const label of ['ノンジャンル', '小説', '映画', '漫画', 'ゲーム']) assert.ok(find(`出題ジャンルを${label}にする`));
    for (const label of ['短編小説', '文学作品']) assert.equal(find(`出題ジャンルを${label}にする`), undefined);
    assert.equal(find(action).props.disabled, true);
    await find(action).props.onPress();
    assert.equal(requests.length, 0);
    find(`出題ジャンルを${firstLabel}にする`).props.onPress();
    render();
    assert.equal(find(action).props.disabled, false);
    const pending = find(action).props.onPress();
    assert.equal(requests[0].name, cpu ? 'round:reroll_synopsis' : 'round:prepare_question');
    assert.equal(requests[0].payload.workKind, firstKind);
    assert.equal(requests[0].payload.roundId, 'r');
    render();
    assert.equal(find('出題ジャンルをゲームにする').props.disabled, true);
    requests[0].reply(null, cpu ? { ok: true } : { ok: true, roundId: 'r',
      kind: firstKind, questionId: 'movie', synopsis: '映画の紹介文', title: '映画の秘密の答え' });
    await pending;
    if (cpu) props.fetchedSynopsis = '映画の紹介文';
    render();
    assert.equal(find(`出題ジャンルを${firstLabel}にする`).props.variant, 'yellow');
    if (cpu) assert.ok(find('この紹介文で進む'));
    else assert.equal(find('作品の紹介文入力欄').props.value, '映画の紹介文');
    find('出題ジャンルをゲームにする').props.onPress();
    render();
    if (cpu) assert.equal(find('この紹介文で進む'), undefined);
    else {
      assert.equal(find('作品の紹介文入力欄').props.value, '');
      assert.equal(find('本物タイトル入力欄').props.value, '');
    }
    const next = find(action).props.onPress();
    assert.equal(requests[1].payload.workKind, 'game');
    requests[1].reply(null, { ok: false, error: '取得先の待機時間中です' });
    await next;
    render();
    assert.equal(find(action).props.disabled, false);
    assert.equal(find('出題ジャンルをゲームにする').props.variant, 'yellow');
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

test('lobby genre and minute choices synchronize without losing progression settings', () => {
  const state = [], requests = [];
  let cursor = 0, listeners, reply, tree;
  const screen = loadScreen('screens/LobbyScreen.js', {
    react: { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    }, useRef(initial) { return state[cursor++] ||= { current: initial }; }, useEffect() {} },
    'react-native': { ...mocks['react-native'], Pressable: Box },
    '../theme/typography': { fontFamilies: {} },
    '../components/ui': { ...ui, PlayerCard: Box },
    '../hooks/useSocket': { useSocketListeners(value) { listeners = value; }, getSocket: () => ({
      connected: true, timeout: () => ({ emit(name, payload, callback) {
        assert.equal(name, 'room:update_settings');
        requests.push(payload); reply = callback;
      } }),
    }) },
  });
  const settings = { genreDisclosure: false, advanceMode: 'consent', timeLimitSeconds: 60 };
  const props = { navigation: {}, route: { params: {
    room: { code: '123456', settings }, player: { id: 'host', is_host: true },
    allPlayers: [{ id: 'host', nickname: 'ホスト', isHost: true, profileReady: true }],
  } } };
  const render = () => { cursor = 0; tree = screen(props); };
  function button(label, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.accessibilityLabel === label) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = button(label, child);
      if (found) return found;
    }
  }
  render();
  listeners['room:settings_updated']({ settings });
  for (const enabled of [true, false, true]) {
    render();
    const label = `ジャンル指定${enabled ? 'あり' : 'なし'}`;
    button(label).props.onPress();
    assert.deepEqual({ ...requests.at(-1) }, { ...settings, genreDisclosure: enabled });
    render();
    assert.equal(button(label).props.disabled, true);
    listeners['room:settings_updated']({ settings: requests.at(-1) });
    reply(null, { ok: true, settings: requests.at(-1) });
    render();
    assert.equal(button(label).props.variant, 'yellow');
    assert.equal(button(label).props.disabled, false);
  }
  button('自動送り').props.onPress();
  assert.deepEqual({ ...requests.at(-1) }, { ...settings, genreDisclosure: true, advanceMode: 'auto' });
  reply(null, { ok: true, settings: requests.at(-1) });
  render();
  for (const seconds of [30, 60, 120, 180]) assert.equal(button(`${seconds}秒`), undefined);
  for (const value of [60, 180, 300, 420, 0]) {
    const label = value ? `${value / 60}分` : '制限なし';
    assert.equal(button(label).props.children, value ? label : 'なし');
    button(label).props.onPress();
    assert.deepEqual({ ...requests.at(-1) }, { genreDisclosure: true, advanceMode: 'auto', timeLimitSeconds: value });
    render();
    assert.equal(button(label).props.disabled, true);
    listeners['room:settings_updated']({ settings: requests.at(-1) });
    reply(null, { ok: true, settings: requests.at(-1) });
    render();
    assert.equal(button(label).props.variant, 'yellow');
    assert.equal(button(label).props.disabled, false);
  }
});

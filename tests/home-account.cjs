const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const clientRequire = createRequire(join(__dirname, '../client/package.json'));
const React = clientRequire('react');
const source = clientRequire('@babel/core').transformSync(readFileSync(join(__dirname, '../client/src/screens/HomeScreen.js'), 'utf8'), {
  babelrc: false, configFile: false,
  plugins: [clientRequire.resolve('@babel/plugin-transform-react-jsx'), clientRequire.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;

function home() {
  const account = { user: null, configuration: { ready: true, discord: true }, refresh() {} };
  const states = [], entries = [];
  let cursor = 0;
  const module = { exports: {} };
  const dependencies = {
    react: { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    } },
    'react-native': { View: 'View', Image: 'Image', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity', Platform: { OS: 'web' }, StyleSheet: { create: value => value } },
    '../components/ui/GameText': { Text: 'Text', TextInput: 'TextInput' },
    '../components/ui': { StationeryButton: 'StationeryButton', GameLogo: 'GameLogo' },
    '../components/AccountSettings': 'AccountSettings',
    '../components/home/HomeDemo': 'HomeDemo',
    '../hooks/useAccount': () => account,
    '../hooks/useSocket': { getCurrentUrl: () => 'https://fixture.invalid' },
    '../hooks/useRoomEntry': () => ({ enterRoom: options => entries.push(options), clearError() {} }),
    '../hooks/useResponsiveLayout': { useResponsiveLayout: () => ({ width: 1440, height: 1000 }) },
    '../utils/roomSession': { getRoomSession: () => null },
    '../theme': { colors: {} },
    '../theme/brand': { GAME_NAME: 'タイトルカッコカリ', brandAssets: {} },
  };
  runInNewContext(source, { module, exports: module.exports, require(name) {
    assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  function render() {
    cursor = 0;
    const nodes = [];
    function visit(node) {
      if (!React.isValidElement(node)) return;
      nodes.push(node);
      React.Children.forEach(node.props.children, visit);
    }
    visit(module.exports.default({ navigation: {} }));
    return {
      input: nodes.find(node => node.props.accessibilityLabel === 'ニックネーム入力欄').props,
      code: nodes.find(node => node.props.accessibilityLabel === 'ルームコード入力欄')?.props,
      button: label => nodes.find(node => node.props.accessibilityLabel === label).props,
      account: nodes.find(node => node.type === 'AccountSettings').props.account,
    };
  }
  return { account, entries, render };
}

test('a delayed verified account prefills the name, shares account state and submits the displayed twelve-character name', () => {
  const app = home();
  assert.equal(app.render().input.value, '');
  app.account.user = { id: 'account-1', name: 'とてもとても長いアカウントの名前' };
  const page = app.render();
  assert.equal(page.input.value, app.account.user.name.slice(0, 12));
  assert.equal(page.account, app.account);
  page.button('部屋をつくる').onPress();
  assert.equal(app.entries[0].nickname, page.input.value);
  app.account.user = { ...app.account.user, name: '変更後の名前' };
  assert.equal(app.render().input.value, '変更後の名前');
});

test('manual typing and an intentionally cleared name survive late account data and profile refresh', () => {
  const app = home();
  app.render().input.onChangeText('自分で入力');
  app.account.user = { id: 'account-1', name: 'アカウント名' };
  assert.equal(app.render().input.value, '自分で入力');
  app.render().input.onChangeText('');
  app.account.user = { ...app.account.user, name: '更新した名前' };
  const page = app.render();
  assert.equal(page.input.value, '');
  page.button('部屋をつくる').onPress();
  assert.equal(app.entries[0].nickname, '');
});

test('guest and account users can override the name and room joining uses that same visible value', () => {
  const app = home();
  app.account.user = { id: 'account-1', name: 'アカウント名' };
  app.render().input.onChangeText('今回の名前');
  app.render().button('部屋に入る').onPress();
  app.render().code.onChangeText('123456');
  const page = app.render();
  page.button('参加する').onPress();
  assert.equal(app.entries[0].nickname, '今回の名前');
  assert.equal(app.entries[0].code, '123456');
  assert.equal(app.entries[0].joining, true);
  app.account.user = null;
  assert.equal(app.render().input.value, '今回の名前');
});

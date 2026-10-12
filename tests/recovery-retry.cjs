const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('../server/node_modules/socket.io');
const { io } = require('../client/node_modules/socket.io-client');
const session = { code: '123456', playerId: 'test-seat', token: 'synthetic-seat-token' };

function harness(socket, timers = {}) {
  const states = [], shown = [], destinations = [];
  let cleanup, saved = { ...session }, disconnects = 0;
  const leaving = { current: false };
  const source = fs.readFileSync(require.resolve('../client/src/hooks/useRoomRecovery.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function');
  const context = {
    useState: () => [false, (state) => states.push(state)],
    useEffect: (effect) => { cleanup = effect(); },
    useIsFocused: () => true,
    getSocket: timers.getSocket || (() => socket), disconnectSocket: () => disconnects++,
    getRoomSession: () => saved, clearRoomSession: () => { saved = null; },
    showRoom: (_, result) => shown.push(result), Alert: { alert() {} },
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
    ...timers.runtime,
  };
  vm.runInNewContext(source + '\nuseRoomRecovery(navigation, leaving);', {
    ...context, navigation: { reset: ({ routes }) => destinations.push(routes[0].name), isFocused: () => true }, leaving,
  });
  return { states, shown, destinations, leaving, cleanup: () => cleanup(),
    get saved() { return saved; }, get disconnects() { return disconnects; } };
}

function webRuntime() {
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = 'visible';
  return { window, document, runtime: { document,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window) } };
}

test('online wakes the actual retry loop, keeps the seat and still recovers a second disconnect', async () => {
  const server = http.createServer();
  const sockets = new Server(server);
  const resumes = [];
  const disconnectReasons = [];
  sockets.on('connection', socket => {
    socket.on('disconnect', reason => disconnectReasons.push(reason));
    socket.on('room:resume', (payload, ack) => { resumes.push(payload); ack({ ok: true }); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    reconnectionDelay: 5000, reconnectionDelayMax: 5000, randomizationFactor: 0,
    transports: ['websocket'], autoConnect: false,
  });
  const web = webRuntime(), h = harness(socket, web);
  const waitForResume = async count => {
    const started = Date.now();
    while (h.shown.length < count && Date.now() - started < 500) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.shown.length, count);
  };
  try {
    socket.connect(); await once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
    await waitForResume(1);
    let expected = 1;
    for (const trigger of [web.window, web.document]) {
      const gone = once(socket, 'disconnect'); socket.io.engine.close(); await gone;
      const returning = once(socket, 'connect', { signal: AbortSignal.timeout(1000) });
      trigger.dispatchEvent(new Event(trigger === web.window ? 'online' : 'visibilitychange'));
      await returning;
      await waitForResume(++expected);
    }
    assert.equal(h.shown.length, 3);
    assert(resumes.every(payload => JSON.stringify(payload) === JSON.stringify(session)));
    assert.equal(h.disconnects, 0); assert.deepEqual(h.saved, session);
    assert.equal(disconnectReasons.includes('client namespace disconnect'), false);
    h.cleanup();
    const gone = once(socket, 'disconnect'); socket.io.engine.close(); await gone;
    const engine = socket.io.engine;
    web.window.dispatchEvent(new Event('online'));
    assert.equal(socket.io.engine, engine, 'Unmounted screens must not wake a socket');
  } finally {
    h.cleanup(); socket.disconnect(); await new Promise(resolve => sockets.close(resolve));
  }
});

test('wake ignores connected, opening, hidden, transferred and explicitly left sockets', () => {
  const socket = fakeSocket(), web = webRuntime();
  let resets = 0;
  socket.disconnect = () => { resets++; return socket; };
  socket.connect = () => socket;
  const h = harness(socket, web);
  web.window.dispatchEvent(new Event('online')); assert.equal(resets, 0);
  socket.connected = false; socket.io.engine.readyState = 'opening';
  web.window.dispatchEvent(new Event('online')); assert.equal(resets, 0);
  socket.io.engine.readyState = 'closed'; web.document.visibilityState = 'hidden';
  web.document.dispatchEvent(new Event('visibilitychange')); assert.equal(resets, 0);
  web.document.visibilityState = 'visible'; socket.active = false;
  web.window.dispatchEvent(new Event('online')); assert.equal(resets, 0);
  socket.active = true; h.leaving.current = true;
  web.window.dispatchEvent(new Event('online')); assert.equal(resets, 0);
  h.cleanup();
});

test('configured client connects when either polling or WebSocket is blocked', async () => {
  const source = fs.readFileSync(require.resolve('../client/src/hooks/useSocket.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  for (const transport of ['websocket', 'polling']) {
    const server = http.createServer();
    const sockets = new Server(server, { transports: [transport] });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const socket = vm.runInNewContext(source + '\nconnectSocket();', {
      io, DEFAULT_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
    });
    try {
      await once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
      assert.equal(socket.io.engine.transport.name, transport);
    } finally { socket.disconnect(); await new Promise(resolve => sockets.close(resolve)); }
  }
});

test('room entry survives real transient handshake failures instead of stopping its retry loop', async () => {
  const source = fs.readFileSync(require.resolve('../client/src/hooks/useRoomEntry.js'), 'utf8')
    .split('export default function')[0].replace(/^import .*;\r?\n/gm, '');
  const wait = vm.runInNewContext(source + '\nwaitForConnection;', { setTimeout, clearTimeout });
  const server = http.createServer();
  let attempts = 0;
  const sockets = new Server(server, { allowRequest: (_, callback) => callback(null, ++attempts > 2) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    transports: ['websocket'], autoConnect: false, reconnectionDelay: 20, reconnectionDelayMax: 20,
  });
  const controller = new AbortController();
  try {
    const connected = wait(socket, controller.signal);
    socket.connect(); await connected;
    assert.equal(attempts, 3); assert.equal(socket.connected, true);
    assert.equal(socket.listeners('connect_error').length, 0);
  } finally { controller.abort(); socket.disconnect(); await new Promise(resolve => sockets.close(resolve)); }
});

test('production heartbeat tolerates a delayed pong and still detects permanent loss', { timeout: 58000 }, async () => {
  const source = fs.readFileSync(require.resolve('../server/src/index.js'), 'utf8');
  const capture = { ...require('node:dns') };
  const context = { require(name) {
    if (name === 'dotenv') return { config() {} };
    if (name === 'node:dns') return capture;
    if (name.startsWith('./')) return { registerSocketHandlers() {} };
    return require(require.resolve(name, { paths: [require.resolve('../server/src/index.js')] }));
  }, process, console, module: { exports: {} }, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  const { server, io: sockets } = context.module.exports;
  assert.equal(sockets.engine.opts.pingTimeout, 30000);
  assert.equal(sockets.engine.opts.pingInterval, 25000);
  sockets.engine.opts.pingInterval = 50;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, { transports: ['websocket'], reconnection: false });
  let timer, delayed = false;
  try {
    await once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
    const engine = socket.io.engine, send = engine._sendPacket.bind(engine);
    engine._sendPacket = (type, ...args) => {
      if (type === 'pong' && !delayed) {
        delayed = true; timer = setTimeout(() => send(type, ...args), 21000);
      } else send(type, ...args);
    };
    const serverEngine = sockets.sockets.sockets.get(socket.id).conn;
    await once(serverEngine, 'heartbeat', { signal: AbortSignal.timeout(24000) });
    assert(delayed); assert.equal(socket.connected, true);
    assert.equal(serverEngine.readyState, 'open');
    engine._sendPacket = (type, ...args) => { if (type !== 'pong') send(type, ...args); };
    const [reason] = await once(serverEngine, 'close', { signal: AbortSignal.timeout(32000) });
    assert.equal(reason, 'ping timeout');
    assert.equal(serverEngine.readyState, 'closed');
  } finally { clearTimeout(timer); socket.disconnect(); await new Promise(resolve => sockets.close(resolve)); }
});

function fakeSocket() {
  const listeners = new Map(), callbacks = [];
  return { connected: true, active: true, id: 'connection-1', io: { engine: {} }, callbacks,
    on: (name, fn) => listeners.set(name, fn), off: (name) => listeners.delete(name),
    fire: (name) => listeners.get(name)?.(),
    timeout: () => ({ emit: (_, __, callback) => callbacks.push(callback) }),
  };
}

test('slow ACK on a live transport retries in this screen with the same seat', async () => {
  const server = http.createServer();
  const sockets = new Server(server);
  let attempts = 0;
  const delays = [];
  sockets.on('connection', (socket) => socket.on('room:resume', (payload, ack) => {
    assert.deepEqual(payload, session);
    attempts++;
    if (attempts === 1) delays.push(setTimeout(() => ack({ ok: true, stale: true }), 13000));
    else ack({ ok: true, restored: true });
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, { autoConnect: false, transports: ['websocket'] });
  const h = harness(socket);
  try {
    socket.connect();
    const started = Date.now();
    while (!h.shown.length && Date.now() - started < 15000) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(attempts, 2);
    assert.equal(socket.connected, true);
    assert.equal(h.disconnects, 0);
    assert.equal(h.destinations.length, 0);
    assert.deepEqual(h.saved, session);
    assert.equal(h.shown[0].restored, true);
    assert.equal(h.states.at(-1), false);
    assert.equal(h.states.slice(0, -1).every(Boolean), true);
  } finally {
    h.cleanup(); socket.disconnect(); delays.forEach(clearTimeout);
    await new Promise((resolve) => sockets.close(resolve));
  }
});

test('temporary save error retries; authorization expiry clears the bookmark', () => {
  const socket = fakeSocket(); const pending = [];
  const h = harness(socket, { setTimeout: (fn) => { pending.push(fn); return fn; }, clearTimeout() {} });
  socket.fire('connect');
  socket.callbacks[0](null, { ok: false, error: 'temporary save failure' });
  assert.equal(h.disconnects, 0); assert.deepEqual(h.saved, session);
  pending.shift()();
  socket.callbacks[1](null, { ok: false, error: 'expired', rejoinUnavailable: true });
  assert.equal(h.saved, null); assert.equal(h.disconnects, 1);
  assert.deepEqual(h.destinations, ['Home']); h.cleanup();
});

test('old ACK cannot overwrite a newer connection and unmounted screens never retry', () => {
  const socket = fakeSocket(); const h = harness(socket);
  socket.fire('connect');
  socket.connected = false; socket.fire('disconnect');
  socket.id = 'connection-2'; socket.connected = true; socket.fire('connect');
  socket.callbacks[0](null, { ok: true, stale: true });
  assert.equal(h.shown.length, 0);
  socket.callbacks[1](null, { ok: true, current: true });
  assert.equal(h.shown[0].current, true);
  h.cleanup(); socket.callbacks[1](new Error('timeout'));
  assert.equal(h.disconnects, 0);
});

test('explicit leave and server takeover cannot automatically reclaim a seat', () => {
  const socket = fakeSocket(); const h = harness(socket);
  socket.fire('connect'); h.leaving.current = true;
  socket.callbacks[0](null, { ok: true }); socket.fire('connect');
  assert.equal(h.shown.length, 0); assert.equal(socket.callbacks.length, 1); h.cleanup();
  const other = fakeSocket(); const transferred = harness(other);
  other.active = false; other.connected = false; other.fire('disconnect');
  assert.deepEqual(transferred.destinations, ['Home']);
  assert.deepEqual(transferred.saved, session);
  other.connected = true; other.fire('connect');
  assert.equal(other.callbacks.length, 0); transferred.cleanup();
});

test('a replaced socket cannot disconnect the current connection or change its navigation', () => {
  const old = fakeSocket();
  let current = old;
  const h = harness(old, { getSocket: () => current });
  old.fire('connect');
  current = fakeSocket();
  old.active = false; old.connected = false; old.fire('disconnect');
  old.callbacks[0](null, { ok: false, rejoinUnavailable: true });
  assert.equal(h.disconnects, 0);
  assert.deepEqual(h.destinations, []);
  assert.deepEqual(h.saved, session);
  h.cleanup();
});

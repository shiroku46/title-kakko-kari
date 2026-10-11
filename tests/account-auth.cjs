const { test } = require('node:test');
const assert = require('node:assert/strict');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (error) { if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error; }
const { authOptions, accountConfiguration } = require('../server/src/accountAuth');
const { createRequire } = require('node:module');
const requireServer = createRequire(require.resolve('../server/package.json'));
const env = { DATABASE_URL: 'postgres://unused-test-database', BETTER_AUTH_URL: 'http://localhost:3456',
  BETTER_AUTH_SECRET: 'synthetic-local-only-test-secret-32-characters',
  SMTP_HOST: 'mail.test.invalid', SMTP_PORT: '587', SMTP_USER: 'test', SMTP_PASSWORD: 'synthetic', SMTP_FROM: 'game@test.invalid' };

test('missing/invalid provider configuration never advertises a usable login', () => {
  assert.deepEqual(accountConfiguration({}), { ready: false, email: false, discord: false });
  assert.equal(accountConfiguration({ ...env, BETTER_AUTH_SECRET: '' }).ready, false);
  assert.equal(accountConfiguration({ ...env, SMTP_PORT: 'NaN' }).email, false);
  assert.equal(accountConfiguration({ ...env, DISCORD_CLIENT_ID: 'test-app' }).discord, false);
  assert.equal(accountConfiguration({ ...env, DISCORD_CLIENT_ID: 'test-app', DISCORD_CLIENT_SECRET: 'synthetic' }).discord, true);
});

test('real Better Auth handlers verify email, hash password, persist cookie session and reject unauthorized update',
  { skip: !DatabaseSync && 'node:sqlite requires Node22.5+; config tests still run on Node20' }, async () => {
  const database = new DatabaseSync(':memory:');
  const mailbox = [];
  const options = await authOptions(env, database, async (message) => mailbox.push(message));
  const { getMigrations } = await import(requireServer.resolve('better-auth/db/migration'));
  const { betterAuth } = await import(requireServer.resolve('better-auth'));
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  const request = (path, body, cookie) => auth.handler(new Request(env.BETTER_AUTH_URL + '/api/auth/' + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: env.BETTER_AUTH_URL,
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  try {
    const password = 'synthetic test password';
    const signup = await request('sign-up/email', { email: 'person@test.invalid', password, name: '本人' });
    assert.equal(signup.status, 200);
    assert.equal(mailbox.length, 1);
    const stored = database.prepare('SELECT password FROM title_auth_account').get();
    assert.notEqual(stored.password, password);
    const refused = await request('sign-in/email', { email: 'person@test.invalid', password });
    assert.equal(refused.status, 403);
    const verificationUrl = mailbox[0].text.split('\n').at(-1);
    const verified = await auth.handler(new Request(verificationUrl));
    assert([200,302].includes(verified.status));
    const login = await request('sign-in/email', { email: 'person@test.invalid', password, rememberMe: true });
    assert.equal(login.status, 200);
    const setCookies = login.headers.getSetCookie();
    assert(setCookies.some(value => value.includes('HttpOnly') && value.includes('Max-Age=')));
    const cookie = setCookies.map(value => value.split(';')[0]).join('; ');
    const session = await request('get-session', null, cookie);
    const data = await session.json();
    assert.equal(data.user.name, '本人'); assert.equal(data.user.emailVerified, true);
    assert.equal((await request('update-user', { name: '盗まれた名前' })).status, 401);
    assert.equal((await request('update-user', { name: '変更後', icon: '<script>' }, cookie)).status, 400);
    assert.equal((await request('update-user', { name: '変更後', icon: '🦊' }, cookie)).status, 200);
    const after = await (await request('get-session', null, cookie)).json();
    assert.equal(after.user.name, '変更後'); assert.equal(after.user.icon, '🦊');
    const foreign = await auth.handler(new Request(env.BETTER_AUTH_URL + '/api/auth/update-user', {
      method: 'POST', headers: { Origin: 'https://untrusted.invalid', Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '別サイト' }),
    }));
    assert.equal(foreign.status, 403);
    assert.equal((await request('sign-out', {}, cookie)).status, 200);
    assert.equal(await (await request('get-session', null, cookie)).json(), null);
  } finally { database.close(); }
});

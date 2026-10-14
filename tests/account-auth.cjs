const { test } = require('node:test');
const assert = require('node:assert/strict');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (error) { if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error; }
const { authOptions, accountConfiguration } = require('../server/src/accountAuth');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
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

test('real Discord OAuth enforces state/origin, cancellation/failure, minimal scopes, logout and same-user re-login',
  { skip: !DatabaseSync }, async t => {
  const database = new DatabaseSync(':memory:');
  const oauthEnv = { DATABASE_URL: env.DATABASE_URL, BETTER_AUTH_URL: 'https://game.example',
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET, DISCORD_CLIENT_ID: 'synthetic-app', DISCORD_CLIENT_SECRET: 'synthetic-only' };
  const options = await authOptions(oauthEnv, database, async () => assert.fail('Discord must not send mail'));
  assert.equal(options.rateLimit.enabled, true);
  options.rateLimit = { enabled: false }; // Exercise many failure branches without waiting for the production throttle.
  const { getMigrations } = await import(pathToFileURL(requireServer.resolve('better-auth/db/migration')).href);
  const { betterAuth } = await import(pathToFileURL(requireServer.resolve('better-auth')).href);
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  const originalFetch = global.fetch;
  let failExchange = false, externalCalls = 0;
  global.fetch = async (input, init) => {
    const url = decodeURIComponent(String(input?.url || input));
    externalCalls++;
    if (url === 'https://discord.com/api/oauth2/token') {
      return Response.json(failExchange ? { error: 'invalid_grant' } : {
        access_token: 'synthetic-local-oauth-token', token_type: 'Bearer', expires_in: 3600, scope: 'identify email',
      }, { status: failExchange ? 400 : 200 });
    }
    if (url === 'https://discord.com/api/users/@me') return Response.json({ id: '123456789012345678',
      username: 'discord-player', global_name: '本人', email: 'discord@test.invalid', verified: true, avatar: null, discriminator: '0' });
    assert.fail('Unexpected external OAuth request');
  };
  t.after(() => { global.fetch = originalFetch; database.close(); });
  const request = (path, body, cookie, origin = oauthEnv.BETTER_AUTH_URL) => auth.handler(new Request(`${oauthEnv.BETTER_AUTH_URL}/api/auth/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  const cookies = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function start() {
    const response = await request('sign-in/social', { provider: 'discord', callbackURL: `${oauthEnv.BETTER_AUTH_URL}/`,
      errorCallbackURL: `${oauthEnv.BETTER_AUTH_URL}/?account_error=1` });
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    assert.equal(url.origin, 'https://discord.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://game.example/api/auth/callback/discord');
    assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['email', 'identify']);
    assert(url.searchParams.get('state'));
    assert(response.headers.getSetCookie().some(cookie => /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
    return { state: url.searchParams.get('state'), cookie: cookies(response) };
  }
  assert.equal((await request('sign-in/social', { provider: 'discord' }, 'untrusted=1', 'https://evil.invalid')).status, 403);
  assert.equal((await request('sign-in/social', { provider: 'discord', callbackURL: 'https://evil.invalid' })).status, 403);
  const missing = await request('callback/discord?code=synthetic');
  assert.equal(missing.status, 302); assert.match(missing.headers.get('location'), /account_error=1/);
  const invalid = await start();
  assert.equal((await request(`callback/discord?state=wrong&code=synthetic`, null, invalid.cookie)).status, 302);
  assert.equal(externalCalls, 0);
  const cancelled = await start();
  const cancel = await request(`callback/discord?state=${cancelled.state}&error=access_denied`, null, cancelled.cookie);
  assert.equal(cancel.status, 302); assert.match(cancel.headers.get('location'), /account_error=1/);
  assert.equal(externalCalls, 0);
  failExchange = true;
  const failed = await start();
  const failure = await request(`callback/discord?state=${failed.state}&code=synthetic`, null, failed.cookie);
  assert.equal(failure.status, 302); assert.match(failure.headers.get('location'), /account_error=1/);
  failExchange = false;
  const first = await start();
  const callback = await request(`callback/discord?state=${first.state}&code=synthetic`, null, first.cookie);
  assert.equal(callback.status, 302); assert.equal(callback.headers.get('location'), `${oauthEnv.BETTER_AUTH_URL}/`);
  const sessionCookie = cookies(callback);
  const session = await (await request('get-session', null, sessionCookie)).json();
  assert.equal(session.user.name, '本人');
  assert.equal((await request('update-user', { name: '変更後', icon: '🐈' }, sessionCookie)).status, 200);
  assert.equal((await request('sign-out', {}, sessionCookie)).status, 200);
  assert.equal(await (await request('get-session', null, sessionCookie)).json(), null);
  const second = await start();
  const relogin = await request(`callback/discord?state=${second.state}&code=synthetic`, null, second.cookie);
  const restored = await (await request('get-session', null, cookies(relogin))).json();
  assert.equal(restored.user.id, session.user.id); assert.equal(restored.user.name, '変更後');
  assert.equal(restored.user.icon, '🐈');
  assert.equal(database.prepare('SELECT count(*) AS n FROM title_auth_user').get().n, 1);
});

test('real Better Auth handlers verify email, hash password, persist cookie session and reject unauthorized update',
  { skip: !DatabaseSync && 'node:sqlite requires Node22.5+; config tests still run on Node20' }, async () => {
  const database = new DatabaseSync(':memory:');
  const mailbox = [];
  const options = await authOptions(env, database, async (message) => mailbox.push(message));
  const { getMigrations } = await import(pathToFileURL(requireServer.resolve('better-auth/db/migration')).href);
  const { betterAuth } = await import(pathToFileURL(requireServer.resolve('better-auth')).href);
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

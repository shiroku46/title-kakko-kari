const ICONS = ['🐈', '🐕', '🦊', '🐼', '🐸', '🐧'];

function accountConfiguration(env = process.env) {
  const baseURL = env.BETTER_AUTH_URL;
  let validURL = false;
  try { validURL = /^https?:$/.test(new URL(baseURL).protocol) && !new URL(baseURL).username && !new URL(baseURL).password; } catch (_) {}
  const signingReady = Boolean(env.DATABASE_URL?.trim() && env.BETTER_AUTH_SECRET?.length >= 32 && validURL);
  const email = Boolean(signingReady && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM &&
    Number.isInteger(Number(env.SMTP_PORT)) && Number(env.SMTP_PORT) > 0 && Number(env.SMTP_PORT) <= 65535);
  const discord = Boolean(signingReady && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
  return { ready: email || discord, email, discord };
}

async function authOptions(env, database, sendMail) {
  const { APIError } = await import('better-auth/api');
  const configuration = accountConfiguration(env);
  const validateProfile = async (user) => {
    if (user.icon != null && !ICONS.includes(user.icon)) throw new APIError('BAD_REQUEST', { message: 'アイコンを選択してください。' });
    return { data: user };
  };
  return {
    database, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    logger: { disabled: true },
    user: { modelName: 'title_auth_user', additionalFields: { icon: { type: 'string', required: false, defaultValue: '🐈' } } },
    session: { modelName: 'title_auth_session', expiresIn: 30 * 86400, updateAge: 86400 },
    account: { modelName: 'title_auth_account', accountLinking: { enabled: true, trustedProviders: [] } },
    verification: { modelName: 'title_auth_verification' },
    databaseHooks: { user: { create: { before: validateProfile }, update: { before: validateProfile } } },
    emailAndPassword: { enabled: configuration.email, requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendMail({ to: user.email, subject: 'タイトルカッコカリのパスワード再設定', text: `次のリンクからパスワードを再設定してください。\n${url}` }),
    },
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendMail({ to: user.email, subject: 'タイトルカッコカリのメールアドレス確認', text: `次のリンクからメールアドレスを確認してください。\n${url}` }),
    },
    socialProviders: configuration.discord ? { discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET } } : {},
    rateLimit: { enabled: true },
  };
}

async function initializeAccountAuth() {
  const configuration = accountConfiguration();
  if (!configuration.ready) return { configuration };
  const { Pool, neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  const database = new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
  database.on('error', () => { /* Never print a private DB connection error. */ });
  const transport = configuration.email ? require('nodemailer').createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: Number(process.env.SMTP_PORT) === 465,
    requireTLS: Number(process.env.SMTP_PORT) !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
  }) : null;
  try {
  if (transport) await transport.verify();
  const options = await authOptions(process.env, database, (message) => transport.sendMail({ from: process.env.SMTP_FROM, ...message }));
  const { getMigrations } = await import('better-auth/db/migration');
  const migrations = await getMigrations(options);
  if (migrations.unsafeChanges.length || migrations.schemaProblems.length) throw new Error('認証のDB構成を確認してください。');
  await migrations.runMigrations();
  // These tables are server-only, including email, password hashes and sessions.
  for (const table of ['title_auth_user', 'title_auth_session', 'title_auth_account', 'title_auth_verification']) {
    await database.query(`REVOKE ALL ON ${table} FROM PUBLIC`);
  }
  const { betterAuth } = await import('better-auth');
  const { toNodeHandler } = await import('better-auth/node');
  const auth = betterAuth(options);
  return { configuration, handler: toNodeHandler(auth), close: () => { transport?.close(); return database.end(); } };
  } catch {
    transport?.close(); await database.end();
    throw new Error('認証設定または接続先を確認してください。');
  }
}
module.exports = { accountConfiguration, authOptions, initializeAccountAuth };

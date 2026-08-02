require('dotenv').config();

// Render's Node runtime can receive working inbound traffic while outbound
// Undici/fetch attempts fail when DNS returns an unreachable IPv6 address
// first. Prefer IPv4 before importing modules that construct Supabase clients
// or perform any other outbound request.
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { registerSocketHandlers } = require('./socket');

const app = express();
const server = http.createServer(app);

const release = (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 12);
function runtimeInfo() {
  return {
    release,
    node: process.version,
    dnsOrder: dns.getDefaultResultOrder(),
  };
}

// ALLOWED_ORIGINS: カンマ区切りで複数オリジンを指定可能。未設定時は全オリジン許可。
// 例: ALLOWED_ORIGINS=https://example.vercel.app,http://localhost:8081
const rawOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawOrigins
  ? rawOrigins.split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const corsOrigin = allowedOrigins || '*';

function isAllowedOrigin(origin) {
  // Expo/native clients and non-browser tools may not send Origin.
  if (!origin) return true;
  // Keep the existing MVP default when no allowlist is configured.
  if (!allowedOrigins) return true;
  return allowedOrigins.includes(origin);
}

app.use(cors({ origin: corsOrigin }));

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
  // Browser CORS headers alone do not protect direct WebSocket upgrades.
  // Apply the same allowlist at the Engine.IO request boundary while
  // preserving originless Expo/native clients.
  allowRequest: (req, callback) => {
    callback(null, isAllowedOrigin(req.headers.origin));
  },
});

// ヘルスチェック用エンドポイント。commit・runtime情報だけを返し、Secretは含めない。
app.get('/health', (req, res) => res.json({ status: 'ok', ...runtimeInfo() }));

// Render上のoutbound HTTPSを安全に診断する。URL、header、raw message、stack、
// 環境変数値は返さず、HTTP statusまたは標準化されたerror名/codeだけを返す。
app.get('/health/network', async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      'https://ja.wikipedia.org/api/rest_v1/page/random/summary',
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'title-kakko-kari-network-check/1.0' },
      }
    );
    const outbound = { ok: response.ok, httpStatus: response.status };
    // This diagnostic needs only headers/status. Explicitly dispose the body
    // before clearing the abort timer so a stalled body cannot retain sockets.
    if (response.body) await response.body.cancel();
    return res.status(response.ok ? 200 : 502).json({
      status: response.ok ? 'ok' : 'error',
      ...runtimeInfo(),
      outbound,
    });
  } catch (error) {
    const errorName = typeof error?.name === 'string' ? error.name : 'Error';
    const errorCode = typeof error?.cause?.code === 'string' ? error.cause.code : null;
    return res.status(503).json({
      status: 'error',
      ...runtimeInfo(),
      outbound: { ok: false, errorName, errorCode },
    });
  } finally {
    clearTimeout(timeout);
  }
});

function sanitizedErrorCode(error) {
  return typeof error?.code === 'string'
    ? error.code
    : (typeof error?.cause?.code === 'string' ? error.cause.code : null);
}

async function lookupIpv4Bounded(hostname, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      dns.promises.lookup(hostname, { family: 4 }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('DNS lookup timed out');
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Supabase接続の設定・DNS・HTTP段階だけを安全に切り分ける。
// URL、hostname、key、headers、response body、raw error message、stackは返さない。
app.get('/health/supabase', async (req, res) => {
  const rawUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const config = {
    urlConfigured: typeof rawUrl === 'string' && rawUrl.trim().length > 0,
    keyConfigured: typeof serviceKey === 'string' && serviceKey.trim().length > 0,
    urlValidHttps: false,
  };

  let parsedUrl = null;
  if (config.urlConfigured) {
    try {
      parsedUrl = new URL(rawUrl);
      config.urlValidHttps = parsedUrl.protocol === 'https:' && Boolean(parsedUrl.hostname);
    } catch (_) {
      parsedUrl = null;
    }
  }

  const evidence = {
    status: 'error',
    ...runtimeInfo(),
    config,
    dns: { ok: false, family: null, errorCode: null },
    request: { ok: false, httpStatus: null, errorName: null, errorCode: null },
  };

  if (!config.urlValidHttps) {
    evidence.request.errorCode = 'INVALID_CONFIG';
    return res.status(503).json(evidence);
  }

  try {
    const lookup = await lookupIpv4Bounded(parsedUrl.hostname, 5000);
    evidence.dns = { ok: true, family: lookup.family, errorCode: null };
  } catch (error) {
    evidence.dns.errorCode = sanitizedErrorCode(error);
    evidence.request.errorCode = 'DNS_FAILED';
    return res.status(503).json(evidence);
  }

  if (!config.keyConfigured) {
    evidence.request.errorCode = 'INVALID_CONFIG';
    return res.status(503).json(evidence);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const endpoint = new URL('/rest/v1/rooms?select=id&limit=1', parsedUrl);
    const response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
    evidence.request = {
      ok: response.ok,
      httpStatus: response.status,
      errorName: null,
      errorCode: null,
    };
    if (response.body) await response.body.cancel();
    evidence.status = response.ok ? 'ok' : 'error';
    return res.status(response.ok ? 200 : 502).json(evidence);
  } catch (error) {
    evidence.request = {
      ok: false,
      httpStatus: null,
      errorName: typeof error?.name === 'string' ? error.name : 'Error',
      errorCode: sanitizedErrorCode(error),
    };
    return res.status(503).json(evidence);
  } finally {
    clearTimeout(timeout);
  }
});

// Wikipedia ランダム記事取得エンドポイント（フロントから直接呼び出すためCORSが通るようにサーバー経由にする）
app.get('/api/random-work', async (req, res) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch('https://ja.wikipedia.org/api/rest_v1/page/random/summary', { signal: controller.signal });
      const data = await r.json();
      const title = (data.title || '').trim();
      const synopsis = (data.extract || '').trim();
      if (synopsis.length < 100) continue;
      // タイトル文字列をあらすじからマスク（ネタバレ防止）
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const maskedSynopsis = synopsis.replace(new RegExp(escaped, 'g'), '■■■');
      return res.json({ ok: true, title, synopsis: maskedSynopsis });
    } catch (_) {
      // リトライ
    } finally {
      clearTimeout(timeout);
    }
  }
  res.json({ ok: false, error: '記事を取得できませんでした。再試行してください。' });
});

// Socket.io ハンドラーを登録
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] ポート ${PORT} で起動しました`);
});

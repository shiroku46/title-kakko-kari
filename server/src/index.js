require('dotenv').config();

// Render's Node runtime can receive working inbound traffic while outbound
// Undici/fetch attempts fail when DNS returns an unreachable IPv6 address
// first. Prefer IPv4 before importing modules that perform outbound requests.
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { registerSocketHandlers } = require('./socket');
const { startQuestionCollection, stopQuestionCollection,
  getQuestionCollectionStatus } = require('./questions');

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

// 作品名・資料URL・Secretを含めず、自動収集の稼働状態も確認できる。
app.get('/health', (req, res) => res.json({
  status: 'ok', ...runtimeInfo(), questionCollection: getQuestionCollectionStatus(),
}));

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

// Answers are now delivered only to the current questioner via a private ack.
app.get('/api/random-work', (_req, res) => {
  return res.status(404).json({ ok: false, error: '出題者の画面から出題の補助を使ってください。' });
});

// Socket.io ハンドラーを登録
registerSocketHandlers(io);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`[Server] ポート ${PORT} で起動しました`);
    startQuestionCollection();
  });
  server.on('close', stopQuestionCollection);
}

module.exports = { server, io };

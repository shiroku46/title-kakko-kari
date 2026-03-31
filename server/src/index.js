require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { registerSocketHandlers } = require('./socket');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // MVP段階では全て許可。本番環境では Expo アプリのオリジンに絞ること
    methods: ['GET', 'POST']
  }
});

// ヘルスチェック用エンドポイント
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Wikipedia ランダム記事取得エンドポイント（フロントから直接呼び出すためCORSが通るようにサーバー経由にする）
app.get('/api/random-work', async (req, res) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch('https://ja.wikipedia.org/api/rest_v1/page/random/summary');
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

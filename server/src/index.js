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

// Socket.io ハンドラーを登録
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] ポート ${PORT} で起動しました`);
});

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Map();

const SERVER_PING_INTERVAL = 25000;
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('WS: terminating dead connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, SERVER_PING_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  let userId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth') {
        const decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
        userId = decoded.id.toString();
        const existing = clients.get(userId);
        if (existing && existing !== ws) existing.terminate();
        clients.set(userId, ws);
        ws.send(JSON.stringify({ type: 'auth_ok', userId }));
        console.log(`WS: user ${userId} connected`);
        return;
      }
      if (!userId) { ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' })); return; }
      if (msg.type === 'ping') { ws.isAlive = true; ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (msg.type === 'message') {
        const Message = require('./models/Message');
        const conversationId = [userId, msg.to].sort().join('_');
        const saved = await Message.create({ conversationId, from: userId, to: msg.to, type: msg.msgType || 'text', text: msg.text || '', payload: msg.payload || null });
        const outgoing = { type: 'message', _id: saved._id.toString(), conversationId, from: userId, to: msg.to, msgType: saved.type, text: saved.text, payload: saved.payload, createdAt: saved.createdAt };
        const recipientWs = clients.get(msg.to);
        if (recipientWs && recipientWs.readyState === 1) recipientWs.send(JSON.stringify(outgoing));
        ws.send(JSON.stringify({ ...outgoing, type: 'message_sent' }));
      }
    } catch (e) {
      console.error('WS message error:', e.message);
      try { ws.send(JSON.stringify({ type: 'error', message: e.message })); } catch {}
    }
  });

  ws.on('close', () => {
    if (userId && clients.get(userId) === ws) { clients.delete(userId); console.log(`WS: user ${userId} disconnected`); }
  });
  ws.on('error', (e) => { console.error('WS error:', e.message); ws.terminate(); });
});

// ── Express Middleware ────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', process.env.FRONTEND_URL].filter(Boolean),
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/wrap', require('./routes/wrap'));
app.use('/api/mood', require('./routes/mood'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/listening', require('./routes/listening'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/sessions', require('./routes/sessions'));
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── MongoDB connect — NO scheduler ───────────────────────────────────────────
// REMOVED: startScheduler() — wrap generation is now 100% user-triggered from frontend
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(e => console.error('MongoDB error:', e));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server + WS running on port ${PORT}`));

module.exports = { app, wss, clients };
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app); // HTTP server wraps express

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// Map: userId (string) → WebSocket connection
// When a message is sent, we look up the recipient's socket and push it live
const clients = new Map();

wss.on('connection', (ws, req) => {
  let userId = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // First message must be { type: 'auth', token: JWT }
      if (msg.type === 'auth') {
        const decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
        userId = decoded.id.toString();
        clients.set(userId, ws);
        ws.send(JSON.stringify({ type: 'auth_ok', userId }));
        console.log(`WS: user ${userId} connected`);
        return;
      }

      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }

      // { type: 'message', to: userId, text, msgType, payload }
      if (msg.type === 'message') {
        const Message = require('./models/Message');

        const conversationId = [userId, msg.to].sort().join('_');
        const saved = await Message.create({
          conversationId,
          from: userId,
          to: msg.to,
          type: msg.msgType || 'text',
          text: msg.text || '',
          payload: msg.payload || null,
        });

        const outgoing = {
          type: 'message',
          _id: saved._id.toString(),
          conversationId,
          from: userId,
          to: msg.to,
          msgType: saved.type,
          text: saved.text,
          payload: saved.payload,
          createdAt: saved.createdAt,
        };

        // Send to recipient if online
        const recipientWs = clients.get(msg.to);
        if (recipientWs && recipientWs.readyState === 1) {
          recipientWs.send(JSON.stringify(outgoing));
        }

        // Echo back to sender with the saved _id and timestamp
        ws.send(JSON.stringify({ ...outgoing, type: 'message_sent' }));
      }

    } catch (e) {
      console.error('WS message error:', e.message);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('close', () => {
    if (userId) {
      clients.delete(userId);
      console.log(`WS: user ${userId} disconnected`);
    }
  });

  ws.on('error', (e) => console.error('WS error:', e.message));
});

// ── Express Middleware ────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/wrap', require('./routes/wrap'));
app.use('/api/mood', require('./routes/mood'));
app.use('/api/messages', require('./routes/messages'));

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(e => console.error('MongoDB error:', e));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server + WS running on port ${PORT}`));

module.exports = { app, wss, clients };
/**
 * Local API + static UI for the Messaging Platform SDK (brand) workspace.
 * Reference: https://developers.liveperson.com/messaging-platform-sdk-overview.html
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const lp = require('./lib/lpWorkspace');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '512kb' }));

const sseClients = new Set();

function broadcastSse(topic, data) {
  const payload = `data: ${JSON.stringify({ topic, data, t: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

lp.setBroadcaster(broadcastSse);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'messaging-platform-demo', time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ success: true, data: lp.getStatus() });
});

app.get('/api/connection/hints', (req, res) => {
  res.json({ success: true, data: lp.getConnectionHints() });
});

app.post('/api/connection/open', async (req, res) => {
  try {
    const result = await lp.connect(req.body && typeof req.body === 'object' ? req.body : {});
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/connection/close', async (req, res) => {
  try {
    const result = await lp.disconnect();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) {
    res.flushHeaders();
  }
  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ topic: 'hello', data: { client: 'sse' }, t: Date.now() })}\n\n`);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.get('/api/meta/participant-roles', (req, res) => {
  res.json({ success: true, data: lp.participantRoles() });
});

app.get('/api/meta/chat-states', (req, res) => {
  res.json({ success: true, data: lp.chatStates() });
});

app.get('/api/conversations', (req, res) => {
  try {
    res.json({ success: true, data: lp.listConversations() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const data = await lp.getConversationSnapshot(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/join', async (req, res) => {
  try {
    const role = (req.body && req.body.role) || 'ASSIGNED_AGENT';
    const data = await lp.joinConversation(req.params.id, role);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const text = req.body && req.body.text;
    const data = await lp.sendMessage(req.params.id, text);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/transfer', async (req, res) => {
  try {
    const { skillId, agentId } = req.body || {};
    const data = await lp.transferConversation(req.params.id, { skillId, agentId });
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/leave', async (req, res) => {
  try {
    const data = await lp.leaveConversation(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/close', async (req, res) => {
  try {
    const mode = (req.body && req.body.mode) || 'full';
    const data = await lp.closeConversation(req.params.id, mode);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/typing', async (req, res) => {
  try {
    const state = (req.body && req.body.state) || 'COMPOSING';
    const data = await lp.setDialogChatState(req.params.id, state);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/history', async (req, res) => {
  try {
    const data = await lp.loadFullHistory(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/messages/:sequence/accept', async (req, res) => {
  try {
    const data = await lp.acceptMessage(req.params.id, req.params.sequence);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/messages/:sequence/read', async (req, res) => {
  try {
    const data = await lp.readMessage(req.params.id, req.params.sequence);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/agent/online', async (req, res) => {
  try {
    const data = await lp.setAgentStateOnline();
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/agent/availability', async (req, res) => {
  try {
    const agentState = (req.body && req.body.agentState) || 'ONLINE';
    const data = await lp.setAgentAvailability(agentState);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/meta/agent-states', (req, res) => {
  res.json({ success: true, data: lp.agentStates() });
});

app.post('/api/rings/subscribe', async (req, res) => {
  try {
    const data = await lp.createRoutingTaskSubscription();
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/rings', (req, res) => {
  res.json({ success: true, data: lp.listRings() });
});

app.post('/api/rings/:ringId/accept', async (req, res) => {
  try {
    const data = await lp.acceptRing(req.params.ringId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/rings/:ringId/reject', async (req, res) => {
  try {
    const data = await lp.rejectRing(req.params.ringId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Messaging Platform demo UI: http://127.0.0.1:${PORT}`);
});

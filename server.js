/**
 * Local API + static UI for the Messaging Platform SDK (brand) workspace.
 * Reference: https://developers.liveperson.com/messaging-platform-sdk-overview.html
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const workspaceRegistry = require('./lib/workspaceRegistry');
const { attachApiDebugLogging } = require('./lib/apiDebugLog');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '512kb' }));
attachApiDebugLogging(app);
app.use(cookieParser());
app.use(workspaceRegistry.sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'messaging-platform-demo', time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ success: true, data: req.workspace.getStatus() });
});

app.get('/api/connection/hints', (req, res) => {
  res.json({ success: true, data: req.workspace.getConnectionHints() });
});

app.post('/api/connection/open', async (req, res) => {
  try {
    const result = await req.workspace.connect(req.body && typeof req.body === 'object' ? req.body : {});
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/connection/close', async (req, res) => {
  try {
    const result = await req.workspace.disconnect();
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
  workspaceRegistry.addSseClient(req.sessionId, res, req);
  res.write(`data: ${JSON.stringify({ topic: 'hello', data: { client: 'sse' }, t: Date.now() })}\n\n`);
});

app.get('/api/meta/participant-roles', (req, res) => {
  res.json({ success: true, data: req.workspace.participantRoles() });
});

app.get('/api/meta/chat-states', (req, res) => {
  res.json({ success: true, data: req.workspace.chatStates() });
});

app.get('/api/meta/transfer-skills', async (req, res) => {
  try {
    let conversationSkillId = null;
    const cid = req.query.conversationId;
    if (cid) {
      try {
        const snap = await req.workspace.getConversationSnapshot(cid);
        if (snap && snap.skill && snap.skill.skillId != null && snap.skill.skillId !== '') {
          conversationSkillId = String(snap.skill.skillId);
        }
      } catch (_) {
        /* Conversation may no longer be on this subscription after transfer/leave */
      }
    }
    const data = await req.workspace.resolveTransferSkillsCatalog(conversationSkillId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/conversations', (req, res) => {
  try {
    res.json({ success: true, data: req.workspace.listConversations() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const data = await req.workspace.getConversationSnapshot(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/join', async (req, res) => {
  try {
    const role = (req.body && req.body.role) || 'ASSIGNED_AGENT';
    const data = await req.workspace.joinConversation(req.params.id, role);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  try {
    const text = req.body && req.body.text;
    const data = await req.workspace.sendMessage(req.params.id, text);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/transfer', async (req, res) => {
  try {
    const { skillId, agentId } = req.body || {};
    const data = await req.workspace.transferConversation(req.params.id, { skillId, agentId });
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/leave', async (req, res) => {
  try {
    const data = await req.workspace.leaveConversation(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/close', async (req, res) => {
  try {
    const mode = (req.body && req.body.mode) || 'full';
    const data = await req.workspace.closeConversation(req.params.id, mode);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/typing', async (req, res) => {
  try {
    const state = (req.body && req.body.state) || 'COMPOSING';
    const data = await req.workspace.setDialogChatState(req.params.id, state);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/history', async (req, res) => {
  try {
    const data = await req.workspace.loadFullHistory(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/messages/:sequence/accept', async (req, res) => {
  try {
    const data = await req.workspace.acceptMessage(req.params.id, req.params.sequence);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/conversations/:id/messages/:sequence/read', async (req, res) => {
  try {
    const data = await req.workspace.readMessage(req.params.id, req.params.sequence);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/agent/online', async (req, res) => {
  try {
    const data = await req.workspace.setAgentStateOnline();
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/agent/availability', async (req, res) => {
  try {
    const agentState = (req.body && req.body.agentState) || 'ONLINE';
    const data = await req.workspace.setAgentAvailability(agentState);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/meta/agent-states', (req, res) => {
  res.json({ success: true, data: req.workspace.agentStates() });
});

app.post('/api/rings/subscribe', async (req, res) => {
  try {
    const data = await req.workspace.createRoutingTaskSubscription();
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/rings', (req, res) => {
  res.json({ success: true, data: req.workspace.listRings() });
});

app.post('/api/rings/:ringId/accept', async (req, res) => {
  try {
    const data = await req.workspace.acceptRing(req.params.ringId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/rings/:ringId/reject', async (req, res) => {
  try {
    const data = await req.workspace.rejectRing(req.params.ringId);
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

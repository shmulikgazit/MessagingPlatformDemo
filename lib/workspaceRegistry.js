'use strict';

const crypto = require('crypto');
const { createWorkspaceRuntime } = require('./lpWorkspace');

const COOKIE_NAME = 'mpdemo_sid';

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(s) {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

function newSessionId() {
  return crypto.randomUUID();
}

/** Opaque browser session ids (survives server restart for cookie continuity). */
const sessionMeta = new Map();

/** sessionId -> Set<express.Response> */
const sseBySession = new Map();

/** sessionId -> workspace API */
const workspaces = new Map();

function ensureSessionMeta(sessionId) {
  if (!sessionMeta.has(sessionId)) {
    sessionMeta.set(sessionId, { createdAt: Date.now() });
  }
}

function broadcastToSession(sessionId, topic, data) {
  const payload = `data: ${JSON.stringify({ topic, data, t: Date.now() })}\n\n`;
  const set = sseBySession.get(sessionId);
  if (!set) return;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (e) {
      set.delete(res);
    }
  }
}

function getWorkspace(sessionId) {
  let api = workspaces.get(sessionId);
  if (api) return api;
  api = createWorkspaceRuntime();
  api.setBroadcaster((topic, data) => broadcastToSession(sessionId, topic, data));
  workspaces.set(sessionId, api);
  return api;
}

function sessionMiddleware(req, res, next) {
  let sid = req.cookies && req.cookies[COOKIE_NAME];
  if (!isUuidLike(sid)) {
    sid = newSessionId();
    res.cookie(COOKIE_NAME, sid, SESSION_COOKIE_OPTIONS);
  }
  ensureSessionMeta(sid);
  req.sessionId = sid;
  req.workspace = getWorkspace(sid);
  next();
}

function addSseClient(sessionId, res, req) {
  if (!sseBySession.has(sessionId)) {
    sseBySession.set(sessionId, new Set());
  }
  const set = sseBySession.get(sessionId);
  set.add(res);
  req.on('close', () => {
    set.delete(res);
    if (set.size === 0) {
      sseBySession.delete(sessionId);
    }
  });
}

module.exports = {
  COOKIE_NAME,
  sessionMiddleware,
  addSseClient,
};

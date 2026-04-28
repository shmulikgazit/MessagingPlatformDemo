/**
 * Human agents: use authData: { username, password } — the SDK calls AgentVEP
 * `POST /api/account/{accountId}/login` (CSDS service `agentVep`, same process as
 * a username/password "login service" in front of the messaging stack).
 * See: `node_modules/lp-messaging-sdk/lib/services/agentVep.js`
 *
 * Pre-existing session / future SAML: pass authAgentSessionData { token, csrf, sessionId } only
 * (do not mix with authData — per SDK). Optional userId/userPid in body can be added when your
 * IdP/SSO flow provides them; the SDK's TokenMaintainer uses the session from AgentVEP.
 */
const lpm = require('lp-messaging-sdk');

const conversations = new Map();
const rings = new Map();
/** After Leave dialog or LP `back-to-queue`, we hide the conversation from the demo list until a ring accept or new `conversation` — SDK may keep the Conversation in cache, so sync and list output must respect this set. */
const conversationIdsHiddenAfterLeave = new Set();
let connection = null;

/** LP may use number or string ids; normalize so Map/set lookups match. */
function convMapKey(convId) {
  if (convId == null) {
    return '';
  }
  return String(convId);
}
let connectionPromise = null;
let lastError = null;
let lastAuthSummary = { authMode: null, accountId: null, username: null };
let broadcast = () => {};

function setBroadcaster(fn) {
  broadcast = fn;
}

function getAccountId(overrides) {
  const fromBody = overrides && overrides.accountId;
  const fromEnv = process.env.ACCOUNT_ID;
  const id = (fromBody && String(fromBody).trim()) || (fromEnv && String(fromEnv).trim());
  if (!id) {
    throw new Error('ACCOUNT_ID is required (in .env or in the connect request).');
  }
  return id;
}

function hasFullOAuth1InEnv() {
  return ['LPM_USERNAME', 'APP_KEY', 'APP_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'].every(
    (k) => process.env[k] && String(process.env[k]).trim()
  );
}

/**
 * @param {object} [overrides] - from POST /api/connection/open JSON body
 */
function buildConnectionOptions(overrides = {}) {
  const accountId = getAccountId(overrides);
  const authMode =
    (overrides && overrides.authMode) ||
    (process.env.LP_AUTH_MODE && process.env.LP_AUTH_MODE.trim()) ||
    (hasFullOAuth1InEnv() ? 'oauth1' : 'password');

  const base = {
    appId: process.env.LP_APP_ID || 'messaging_platform_demo_workspace',
    appVersion: process.env.LP_APP_VERSION || '1.0.0',
    accountId,
    userType: lpm.UserType.BRAND,
    responseTimeout: Number(process.env.RESPONSE_TIMEOUT_MS) || 60000,
  };

  const defaultSubscriptionQuery = parseSubscriptionQuery();
  if (defaultSubscriptionQuery) {
    base.defaultSubscriptionQuery = defaultSubscriptionQuery;
  }
  if (process.env.GET_ALL_MESSAGES === '1' || process.env.GET_ALL_MESSAGES === 'true') {
    base.getAllMessages = true;
  }
  const wait = process.env.RING_CONVERSATION_TIMEOUT_MS;
  if (wait && Number.isFinite(Number(wait))) {
    base.ringConversationTimeout = Number(wait);
  }

  if (authMode === 'password') {
    const username =
      (overrides && overrides.username) ||
      process.env.LPM_USERNAME ||
      process.env.LP_USERNAME ||
      '';
    const password =
      (overrides && overrides.password) ||
      process.env.LPM_PASSWORD ||
      process.env.LP_AGENT_PASSWORD ||
      '';
    if (!String(username).trim() || !password) {
      throw new Error(
        'authMode "password" requires username and password in the request body, or LPM_USERNAME and LPM_PASSWORD in .env.'
      );
    }
    base.authData = {
      username: String(username).trim(),
      password: String(password),
    };
    lastAuthSummary = { authMode: 'password', accountId, username: base.authData.username };
    return base;
  }

  if (authMode === 'session' || authMode === 'saml' || authMode === 'sso') {
    const session = (overrides && overrides.authAgentSessionData) || {};
    const token = session.token;
    const csrf = session.csrf;
    const sessionId = session.sessionId;
    if (!token || !csrf || !sessionId) {
      throw new Error(
        'authMode "session" (or saml/sso) requires authAgentSessionData: { token, csrf, sessionId } in the request body. See lp-messaging-sdk README "Brand Authentication with existing bearer token".'
      );
    }
    base.authAgentSessionData = {
      token: String(token),
      csrf: String(csrf),
      sessionId: String(sessionId),
    };
    if (session.userPid) {
      base.authAgentSessionData.userPid = String(session.userPid);
    }
    if (session.userId) {
      base.authAgentSessionData.userId = String(session.userId);
    }
    lastAuthSummary = { authMode: 'session', accountId, username: session.userId || null };
    return base;
  }

  if (authMode === 'oauth1' || authMode === 'bot') {
    const required = ['LPM_USERNAME', 'APP_KEY', 'APP_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'];
    const missing = required.filter((k) => !process.env[k] || !String(process.env[k]).trim());
    if (missing.length) {
      throw new Error(`authMode "oauth1" requires env: ACCOUNT_ID, ${missing.join(', ')}`);
    }
    lastAuthSummary = { authMode: 'oauth1', accountId, username: process.env.LPM_USERNAME.trim() };
    base.authData = {
      username: process.env.LPM_USERNAME.trim(),
      appKey: process.env.APP_KEY.trim(),
      secret: process.env.APP_SECRET.trim(),
      accessToken: process.env.ACCESS_TOKEN.trim(),
      accessTokenSecret: process.env.ACCESS_TOKEN_SECRET.trim(),
    };
    return base;
  }

  throw new Error(`Unknown authMode: ${authMode}. Use: password, oauth1, or session.`);
}

function applyProxyIfConfigured() {
  const host = process.env.PROXY_HOST || process.env.FIDDLER_HOST;
  const port = process.env.PROXY_PORT || process.env.FIDDLER_PORT;
  if (host && port) {
    lpm.configureProxy({
      host,
      port: Number(port),
      protocol: 'http',
    });
  } else {
    lpm.resetProxy();
  }
}

function maybeInsecureTls() {
  if (process.env.ALLOW_INSECURE_TLS === '1' || process.env.USE_FIDDLER === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

function parseSubscriptionQuery() {
  const raw = process.env.SUBSCRIPTION_QUERY_JSON;
  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error('SUBSCRIPTION_QUERY_JSON must be valid JSON (see lp-messaging-sdk README defaultSubscriptionQuery).');
    }
  }
  const agentId = process.env.SUBSCRIPTION_AGENT_ID;
  if (agentId && agentId.trim()) {
    return { stage: ['OPEN'], agentId: [agentId.trim()] };
  }
  return null;
}

function serializeParticipant(p) {
  if (!p) return null;
  return {
    userId: p.userId,
    agentId: p.agentId,
    role: p.role,
    state: p.state,
    chatState: p.chatState,
  };
}

function serializeMessage(m) {
  return {
    sequence: m.sequence,
    time: m.time,
    body: m.body,
    contentType: m.contentType,
    messageAudience: m.messageAudience,
    participant: serializeParticipant(m.participant),
    sentByCurrentUser: typeof m.sentByCurrentUser === 'function' ? m.sentByCurrentUser() : false,
    hasConsumerRead: typeof m.hasConsumerRead === 'function' ? m.hasConsumerRead() : false,
    hasAssignedAgentRead: typeof m.hasAssignedAgentRead === 'function' ? m.hasAssignedAgentRead() : false,
  };
}

function snapshotConversation(conv) {
  const d = conv.openDialog;
  const skill = conv.skill ? { skillId: conv.skill.skillId } : null;
  const messages = d ? d.messages.map(serializeMessage) : [];
  const participants = d ? d.participants.map(serializeParticipant) : [];
  return {
    conversationId: conv.conversationId,
    stage: conv.stage,
    skill,
    note: conv.note,
    accountId: conv.accountId,
    consumerUserId: conv.consumer && conv.consumer.userId,
    connectionAgentId: connection && connection.agentId,
    openDialogId: d ? d.dialogId : null,
    participants,
    messages,
  };
}

/** Fan out ChatState events from raw MS notifications (matches consumer WebSocket payloads). */
function emitParticipantChatStatesFromMessagingNotification(body) {
  if (!body) return;
  const chunks = Array.isArray(body.changes) && body.changes.length ? body.changes : [body];
  for (const ch of chunks) {
    const ev = ch && ch.event;
    if (!ev || ev.type !== 'ChatStateEvent' || !ev.chatState) continue;
    const om = ch.originatorMetadata;
    broadcast('participant-chat-state', {
      conversationId: ch.conversationId,
      userId: ch.originatorId || (om && om.id),
      role: om && om.role,
      agentId: om && om.role && om.role !== 'CONSUMER' ? om.id : null,
      chatState: ev.chatState,
    });
  }
}

function registerConversationHandlers(conv) {
  const mapKey = convMapKey(conv.conversationId);
  if (conv._demoWired) {
    conversations.set(mapKey, conv);
    return;
  }
  conv._demoWired = true;
  conversations.set(mapKey, conv);

  conv.on('message', (message) => {
    broadcast('message', { conversationId: conv.conversationId, message: serializeMessage(message) });
  });

  conv.on('message-delivery-event', (messages) => {
    const arr = Array.isArray(messages) ? messages : messages ? [messages] : [];
    broadcast('message-delivery-event', {
      conversationId: conv.conversationId,
      messages: arr.map((m) => serializeMessage(m)),
    });
  });

  conv.on('close', () => {
    conversations.delete(convMapKey(conv.conversationId));
    broadcast('conversation-close', { conversationId: conv.conversationId });
  });

  conv.on('transfer-skill', () => {
    conversations.delete(convMapKey(conv.conversationId));
    broadcast('transfer-skill', {
      conversationId: conv.conversationId,
      skill: conv.skill ? { skillId: conv.skill.skillId } : null,
    });
  });

  conv.on('transfer-agent', (participant) => {
    conversations.delete(convMapKey(conv.conversationId));
    broadcast('transfer-agent', { conversationId: conv.conversationId, participant: serializeParticipant(participant) });
  });

  conv.on('back-to-queue', () => {
    const k = convMapKey(conv.conversationId);
    conversations.delete(k);
    conversationIdsHiddenAfterLeave.add(k);
    broadcast('back-to-queue', { conversationId: conv.conversationId });
  });

  conv.on('participant-added', (payload) => {
    const p = payload && payload.participant;
    broadcast('participant-added', {
      conversationId: conv.conversationId,
      participant: serializeParticipant(p),
      context: payload && payload.context,
    });
  });

  conv.on('participant-removed', (participant) => {
    broadcast('participant-removed', {
      conversationId: conv.conversationId,
      participant: serializeParticipant(participant),
    });
  });

  conv.on('consumer-step-up', () => {
    broadcast('consumer-step-up', { conversationId: conv.conversationId });
  });

  broadcast('conversation', { conversation: snapshotConversation(conv) });
}

/**
 * Merge the SDK connection's cached conversations into our map. After leave/back-to-queue/ring flows the
 * SDK often updates existing Conversation instances without emitting `connection` `conversation` again
 * (see lp-messaging-sdk conversation-notification-feed UPSERT branch), so handlers were never registered
 * from the event path alone.
 */
function syncConversationsFromSdk() {
  if (!connection || typeof connection.getAllKnownConversations !== 'function') {
    return;
  }
  try {
    for (const conv of connection.getAllKnownConversations()) {
      if (conversationIdsHiddenAfterLeave.has(convMapKey(conv.conversationId))) {
        continue;
      }
      registerConversationHandlers(conv);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[lpWorkspace] syncConversationsFromSdk:', e.message || e);
  }
}

function getConversationOrThrow(id) {
  syncConversationsFromSdk();
  const conv = conversations.get(convMapKey(id));
  if (!conv) {
    const err = new Error(`Unknown conversation: ${id}. It must be received through the default subscription (open conversations).`);
    err.status = 404;
    throw err;
  }
  return conv;
}

function findMessage(conv, sequence) {
  const d = conv.openDialog;
  if (!d) return null;
  const seq = Number(sequence);
  return d.messages.find((m) => m.sequence === seq) || null;
}

function wireConnection(conn) {
  conn.on('error', (err) => {
    lastError = err && err.message ? err.message : String(err);
    broadcast('connection-error', { error: lastError });
  });

  conn.on('connect', () => {
    lastError = null;
    broadcast('connection-connect', { state: conn.state });
  });

  conn.on('close', (reason) => {
    broadcast('connection-close', { reason });
  });

  conn.on('reconnecting', () => {
    broadcast('connection-reconnecting', {});
  });

  conn.on('conversation', (conv) => {
    const k = convMapKey(conv.conversationId);
    if (conversationIdsHiddenAfterLeave.has(k)) {
      return;
    }
    registerConversationHandlers(conv);
  });

  conn.on('ring', (ring) => {
    rings.set(ring.ringId, ring);
    broadcast('ring', {
      ringId: ring.ringId,
      ringState: ring.ringState,
      conversationId: ring.conversationId,
      skillId: ring.skillId,
      consumerId: ring.consumerId,
    });
  });

  conn.on('messageNotification', emitParticipantChatStatesFromMessagingNotification);

  if (process.env.RAW_LP_NOTIFICATIONS === '1') {
    conn.on('notification', (n) => {
      broadcast('raw-notification', { type: n && n.type, body: n && n.body });
    });
  }
}

async function connect(overrides = {}) {
  if (connection) {
    return { status: 'already_connected', snapshot: getStatus() };
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    maybeInsecureTls();
    applyProxyIfConfigured();
    const opts = buildConnectionOptions(overrides);
    connection = lpm.createConnection(opts);
    wireConnection(connection);
    await connection.open();
    try {
      await connection.createRoutingTaskSubscription();
    } catch (routingErr) {
      // eslint-disable-next-line no-console
      console.warn(
        '[lpWorkspace] createRoutingTaskSubscription failed (rings may be missing until you use POST /api/rings/subscribe):',
        routingErr && routingErr.message ? routingErr.message : routingErr
      );
    }
    return { status: 'connected', snapshot: getStatus() };
  })()
    .catch((err) => {
      lastError = err && err.message ? err.message : String(err);
      lastAuthSummary = { authMode: null, accountId: null, username: null };
      connection = null;
      throw err;
    })
    .finally(() => {
      connectionPromise = null;
    });

  return connectionPromise;
}

async function disconnect() {
  if (!connection) {
    lastAuthSummary = { authMode: null, accountId: null, username: null };
    return { status: 'idle' };
  }
  const conn = connection;
  connection = null;
  lastAuthSummary = { authMode: null, accountId: null, username: null };
  conversations.clear();
  rings.clear();
  conversationIdsHiddenAfterLeave.clear();
  await conn.close();
  return { status: 'disconnected' };
}

/** Best-effort display name for the signed-in agent (profile nickname/name, login username, or LP ids). */
function signedInAsLabel(conn) {
  const up = conn.userProfile;
  const nick = up && up.nickName && String(up.nickName).trim();
  if (nick) {
    return nick;
  }
  if (up && (up.firstName || up.lastName)) {
    const name = [up.firstName, up.lastName].filter(Boolean).join(' ').trim();
    if (name) {
      return name;
    }
  }
  if (lastAuthSummary.username) {
    return String(lastAuthSummary.username).trim();
  }
  if (conn.userId) {
    return conn.userId;
  }
  if (conn.agentId) {
    return conn.agentId;
  }
  return null;
}

function getStatus() {
  if (!connection) {
    return {
      connected: false,
      session: { loggedIn: false, connectionState: null, signedInAs: null },
      agent: {
        availability: null,
        label: '—',
        note: 'Connect first. Availability is set with setAgentState (ONLINE, OFFLINE, …).',
      },
      lastError,
      auth: lastAuthSummary,
    };
  }
  const avail = connection.agentState;
  let availLabel = 'Not set yet';
  if (avail === lpm.AgentState.ONLINE) {
    availLabel = 'Online (can receive routing / rings)';
  } else if (avail === lpm.AgentState.OFFLINE) {
    availLabel = 'Offline';
  } else if (avail === lpm.AgentState.AWAY) {
    availLabel = 'Away';
  } else if (avail === lpm.AgentState.BACK_SOON) {
    availLabel = 'Back soon';
  }
  return {
    connected: true,
    state: connection.state,
    session: {
      loggedIn: true,
      connectionState: connection.state,
      signedInAs: signedInAsLabel(connection),
      meaning: 'WebSocket authenticated; this agent user is signed in for this SDK session.',
    },
    agent: {
      availability: avail,
      label: availLabel,
      note:
        avail == null
          ? 'Press an availability button below (e.g. ONLINE) so the platform knows routing state. Matches connection.agentState.'
          : 'Last value from setAgentState on this connection.',
    },
    lastError,
    auth: lastAuthSummary,
    userId: connection.userId,
    agentId: connection.agentId,
    userProfile: connection.userProfile
      ? {
          firstName: connection.userProfile.firstName,
          lastName: connection.userProfile.lastName,
          nickName: connection.userProfile.nickName,
        }
      : null,
    agentState: connection.agentState,
    conversationCount: conversations.size,
  };
}

function listConversations() {
  syncConversationsFromSdk();
  for (const hid of conversationIdsHiddenAfterLeave) {
    conversations.delete(hid);
  }
  const out = Array.from(conversations.values())
    .map((c) => snapshotConversation(c))
    .filter((snap) => !conversationIdsHiddenAfterLeave.has(convMapKey(snap.conversationId)));
  if (process.env.LP_CONV_DEBUG === '1') {
    // eslint-disable-next-line no-console
    console.log('[lpWorkspace] listConversations', {
      returned: out.length,
      demoMapSize: conversations.size,
      hiddenAfterLeave: [...conversationIdsHiddenAfterLeave],
      conversationIds: out.map((s) => s.conversationId),
    });
  }
  return out;
}

function getConversationSnapshot(id) {
  const conv = getConversationOrThrow(id);
  return snapshotConversation(conv);
}

async function joinConversation(id, role) {
  const conv = getConversationOrThrow(id);
  const r = lpm.ParticipantRole[role] || role;
  if (!r || !Object.values(lpm.ParticipantRole).includes(r)) {
    const err = new Error(`Invalid role: ${role}`);
    err.status = 400;
    throw err;
  }
  await conv.join(r);
  return getConversationSnapshot(id);
}

async function sendMessage(id, text) {
  const conv = getConversationOrThrow(id);
  if (!text || !String(text).trim()) {
    const err = new Error('message text is required');
    err.status = 400;
    throw err;
  }
  await conv.sendMessage(String(text).trim());
  return getConversationSnapshot(id);
}

async function transferConversation(id, { skillId, agentId } = {}) {
  const conv = getConversationOrThrow(id);
  if (!skillId && !agentId) {
    const err = new Error('Provide skillId or agentId (agentId must be accountId.userId).');
    err.status = 400;
    throw err;
  }
  await conv.transfer({ skillId: skillId || null, agentId: agentId || null });
  const snapshot = snapshotConversation(conv);
  conversations.delete(convMapKey(id));
  return snapshot;
}

async function leaveConversation(id) {
  const conv = getConversationOrThrow(id);
  await conv.leave();
  const snapshot = snapshotConversation(conv);
  conversations.delete(convMapKey(id));
  conversationIdsHiddenAfterLeave.add(convMapKey(id));
  // eslint-disable-next-line no-console
  console.log(
    `[lpWorkspace] leaveConversation OK id=${convMapKey(id)} demoMapSize=${conversations.size} sdkKnown=${
      connection && typeof connection.getAllKnownConversations === 'function'
        ? connection.getAllKnownConversations().length
        : 'n/a'
    } hidden=[${[...conversationIdsHiddenAfterLeave].join(', ') || '-'}]`
  );
  return snapshot;
}

async function closeConversation(id, mode) {
  const conv = getConversationOrThrow(id);
  if (mode === 'mainDialog') {
    const main = conv.getDialog(lpm.DialogType.MAIN);
    if (!main) {
      const err = new Error('No MAIN dialog to close');
      err.status = 400;
      throw err;
    }
    await main.close();
  } else {
    await conv.close();
  }
  return getConversationSnapshot(id);
}

async function setDialogChatState(id, chatState) {
  const conv = getConversationOrThrow(id);
  const d = conv.openDialog;
  if (!d) {
    const err = new Error('No open dialog');
    err.status = 400;
    throw err;
  }
  const state = lpm.ParticipantChatState[chatState] || chatState;
  if (!state || !Object.values(lpm.ParticipantChatState).includes(state)) {
    const err = new Error(`Invalid chat state: ${chatState}`);
    err.status = 400;
    throw err;
  }
  await d.setChatState(state);
  return { ok: true, chatState: state };
}

async function loadFullHistory(id) {
  const conv = getConversationOrThrow(id);
  const d = conv.openDialog || conv.getDialog(lpm.DialogType.MAIN);
  if (!d) {
    const err = new Error('No dialog to load');
    err.status = 400;
    throw err;
  }
  await d.getAllPublishEvents();
  return getConversationSnapshot(id);
}

async function acceptMessage(id, sequence) {
  const conv = getConversationOrThrow(id);
  const m = findMessage(conv, sequence);
  if (!m) {
    const err = new Error(`Message with sequence ${sequence} not found in cache`);
    err.status = 404;
    throw err;
  }
  await m.accept();
  return { ok: true };
}

async function readMessage(id, sequence) {
  const conv = getConversationOrThrow(id);
  const m = findMessage(conv, sequence);
  if (!m) {
    const err = new Error(`Message with sequence ${sequence} not found in cache`);
    err.status = 404;
    throw err;
  }
  await m.read();
  return { ok: true };
}

async function setAgentAvailability(agentState) {
  if (!connection) {
    const err = new Error('Not connected');
    err.status = 400;
    throw err;
  }
  const s = lpm.AgentState[agentState] || agentState;
  if (!s || !Object.values(lpm.AgentState).includes(s)) {
    const err = new Error(`Invalid agentState. Use: ${Object.keys(lpm.AgentState).join(', ')}`);
    err.status = 400;
    throw err;
  }
  await connection.setAgentState({ agentState: s });
  broadcast('agent-availability', { agentState: s });
  return getStatus();
}

async function setAgentStateOnline() {
  return setAgentAvailability('ONLINE');
}

function agentStates() {
  return { ...lpm.AgentState };
}

async function createRoutingTaskSubscription() {
  if (!connection) {
    const err = new Error('Not connected');
    err.status = 400;
    throw err;
  }
  const sub = await connection.createRoutingTaskSubscription();
  return { subscriptionId: sub && sub.subscriptionId, ok: true };
}

function listRings() {
  return Array.from(rings.values()).map((r) => ({
    ringId: r.ringId,
    ringState: r.ringState,
    conversationId: r.conversationId,
    skillId: r.skillId,
    consumerId: r.consumerId,
  }));
}

async function acceptRing(ringId) {
  const ring = rings.get(ringId);
  if (!ring) {
    const err = new Error('Ring not found (may have expired).');
    err.status = 404;
    throw err;
  }
  await ring.accept();
  const cid = ring.conversationId;
  if (cid != null) {
    conversationIdsHiddenAfterLeave.delete(convMapKey(cid));
  }
  syncConversationsFromSdk();
  return { ok: true };
}

async function rejectRing(ringId) {
  const ring = rings.get(ringId);
  if (!ring) {
    const err = new Error('Ring not found (may have expired).');
    err.status = 404;
    throw err;
  }
  await ring.reject();
  return { ok: true };
}

function participantRoles() {
  return { ...lpm.ParticipantRole };
}

function chatStates() {
  return { ...lpm.ParticipantChatState };
}

/**
 * UI hints (no secrets). LP_DEMO_USERNAMES=a,b for quick-fill buttons.
 */
function getConnectionHints() {
  const raw = process.env.LP_DEMO_USERNAMES || 'agenta,agentb';
  const demoUsernames = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    defaultAccountId: (process.env.ACCOUNT_ID && process.env.ACCOUNT_ID.trim()) || 'a41244303',
    envAuthMode: process.env.LP_AUTH_MODE || null,
    demoUsernames,
    hasOAuth1Env: !!(
      process.env.APP_KEY &&
      process.env.APP_SECRET &&
      process.env.ACCESS_TOKEN &&
      process.env.ACCESS_TOKEN_SECRET
    ),
  };
}

module.exports = {
  setBroadcaster,
  connect,
  disconnect,
  getStatus,
  getConnectionHints,
  listConversations,
  getConversationSnapshot,
  joinConversation,
  sendMessage,
  transferConversation,
  leaveConversation,
  closeConversation,
  setDialogChatState,
  loadFullHistory,
  acceptMessage,
  readMessage,
  setAgentStateOnline,
  setAgentAvailability,
  agentStates,
  createRoutingTaskSubscription,
  listRings,
  acceptRing,
  rejectRing,
  participantRoles,
  chatStates,
};

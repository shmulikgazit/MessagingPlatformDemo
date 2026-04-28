const $ = (id) => document.getElementById(id);

const LABEL_CONNECT = 'Open connection';

function setConnectConnecting(busy) {
  const btn = $('btnConnect');
  const btnClose = $('btnDisconnect');
  const panel = $('connectionPanel');
  if (!btn) {
    return;
  }
  if (busy) {
    btn.disabled = true;
    btn.classList.add('btn-connecting');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML =
      '<span class="btn-spinner" aria-hidden="true"></span><span>Connecting…</span>';
    if (btnClose) btnClose.disabled = true;
    if (panel) panel.classList.add('panel-connecting');
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-connecting');
    btn.removeAttribute('aria-busy');
    btn.textContent = LABEL_CONNECT;
    if (btnClose) btnClose.disabled = false;
    if (panel) panel.classList.remove('panel-connecting');
  }
}

const state = {
  selectedId: null,
  eventSource: null,
  agentUserId: null,
  /** When true, routing / message tones are suppressed (persisted). */
  soundMuted: false,
};

const STORAGE_SOUND_MUTED = 'mpdemo_sound_muted';

/** Avoid double-chime when multiple SSE updates hit the same ring. */
const lastRingSoundAt = {};
/** Throttle message chimes per conversation. */
const lastMsgSoundAt = {};

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioContext = Ctor ? new Ctor() : null;
  }
  return audioContext;
}

/** Resume audio after a user gesture (browser autoplay policies). */
function primeAudioContext() {
  const ctx = getAudioContext();
  if (!ctx) {
    return Promise.resolve();
  }
  if (ctx.state === 'suspended') {
    return ctx.resume().catch(() => {});
  }
  return Promise.resolve();
}

function loadSoundMutedFromStorage() {
  try {
    state.soundMuted = localStorage.getItem(STORAGE_SOUND_MUTED) === '1';
  } catch (_) {
    state.soundMuted = false;
  }
}

function updateMuteButtonUi() {
  const b = $('btnSoundMute');
  if (!b) {
    return;
  }
  const muted = !!state.soundMuted;
  b.setAttribute('aria-pressed', muted ? 'true' : 'false');
  b.textContent = muted ? 'Unmute sounds' : 'Mute sounds';
  b.classList.toggle('sound-muted', muted);
  b.title = muted ? 'Sounds are muted' : 'Mute notification tones';
}

/**
 * Brief sine blip; Web Audio API only (no sound files).
 * @param {number} hz
 * @param {number} durationMs
 * @param {number} gainApprox
 */
function playToneBlip(hz, durationMs, gainApprox) {
  const g0 = gainApprox == null ? 0.06 : gainApprox;
  if (state.soundMuted) {
    return;
  }
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const t0 = ctx.currentTime;
    const sec = durationMs / 1000;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, g0), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + sec);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + sec + 0.04);
  } catch (_) {
    /* ignore */
  }
}

function soundIncomingRing() {
  if (state.soundMuted) {
    return;
  }
  playToneBlip(784, 105, 0.065);
  window.setTimeout(() => playToneBlip(988, 92, 0.055), 118);
}

function soundRingAccepted() {
  playToneBlip(523, 155, 0.068);
}

function soundIncomingMessage() {
  playToneBlip(659, 75, 0.052);
}

function maybePlayIncomingRing(ringId) {
  if (!ringId || state.soundMuted) {
    return;
  }
  const k = String(ringId);
  const now = Date.now();
  const prev = lastRingSoundAt[k];
  if (prev != null && now - prev < 1600) {
    return;
  }
  lastRingSoundAt[k] = now;
  soundIncomingRing();
}

function maybePlayIncomingMessage(conversationId) {
  if (conversationId == null || state.soundMuted) {
    return;
  }
  const k = String(conversationId);
  const now = Date.now();
  const prev = lastMsgSoundAt[k];
  if (prev != null && now - prev < 450) {
    return;
  }
  lastMsgSoundAt[k] = now;
  soundIncomingMessage();
}

function setAvailabilityPill(avail, label) {
  const el = $('availPill');
  if (!el) {
    return;
  }
  let cls = 'conn-pill muted-pill';
  let text = label || '—';
  if (avail === 'ONLINE') {
    cls = 'conn-pill avail-online';
    text = `Availability · ${label || 'Online'}`;
  } else if (avail === 'OFFLINE') {
    text = `Availability · ${label || 'Offline'}`;
  } else if (avail === 'AWAY') {
    text = `Availability · ${label || 'Away'}`;
  } else if (avail === 'BACK_SOON') {
    text = `Availability · ${label || 'Back soon'}`;
  } else {
    text = `Availability · ${label || 'Not set'}`;
  }
  el.className = cls + ' header-status';
  el.textContent = text;
}

function setSessionPill(connected, signedInAs, tooltip) {
  const el = $('sessionPill');
  if (!el) {
    return;
  }
  el.title = tooltip || 'Messaging SDK WebSocket session';
  if (connected) {
    el.className = 'conn-pill ok session-pill header-status';
    el.textContent = signedInAs
      ? `Session · signed in as ${signedInAs}`
      : 'Session · signed in';
  } else {
    el.className = 'conn-pill muted-pill session-pill header-status';
    el.textContent = 'Session · disconnected';
  }
}

async function jfetch(url, opts) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(j.error || r.statusText || 'Request failed');
  }
  return j;
}

async function refreshStatus() {
  const j = await jfetch('/api/status');
  $('statusBox').textContent = JSON.stringify(j.data, null, 2);
  const loggedIn = !!(j.data && j.data.connected);
  const signedInAs = j.data && j.data.session && j.data.session.signedInAs;
  const tipParts = ['Messaging SDK WebSocket session'];
  if (loggedIn && j.data) {
    if (j.data.userId) tipParts.push(`userId: ${j.data.userId}`);
    if (j.data.agentId) tipParts.push(`agentId: ${j.data.agentId}`);
  }
  setSessionPill(loggedIn, signedInAs, tipParts.join(' · '));
  const a = j.data && j.data.agent ? j.data.agent : {};
  const avail = (j.data && (j.data.agentState != null ? j.data.agentState : a.availability)) || null;
  setAvailabilityPill(avail, a.label);
  state.agentUserId = loggedIn && j.data && j.data.userId ? j.data.userId : null;
}

function flashAvailPill() {
  const el = $('availPill');
  if (!el) {
    return;
  }
  el.classList.remove('pill-flash');
  void el.offsetWidth;
  el.classList.add('pill-flash');
  window.clearTimeout(flashAvailPill._t);
  flashAvailPill._t = window.setTimeout(() => el.classList.remove('pill-flash'), 700);
}

async function submitAvailability(agentState) {
  await jfetch('/api/agent/availability', {
    method: 'POST',
    body: JSON.stringify({ agentState }),
  });
  logEvent(`agent/availability → ${agentState}`);
  await refreshStatus();
  flashAvailPill();
}

function logEvent(line) {
  const log = $('eventLog');
  const d = document.createElement('div');
  d.className = 'log-line';
  d.textContent = line;
  log.prepend(d);
  while (log.children.length > 200) {
    log.removeChild(log.lastChild);
  }
}

/** Visible under “Refresh list” — also duplicate key lines via logEvent / console. */
function setConvListStatus(text) {
  const el = $('convListStatus');
  if (el) {
    el.textContent = text;
  }
}

/** SSE topics after which we refresh /api/conversations (SDK-driven updates). */
const CONVERSATION_REFRESH_TOPICS = new Set([
  'connection-connect',
  'conversation',
  'ring',
  'message',
  'message-delivery-event',
  'conversation-close',
  'transfer-skill',
  'transfer-agent',
  'back-to-queue',
  'participant-added',
  'participant-removed',
  'participant-chat-state',
  'consumer-step-up',
  'connection-close',
]);

let conversationRefreshTimer = null;

async function refreshConversationsUi() {
  await listConversations('sse_refresh');
  if (!state.selectedId) {
    return;
  }
  if (!$('convJson')) {
    return;
  }
  try {
    const j = await jfetch('/api/conversations/' + encodeURIComponent(state.selectedId));
    $('convJson').textContent = JSON.stringify(j.data, null, 2);
    syncConsumerTypingFromConversationPayload(j.data);
    document.querySelectorAll('.conv-item').forEach((b) => {
      b.classList.toggle('active', b.textContent.startsWith(state.selectedId));
    });
  } catch (e) {
    $('convJson').textContent = String(e.message || e);
  }
}

function scheduleConversationsRefresh() {
  window.clearTimeout(conversationRefreshTimer);
  conversationRefreshTimer = window.setTimeout(() => {
    conversationRefreshTimer = null;
    refreshConversationsUi().catch(() => {});
  }, 400);
}

function setTypingLiveLine(text) {
  const el = $('typingLiveLine');
  if (el) {
    el.textContent = text;
  }
}

function consumerParticipantFromPayload(participants) {
  if (!Array.isArray(participants)) {
    return null;
  }
  return participants.find((p) => p && p.role === 'CONSUMER') || null;
}

function updateConsumerTypingBadge(chatState) {
  const el = $('consumerTypingIndicator');
  if (!el) {
    return;
  }
  if (chatState === 'COMPOSING') {
    el.textContent = 'Consumer composing…';
    el.className = 'consumer-typing-badge consumer-composing';
    return;
  }
  el.className = 'consumer-typing-badge consumer-idle';
  el.textContent = 'Consumer active';
}

function syncConsumerTypingFromConversationPayload(payload) {
  const cp = payload && consumerParticipantFromPayload(payload.participants);
  if (!cp || cp.chatState == null) {
    updateConsumerTypingBadge('ACTIVE');
    return;
  }
  updateConsumerTypingBadge(cp.chatState);
}

/** Non-consumer participant chat-state (agents, bots, transfers, …). Consumer uses the badge above. */
function applyParticipantChatStateFromSse(o) {
  const data = o.data;
  if (!data || data.conversationId !== state.selectedId) {
    return;
  }
  if (state.agentUserId && data.userId && data.userId === state.agentUserId) {
    return;
  }
  if (data.role === 'CONSUMER') {
    updateConsumerTypingBadge(data.chatState);
    return;
  }
  const who = [data.role, data.userId || data.agentId].filter(Boolean).join(' · ') || 'participant';
  setTypingLiveLine(`Others: ${new Date(o.t).toLocaleTimeString()}  ${who} → ${data.chatState}`);
}

const AUTOTYPE_STOP_MS = 2800;
const AUTOTYPE_EMPTY_FLUSH_MS = 450;

let agentTypingPublished = null;
let agentTypingStopTimer = null;
let agentTypingEmptyTimer = null;
let composingPostInFlight = false;
let suppressNextMessageInput = false;

function clearAgentTypingTimers() {
  if (agentTypingStopTimer !== null) {
    window.clearTimeout(agentTypingStopTimer);
    agentTypingStopTimer = null;
  }
  if (agentTypingEmptyTimer !== null) {
    window.clearTimeout(agentTypingEmptyTimer);
    agentTypingEmptyTimer = null;
  }
}

function setAgentTypingIndicator(isTyping) {
  const el = $('typingAgentIndicator');
  if (!el) {
    return;
  }
  if (isTyping) {
    el.className = 'typing-agent-indicator is-typing';
    el.textContent = 'Typing';
  } else {
    el.className = 'typing-agent-indicator not-typing';
    el.textContent = 'Not typing';
  }
}

function postAgentChatState(targetState, silent) {
  if (!state.selectedId) {
    return Promise.resolve();
  }
  return jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/typing', {
    method: 'POST',
    body: JSON.stringify({ state: targetState }),
  })
    .then(() => {
      agentTypingPublished = targetState;
      return refreshConversationsUi();
    })
    .catch((e) => {
      if (silent) {
        logEvent('auto-typing: ' + (e.message || e));
      } else {
        alert(e.message);
      }
    });
}

function resetAgentComposeAutomation() {
  clearAgentTypingTimers();
  composingPostInFlight = false;
  suppressNextMessageInput = false;
  agentTypingPublished = null;
  setAgentTypingIndicator(false);
}

function onAgentMessageSent() {
  suppressNextMessageInput = true;
  clearAgentTypingTimers();
  setAgentTypingIndicator(false);
  if (agentTypingPublished === 'COMPOSING') {
    return postAgentChatState('ACTIVE', true);
  }
  agentTypingPublished = 'ACTIVE';
  return Promise.resolve();
}

function onMessageTextInput() {
  if (suppressNextMessageInput) {
    suppressNextMessageInput = false;
    return;
  }
  const ta = $('msgText');
  if (!ta || !state.selectedId) {
    return;
  }
  if (agentTypingEmptyTimer !== null) {
    window.clearTimeout(agentTypingEmptyTimer);
    agentTypingEmptyTimer = null;
  }
  const raw = ta.value;
  if (raw.length === 0) {
    clearAgentTypingTimers();
    setAgentTypingIndicator(false);
    agentTypingEmptyTimer = window.setTimeout(() => {
      agentTypingEmptyTimer = null;
      if (agentTypingPublished === 'COMPOSING') {
        postAgentChatState('ACTIVE', true);
      }
    }, AUTOTYPE_EMPTY_FLUSH_MS);
    return;
  }

  setAgentTypingIndicator(true);
  if (agentTypingPublished !== 'COMPOSING' && !composingPostInFlight) {
    composingPostInFlight = true;
    postAgentChatState('COMPOSING', true).finally(() => {
      composingPostInFlight = false;
    });
  }

  if (agentTypingStopTimer !== null) {
    window.clearTimeout(agentTypingStopTimer);
  }
  agentTypingStopTimer = window.setTimeout(() => {
    agentTypingStopTimer = null;
    const t2 = $('msgText');
    if (!t2 || t2.value.length === 0) {
      return;
    }
    setAgentTypingIndicator(false);
    if (agentTypingPublished === 'COMPOSING') {
      postAgentChatState('ACTIVE', true);
    }
  }, AUTOTYPE_STOP_MS);
}

function onMessageTextBlur() {
  if (!state.selectedId) {
    return;
  }
  clearAgentTypingTimers();
  const ta = $('msgText');
  if (!ta) {
    return;
  }
  if (ta.value.length === 0) {
    setAgentTypingIndicator(false);
    if (agentTypingPublished === 'COMPOSING') {
      postAgentChatState('ACTIVE', true);
    }
    return;
  }
  agentTypingStopTimer = window.setTimeout(() => {
    agentTypingStopTimer = null;
    setAgentTypingIndicator(false);
    if (agentTypingPublished === 'COMPOSING') {
      postAgentChatState('ACTIVE', true);
    }
  }, 900);
}

function startSse() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  const es = new EventSource('/api/events');
  state.eventSource = es;
  es.onmessage = (ev) => {
    try {
      const o = JSON.parse(ev.data);
      const t = o.topic;
      if (t === 'hello') {
        return;
      }
      logEvent(`${new Date(o.t).toLocaleTimeString()}  ${t}  ${JSON.stringify(o.data)}`);
      if (t === 'ring' && o.data && o.data.ringId != null) {
        maybePlayIncomingRing(o.data.ringId);
      }
      if (t === 'message' && o.data && o.data.message && o.data.message.sentByCurrentUser !== true) {
        maybePlayIncomingMessage(o.data.conversationId);
      }
      if (t === 'participant-chat-state') {
        applyParticipantChatStateFromSse(o);
      }
      if (t === 'back-to-queue' && o.data && o.data.conversationId != null) {
        const cq = String(o.data.conversationId);
        if (state.selectedId != null && String(state.selectedId) === cq) {
          state.selectedId = null;
          const panel = $('detailPanel');
          if (panel) panel.hidden = true;
          resetAgentComposeAutomation();
          setTypingLiveLine('Others: —');
          updateConsumerTypingBadge('ACTIVE');
          if ($('convJson')) $('convJson').textContent = '{}';
          logEvent(`[SSE back-to-queue] closed detail pane for conversation ${cq}`);
        }
      }
      if (CONVERSATION_REFRESH_TOPICS.has(t)) {
        scheduleConversationsRefresh();
      }
    } catch (e) {
      logEvent(ev.data);
    }
  };
  es.onerror = () => {
    logEvent('[SSE] connection error (will retry in browser)');
  };
}

function renderConversations(list) {
  const ul = $('convList');
  ul.innerHTML = '';
  (list || []).forEach((c) => {
    const id = c.conversationId;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const idStr = id == null ? '' : String(id);
    btn.className = 'conv-item' + (String(state.selectedId) === idStr ? ' active' : '');
    btn.textContent = `${id} · ${c.stage || ''} · skill ${c.skill ? c.skill.skillId : '?'}`;
    btn.addEventListener('click', () => selectConversation(id));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

/** If the selected conversation is no longer in the subscription list, close the detail panel (e.g. after transfer). */
function pruneStaleSelection(convList) {
  if (!state.selectedId) {
    return;
  }
  const ids = (convList || []).map((c) => (c && c.conversationId != null ? String(c.conversationId) : '')).filter(Boolean);
  const selStr = state.selectedId != null ? String(state.selectedId) : '';
  if (!selStr || ids.includes(selStr)) {
    return;
  }
  state.selectedId = null;
  const panel = $('detailPanel');
  if (panel) panel.hidden = true;
  resetAgentComposeAutomation();
  setTypingLiveLine('Others: —');
  updateConsumerTypingBadge('ACTIVE');
  if ($('convJson')) $('convJson').textContent = '{}';
}

async function listConversations(reason) {
  const why = reason || 'unspecified';
  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  console.info('[demo] listConversations start', { reason: why, at: new Date().toISOString() });
  try {
    const j = await jfetch('/api/conversations');
    const rows = j && Array.isArray(j.data) ? j.data : null;
    if (rows === null) {
      console.warn('[demo] /api/conversations unexpected JSON (expected { data: array })', j);
      logEvent(
        `[${why}] WARN: server response has no data[] — open DevTools Console (F12). Keys: ${JSON.stringify(Object.keys(j || {}))}`
      );
      renderConversations([]);
      pruneStaleSelection([]);
      setConvListStatus('Last fetch: bad response shape (see Console).');
      return [];
    }
    const ids = rows.map((c) => (c && c.conversationId != null ? String(c.conversationId) : '')).filter(Boolean);
    renderConversations(rows);
    pruneStaleSelection(rows);
    const ms = typeof performance !== 'undefined' && performance.now ? Math.round(performance.now() - t0) : null;
    const summary = `${rows.length} row(s)${ms != null ? ` ${ms}ms` : ''} — ${ids.length ? ids.join(', ') : '(none)'}`;
    const line = `[${why}] ${summary}`;
    logEvent(line);
    setConvListStatus(`Last list fetch (${why}): ${summary}`);
    console.info('[demo] listConversations ok', { reason: why, count: rows.length, conversationIds: ids });
    return rows;
  } catch (e) {
    const msg = e.message || String(e);
    logEvent(`[${why}] ERROR: ${msg}`);
    setConvListStatus(`Last fetch failed (${why}): ${msg}`);
    console.error('[demo] listConversations error', why, e);
    throw e;
  }
}

async function selectConversation(id) {
  state.selectedId = id;
  setTypingLiveLine('Others: —');
  resetAgentComposeAutomation();
  $('detailPanel').hidden = false;
  $('selId').textContent = id;
  const j = await jfetch('/api/conversations/' + encodeURIComponent(id));
  $('convJson').textContent = JSON.stringify(j.data, null, 2);
  syncConsumerTypingFromConversationPayload(j.data);
  document.querySelectorAll('.conv-item').forEach((b) => {
    b.classList.toggle('active', b.textContent.startsWith(id));
  });
}

async function loadHints() {
  const j = await jfetch('/api/connection/hints');
  const h = j.data;
  const acc = $('accountId');
  if (acc && !acc.value) {
    acc.value = h.defaultAccountId || '';
  }
  const row = $('quickUserRow');
  if (row && h.demoUsernames && h.demoUsernames.length) {
    row.innerHTML = '';
    h.demoUsernames.forEach((u) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = u;
      b.addEventListener('click', () => {
        $('userName').value = u;
      });
      row.appendChild(b);
    });
  }
}

function getConnectPayload() {
  const accountId = ($('accountId') && $('accountId').value.trim()) || undefined;
  const mode = ($('authMode') && $('authMode').value) || 'password';
  const body = { authMode: mode };
  if (accountId) {
    body.accountId = accountId;
  }
  if (mode === 'password') {
    body.username = ($('userName') && $('userName').value.trim()) || '';
    body.password = ($('userPassword') && $('userPassword').value) || '';
  }
  if (mode === 'session') {
    const raw = ($('sessionJson') && $('sessionJson').value.trim()) || '';
    if (!raw) {
      throw new Error('Paste authAgentSessionData JSON (token, csrf, sessionId).');
    }
    try {
      body.authAgentSessionData = JSON.parse(raw);
    } catch (e) {
      throw new Error('Invalid JSON for authAgentSessionData.');
    }
  }
  return body;
}

function onAuthModeChange() {
  const mode = $('authMode').value;
  const showPw = mode === 'password';
  const showSess = mode === 'session';
  const showOat = mode === 'oauth1';
  $('pwBlock').hidden = !showPw;
  $('sessionBlock').hidden = !showSess;
  $('oauthHint').hidden = !showOat;
}

async function loadMeta() {
  const roles = await jfetch('/api/meta/participant-roles');
  const sel = $('joinRole');
  sel.innerHTML = '';
  Object.entries(roles.data).forEach(([k, v]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = k + ' (' + v + ')';
    if (v === 'ASSIGNED_AGENT') {
      o.selected = true;
    }
    sel.appendChild(o);
  });
}

async function onConnect() {
  let payload;
  try {
    payload = getConnectPayload();
  } catch (e) {
    alert(e.message || String(e));
    return;
  }
  setConnectConnecting(true);
  try {
    await jfetch('/api/connection/open', { method: 'POST', body: JSON.stringify(payload) });
    await refreshStatus();
    await listConversations('after_connect');
  } finally {
    setConnectConnecting(false);
  }
}

async function onDisconnect() {
  await jfetch('/api/connection/close', { method: 'POST', body: '{}' });
  state.selectedId = null;
  resetAgentComposeAutomation();
  $('detailPanel').hidden = true;
  await refreshStatus();
  renderConversations([]);
  setConvListStatus('Disconnected — list cleared.');
}

function wire() {
  loadSoundMutedFromStorage();
  updateMuteButtonUi();

  $('authMode').addEventListener('change', onAuthModeChange);

  const btnMute = $('btnSoundMute');
  if (btnMute) {
    btnMute.addEventListener('click', () => {
      state.soundMuted = !state.soundMuted;
      try {
        localStorage.setItem(STORAGE_SOUND_MUTED, state.soundMuted ? '1' : '0');
      } catch (_) {
        /* ignore */
      }
      updateMuteButtonUi();
      primeAudioContext();
    });
  }

  $('btnConnect').addEventListener('click', () =>
    primeAudioContext().finally(() => onConnect().catch((e) => alert(e.message)))
  );
  $('btnDisconnect').addEventListener('click', () => onDisconnect().catch((e) => alert(e.message)));
  $('btnRefresh').addEventListener('click', () => refreshStatus().catch((e) => alert(e.message)));
  $('btnListConv').addEventListener('click', () => {
    primeAudioContext().catch(() => {});
    console.info('[demo] Refresh list button clicked');
    listConversations('refresh_button').catch((e) => alert(e.message));
  });

  $('btnAvailOnline').addEventListener('click', () =>
    submitAvailability('ONLINE').catch((e) => alert(e.message))
  );
  $('btnAvailAway').addEventListener('click', () =>
    submitAvailability('AWAY').catch((e) => alert(e.message))
  );
  $('btnAvailBackSoon').addEventListener('click', () =>
    submitAvailability('BACK_SOON').catch((e) => alert(e.message))
  );
  $('btnAvailOffline').addEventListener('click', () =>
    submitAvailability('OFFLINE').catch((e) => alert(e.message))
  );
  $('btnRingSub').addEventListener('click', () =>
    jfetch('/api/rings/subscribe', { method: 'POST', body: '{}' })
      .then((r) => {
        logEvent('rings/subscribe: ' + JSON.stringify(r.data));
        return renderRings();
      })
      .catch((e) => alert(e.message))
  );

  $('btnClearLog').addEventListener('click', () => {
    $('eventLog').innerHTML = '';
  });

  $('btnJoin').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    const role = $('joinRole').value;
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/join', {
      method: 'POST',
      body: JSON.stringify({ role }),
    })
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
      })
      .catch((e) => alert(e.message));
  });

  $('btnSend').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    const text = $('msgText').value;
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/messages', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
      .then((r) => {
        $('msgText').value = '';
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
        return onAgentMessageSent();
      })
      .catch((e) => alert(e.message));
  });

  $('msgText').addEventListener('input', onMessageTextInput);
  $('msgText').addEventListener('blur', onMessageTextBlur);

  $('btnTransfer').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    const skillId = $('xferSkill').value.trim() || null;
    const agentId = $('xferAgent').value.trim() || null;
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/transfer', {
      method: 'POST',
      body: JSON.stringify({ skillId, agentId }),
    })
      .then(() => refreshConversationsUi())
      .catch((e) => alert(e.message));
  });

  $('btnLeave').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/leave', { method: 'POST', body: '{}' })
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
        state.selectedId = null;
        const panel = $('detailPanel');
        if (panel) {
          panel.hidden = true;
        }
        resetAgentComposeAutomation();
        setTypingLiveLine('Others: —');
        updateConsumerTypingBadge('ACTIVE');
        return listConversations('after_leave');
      })
      .catch((e) => alert(e.message));
  });

  $('btnCloseMain').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    if (!window.confirm('Close MAIN dialog only? (PCS / survey may still run — see SDK docs.)')) {
      return;
    }
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/close', {
      method: 'POST',
      body: JSON.stringify({ mode: 'mainDialog' }),
    })
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
      })
      .catch((e) => alert(e.message));
  });

  $('btnCloseFull').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    if (!window.confirm('Close ENTIRE conversation? This can skip post-conversation surveys (SDK docs).')) {
      return;
    }
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/close', {
      method: 'POST',
      body: JSON.stringify({ mode: 'full' }),
    })
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
      })
      .catch((e) => alert(e.message));
  });

  $('btnLoadHist').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/history', { method: 'POST', body: '{}' })
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
      })
      .catch((e) => alert(e.message));
  });

  $('btnAccept').addEventListener('click', () => doAccRead('accept'));
  $('btnRead').addEventListener('click', () => doAccRead('read'));

  function doAccRead(mode) {
    if (!state.selectedId) {
      return;
    }
    const seq = String($('seqInput').value || '').trim();
    if (!seq) {
      alert('Enter message sequence number from the list below.');
      return;
    }
    const path =
      mode === 'accept'
        ? '/messages/' + encodeURIComponent(seq) + '/accept'
        : '/messages/' + encodeURIComponent(seq) + '/read';
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + path, { method: 'POST', body: '{}' }).catch(
      (e) => alert(e.message)
    );
  }
}

function renderRings() {
  jfetch('/api/rings')
    .then((j) => {
      const ul = $('ringList');
      ul.innerHTML = '';
      (j.data || []).forEach((r) => {
        const li = document.createElement('li');
        li.className = 'ring-line';
        li.textContent = `${r.ringId}  ${r.ringState}  conv ${r.conversationId}`;
        const bar = document.createElement('div');
        bar.className = 'ring-actions';
        const b1 = document.createElement('button');
        b1.type = 'button';
        b1.textContent = 'Accept';
        b1.addEventListener('click', () => {
          jfetch('/api/rings/' + encodeURIComponent(r.ringId) + '/accept', { method: 'POST', body: '{}' })
            .then(() => {
              soundRingAccepted();
              return refreshConversationsUi().catch(() => {});
            })
            .catch((e) => alert(e.message));
        });
        const b2 = document.createElement('button');
        b2.type = 'button';
        b2.textContent = 'Reject';
        b2.addEventListener('click', () => {
          jfetch('/api/rings/' + encodeURIComponent(r.ringId) + '/reject', { method: 'POST', body: '{}' })
            .then(() => refreshConversationsUi().catch(() => {}))
            .catch((e) => alert(e.message));
        });
        bar.appendChild(b1);
        bar.appendChild(b2);
        li.appendChild(bar);
        ul.appendChild(li);
      });
    })
    .catch(() => {});
}

setInterval(() => {
  if (!document.hidden) {
    renderRings();
  }
}, 5000);

(async function init() {
  wire();
  onAuthModeChange();
  startSse();
  await loadHints().catch(() => {});
  await loadMeta().catch(() => {});
  await refreshStatus().catch(() => {});
  await listConversations('page_load').catch(() => {});
  renderRings();
})();

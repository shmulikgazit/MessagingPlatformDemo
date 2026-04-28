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
};

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
  await listConversations();
  if (!state.selectedId || !$('convJson')) {
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
      if (t === 'participant-chat-state') {
        applyParticipantChatStateFromSse(o);
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
    btn.className = 'conv-item' + (state.selectedId === id ? ' active' : '');
    btn.textContent = `${id} · ${c.stage || ''} · skill ${c.skill ? c.skill.skillId : '?'}`;
    btn.addEventListener('click', () => selectConversation(id));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function listConversations() {
  const j = await jfetch('/api/conversations');
  renderConversations(j.data);
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
    await listConversations();
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
}

function wire() {
  $('authMode').addEventListener('change', onAuthModeChange);

  $('btnConnect').addEventListener('click', () => onConnect().catch((e) => alert(e.message)));
  $('btnDisconnect').addEventListener('click', () => onDisconnect().catch((e) => alert(e.message)));
  $('btnRefresh').addEventListener('click', () => refreshStatus().catch((e) => alert(e.message)));
  $('btnListConv').addEventListener('click', () => listConversations().catch((e) => alert(e.message)));

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
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
      })
      .catch((e) => alert(e.message));
  });

  $('btnLeave').addEventListener('click', () => {
    if (!state.selectedId) {
      return;
    }
    jfetch('/api/conversations/' + encodeURIComponent(state.selectedId) + '/leave', { method: 'POST', body: '{}' })
      .then((r) => {
        $('convJson').textContent = JSON.stringify(r.data, null, 2);
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
            .then(() => refreshConversationsUi().catch(() => {}))
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
  await listConversations().catch(() => {});
  renderRings();
})();

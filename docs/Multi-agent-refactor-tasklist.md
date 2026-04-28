# Tasklist: Single server → multiple concurrent agent sessions

This document scopes refactoring the **MessagingPlatformDemo** so **one Express process** can host **multiple independent LP brand connections** (each “seat” logged in as a different LP user/session).  

**Guiding principle:** Phase 1 should be **trustworthy for demos** (clear semantics, predictable limits, understandable failure modes). Phase 2 adds **controls and operability** you would expect before calling something production-worthy.

---

## Goals

- [ ] Multiple browser tabs/operators (or multiple clients) can each maintain their **own** SDK **connection**, **routing state**, **conversations**, and **SSE** stream without clobbering each other.
- [ ] No silent cross-talk: APIs and UI must identify **which** agent session each action targets.
- [ ] Preserve current **solo-operator** behavior behind a sensible default path (optional: single-session shortcut for quick local testing).

## Non-goals (for this refactor)

- Full **multi-region** HA, **Redis** session clustering, **Kubernetes** — treat as beyond this refactor unless Phase 3 is opened.
- Replacing Conversational Cloud **identity**: still **same account**, multiple **distinct LP agents/users**.

## Hard constraints (do not violate)

| Constraint | Notes |
|-----------|------|
| **One `lp-messaging-sdk` connection per LP logical user/session** per process slot | Already assumed by LP; reuse two connections for **same LP user** is invalid / fragile. Document in UI/API. |
| **Memory scales with concurrent connections** each holds WebSocket state | Cap concurrent sessions explicitly in Phase 1. |
| **Demo remains copy-paste runnable** | Default `npm start`; multi-session shouldn’t block single-session dev. |

---

## Architecture anchors (decisions to lock early)

Capture these in a short ADR paragraph or README section when implementing:

| Decision | Phase 1 (demo default) | Phase 2 (hardened) |
|----------|------------------------|---------------------|
| **Session token** returned from `POST /api/connection/open` | Cryptographically random **`sessionId`** (UUID) | Same + optionally **signed JWT** / **encrypted cookie** |
| **Client carries session** on every API | Header **`X-Agent-Session: <uuid>`** (simple, explicit) | **HttpOnly SameSite cookie** + CSRF posture if cookie-based POSTs expand |
| **SSE transport** | **Dedicated endpoint per session** **`GET /api/events/:sessionId`** *or* one stream with **`sessionId` on each payload** (pick one pattern and stick to it) | Dedicated stream + authorization before subscribe |
| **`lib/lpWorkspace.js` shape** | **Map** `<sessionId> → WorkspaceContext`** (handlers, broadcasts, timeouts) | Inject **logger**, **metering**, TTL sweeper |

### Key code touch-points (estimated)

| Area | Responsibility |
|------|----------------|
| `lib/lpWorkspace.js` | Split global singleton → **workspace factory/context** keyed by session; **`setBroadcaster` becomes per-session** |
| `server.js` | Resolve session middleware; route registration; SSE per session or multiplex |
| `public/app.js` | Store `sessionId` after connect; **`fetch` wrapper attaches header**; **SSE URL includes session**; disconnect clears local state |

---

## Phase 1 — Demo-worthy multi-agent (implement first)

_Use this milestone for stakeholder demos._  
_Complete set for the “vertical slice”: two browsers, two LP users, no shared corruption._

### 1.1 Session & workspace lifecycle

- [ ] Introduce **`WorkspaceContext`** (name flexible) holding: `connection`, `connectionPromise`, `conversations`, `rings`, **broadcast scoped to SSE clients of this session**, `lastAuthSummary`, helpers.
- [ ] Maintain **`sessions = Map<sessionId, WorkspaceContext>`** at module scope in `lib/` layer (or a small `sessions.js`).
- [ ] **`POST /api/connection/open`**: allocate **new `sessionId`**, spawn connection into `sessions`, return `{ sessionId, snapshot }` (keep snapshot shape documented in API contract).
- [ ] **`POST /api/connection/close`**: require **`X-Agent-Session`**; teardown that context only (**`disconnect`**, **clear maps**, close SSE registrations**).
- [ ] **`GET /api/status`**, **`GET /api/conversations`**, **rings**, **typing**, **meta**: all accept **`X-Agent-Session`** and route to correct context (**400** when missing / unknown session).

### 1.2 SSE

- [ ] **Option A**: `GET /api/events/:sessionId` registers **only that session’s broadcast** recipients.  
- [ ] **Option B**: Single `/api/events` but every payload carries **`sessionId`**; browser filters (**simpler server, weaker isolation** — prefer Option A if time allows).
- [ ] SSE **unregister** when client disconnects (**no orphaned `res`** in broadcast sets).

### 1.3 Client (minimal churn)

- [ ] Persist **`sessionId` in memory** after successful connect (**`sessionStorage`** optional for reload within one tab).
- [ ] Extend **`fetch` wrapper** (`jfetch`) with default header **`X-Agent-Session`** when set.
- [ ] Instantiate **`EventSource`** with URL including **`sessionId`** (if Option A).
- [ ] Disconnect button sends close with header; clears **`sessionId`**.

### 1.4 Safety rails (still “demo”)

- [ ] **`MAX_AGENT_SESSIONS`** env (**default**, e.g. **5**) — **`503`** or **`429`** with readable JSON when exceeded.
- [ ] Decide **duplicate Open** semantics: **reject** (**409**) when session already connected *or* allow **replacement** (**document explicitly** in README snippet).
- [ ] Structured **error body** `{ error, sessionId?, code? }** for predictable UI alerts.

### 1.5 Documentation & handoff for demos

- [ ] **`README.md`**: subsection **“multi-session vs two ports”** — two **`PORT`** terminals *vs* one server + **`X-Agent-Session`**.
- [ ] **`TROUBLESHOOTING.md`**: “Wrong session”, “Stale UUID”, **max sessions** reached.
- [ ] Smoke **manual checklist**: two browsers × two LP users ✓ rings ✓ SSE ✓ isolation ✓.

---

## Phase 2 — Production-worthiness enhancements

_Use when hardening exposure beyond trusted networks._

### 2.1 Security & tenancy

- [ ] Bind **`sessionId` → authenticated principal** (minimal): optional **`SESSION_SIGNING_SECRET`**, cookie signing, or **short-lived JWT** on connect success.
- [ ] Prevent **session guessing**: **UUID v4**, validate shape; avoid logging raw session in production logs (**prefix/suffix truncation**).
- [ ] Confirm **POST** body limits on all mutating routes (existing JSON ceiling — extend if multipart added later).

### 2.2 Reliability & resource governance

- [ ] **`SESSION_IDLE_MS`** — auto-**disconnect** idle LP sockets (optional SSE ping before teardown).
- [ ] **`SIGTERM`**: bounded graceful teardown of all sessions (**timeout** fallback).
- [ ] Extend **`GET /api/health`**: **`{ ok, activeSessions }`**.

### 2.3 Observability

- [ ] Log correlation:** `sessionShort` (**last 8 hex**) + **`requestId`** per HTTP request (**optional middleware**).
- [ ] Histogram-friendly counters:** `sessions_open_total`, **`session_open_latency_ms`** (logs or Prometheus hook).
- [ ] **`DEBUG_SDK`**: masked credentials only (**never bearer tokens full string**).

### 2.4 Abuse & fairness

- [ ] Rate limit **`POST /api/connection/open`** (**per IP**; configurable).
- [ ] Burst control on repeated open from same fingerprint window.

### 2.5 Testing posture

- [ ] **Integration tests:** session A+B isolation; forbidden cross-header access.
- [ ] **SSE tests:** subscriber A never receives payload bound to **B** (under Option **A**) or payloads tagged (Option **B**).
- [ ] **`MAX_AGENT_SESSIONS`**: **N OK**, **N+1** rejects cleanly.

---

## Phase 3 / deferred backlog

| Item | When |
|------|------|
| **Redis sticky sessions**, multi-instance | Fleet scale-out |
| **Horizontal SSE** broadcasting | LB without stickiness |
| **Full SOC2 audit envelope** | Enterprise compliance lane |

---

## Suggested sequencing

1. Phase **1.1** backend **`Map`** + **`open`** / **`close`** contract.  
2. Phase **1.3** client header + **`jfetch`** in parallel once **`sessionId`** returns.  
3. Phase **1.2** SSE (**Option A preferred**).  
4. Docs + smoke checklist.  
5. Phase **2** prioritized by deployment risk (**2.1** + **2.2** first for any non-local demo).

---

## Sign-off checklist

**Phase 1 done** when:

- [ ] Two **distinct LP users** coexist without wrong **conversation/session** bleed.  
- [ ] Bad / missing **`X-Agent-Session`** fails safe.  
- [ ] Disconnecting one session leaves others intact.

**Production pilot** readiness (beyond demo): complete **Phase 2.1**, **2.2 idle**, plus **minimal rate limits (2.4)** unless entirely behind authenticated VPN only.

---

*Update this tasklist statuses as work progresses; optionally mirror into issues per epic.*

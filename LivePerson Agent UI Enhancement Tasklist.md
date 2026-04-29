# LivePerson Agent UI — Enhancement Tasklist (Main App)

This task list applies to the **Messaging Platform Demo** in the **repository root** (`server.js`, `lib/lpWorkspace.js`, `public/`). It is derived from the phased plan in **`Sahar/LivePerson Agent UI Enhancement Plan.md`**, updated to reflect what is already implemented here (not the Sahar reference bundle).

**How to use**

| Marker | Meaning |
|--------|---------|
| ✅ | Implemented in the main app (as of last review) |
| 🔄 | Partially done — see notes |
| ⬜ | Not started / gap vs plan |

---

## Phase 1 — Repeatable baseline (CLI + configuration)

| Status | Task |
|--------|------|
| ✅ | Proxy optional via `.env` (`PROXY_HOST` / `PROXY_PORT` or legacy `FIDDLER_*`); no mandatory Fiddler in code paths (`lib/lpWorkspace.js`, `index.js`) |
| ✅ | TLS relaxation only when `USE_FIDDLER` / `ALLOW_INSECURE_TLS` is set |
| ✅ | Connection status surfaced via API: `GET /api/status` (connected, auth summary, agent availability, user/agent ids, profile snippet) |
| ✅ | Connection hints for demos: `GET /api/connection/hints` (account id hint, demo usernames, OAuth presence) |
| 🔄 | Structured logging: operational messages exist (`console.warn` / selective debug); **no** unified structured logger or log levels across connection / subscription / messages |
| ✅ | Secrets intended only in `.env`; `.env.example`-doc’d patterns |
| ✅ | Credential modes documented: OAuth1, password (Agent VEP), session bearer (`README.md`, `.env.example`) |
| ✅ | CLI probe retained: `npm run connect-demo` → `index.js` |

**Remaining**

- ⬜ Optional: single diagnostic script or npm script that prints a one-page connection report (account id, auth mode, proxy on/off, subscribe OK) without opening the browser
- ⬜ Optional: structured JSON logging toggle via env for operators

---

## Phase 2 — Backend API skeleton

The plan suggested paths like `/lp/...`. This repo uses **`/api/...`** — behavior aligns unless noted.

| Status | Planned capability | Main app |
|--------|-------------------|----------|
| ✅ | Health | `GET /api/health` |
| ✅ | LP / connection status | `GET /api/status`, `GET /api/connection/hints` |
| ✅ | Connect / disconnect | `POST /api/connection/open`, `POST /api/connection/close` |
| ✅ | List conversations | `GET /api/conversations` |
| ✅ | Conversation detail + messages | `GET /api/conversations/:id` (enriched messages/participants) |
| ✅ | Join | `POST /api/conversations/:id/join` (role, default `ASSIGNED_AGENT`) |
| ✅ | Send message | `POST /api/conversations/:id/messages` |
| ✅ | Messages history hydrate | `POST /api/conversations/:id/history` |
| ✅ | Transfer (skill and/or agent) | `POST /api/conversations/:id/transfer` body `{ skillId?, agentId? }` |
| 🔄 | “Back to queue” as its own endpoint | Covered operationally via **leave** (`POST .../leave`) / SDK events — **not** a separately named route |
| ✅ | Close | `POST /api/conversations/:id/close` (`mode`: `full` or `mainDialog`) |
| ✅ | Typing | `POST /api/conversations/:id/typing` |
| ✅ | Delivery/read helpers | `POST .../messages/:sequence/accept`, `POST .../messages/:sequence/read` |
| ✅ | Agent availability | `POST /api/agent/online`, `POST /api/agent/availability`, `GET /api/meta/agent-states` |
| ✅ | Routing rings | `POST /api/rings/subscribe`, `GET /api/rings`, accept/reject |
| ✅ | Meta | `GET /api/meta/participant-roles`, `GET /api/meta/chat-states` |
| 🔄 | Normalize LP payloads to documented **DTO/schema** | Responses are consistent JSON but **no** published OpenAPI / JSON Schema |

**Remaining**

- ⬜ Publish OpenAPI or minimal JSON Schema for frontend/contracts
- ⬜ Align naming with plan if external docs expect `/lp/*` (optional alias routes)

---

## Phase 3 — Identity and login model (product-ready)

| Status | Task |
|--------|------|
| ✅ | Multiple **LivePerson** auth modes in demo: password, OAuth1 app user, bearer session (`authAgentSessionData`) |
| 🔄 | **Per-representative product identity**: single shared SDK connection per server process — **no** MySahar (or other CRM) user ↔ LP agent mapping store |
| ⬜ | SSO/OIDC end-to-end for agents (IdP redirect, token exchange, session handoff to SDK) beyond manual session JSON paste |
| ⬜ | Enforce “send only as mapped LP user” using app login — requires auth middleware + mapping DB |
| ⬜ | Audit trail persistence (who viewed/joined/sent/transferred/closed) — UI logs locally only |
| ⬜ | Roles/skills sync job from LP |

**Remaining (summary)** — largest gap vs production/Sahar vision: **tenant-side identity, mapping, and audit**.

---

## Phase 4 — Agent workspace UI

| Status | Task |
|--------|------|
| ✅ | Browser workspace (static **`public/`**: `index.html`, `app.js`, `styles.css`) — **not** React as in Sahar reference |
| ✅ | Connection panel: auth mode, credentials/session, connect/disconnect |
| ✅ | Session / availability pills; refresh status |
| ✅ | Conversation list + selection |
| ✅ | Detail pane: message thread (bubbles), composer, join with role |
| ✅ | Transfer fields (skill / agent), leave, close MAIN vs full with confirms |
| ✅ | Load full history button |
| ✅ | Raw JSON inspector for selected conversation |
| ✅ | Rings UI + subscribe |
| ✅ | Connection/event log; notification sounds (mute) |
| 🔄 | **Conversation timer** (SLA/elapsed) — not present vs Sahar dashboard concept |
| 🔄 | **Multi-conversation** parallel tabs/layout — single active detail view; list supports many |
| 🔄 | Advanced widgets/stats dashboard — minimal demo only |

**Remaining**

- ⬜ Optional: migrate to React (or keep vanilla) per team preference — Sahar bundle used TSX components only as reference
- ⬜ Conversation timer if required for demos
- ⬜ Multi-pane or tabbed concurrent chats if required

---

## Phase 5 — Real-time events

| Status | Task |
|--------|------|
| ✅ | Backend subscribes to SDK conversation/messaging-related events; forwards via **`GET /api/events` (SSE)** |
| ✅ | Frontend refreshes list/detail from SSE topics (messages, transfers, rings, typing-related topics, etc.) |
| ✅ | Representative typing → consumer (`ParticipantChatState` / composer automation in UI) |
| ✅ | Consumer typing / participant chat state surfaced (`participant-chat-state`, badges) |
| 🔄 | WebSocket transport — **SSE used** instead of WS (fine for browser push; differs from plan wording) |
| ✅ | Polling fallback: manual refresh + periodic ring list refresh only where needed |

**Remaining**

- ⬜ WebSocket parity only if bi-directional or infra requires WS

---

## Phase 6 — Transfer, queue, and close workflows

| Status | Task |
|--------|------|
| ✅ | Transfer to skill and/or agent (`transfer` + SDK events) |
| ✅ | Leave conversation (agent workload removal; aligns with operational “step away” flows) |
| ✅ | Close MAIN dialog vs full conversation with warnings about PCS/survey |
| ✅ | Confirm dialogs for destructive closes |
| 🔄 | Explicit **“back to queue”** UX label vs **leave** — behavior depends on LP routing; UI uses **Leave** |

**Remaining**

- ⬜ Confirm with LP account whether a dedicated back-to-queue API must be exposed separately from leave
- ⬜ Surface transfer/back-to-queue failures with richer inline UI (beyond `alert`)

---

## Phase 7 — Hardening and readiness

| Status | Task |
|--------|------|
| 🔄 | SDK reconnect signals exposed over SSE (`connection-reconnecting`, etc.); **no** automated soak tests |
| ⬜ | Rate-limit handling/retry UX |
| ⬜ | Automated tests (mapping, permissions, normalized events) |
| 🔄 | Deployment notes: **`README.md`** + **`TROUBLESHOOTING.md`** (proxy, firewall); **no** full runbook |
| ⬜ | Demo script with expected screenshots/actions |
| ⬜ | Per-agent connection limits / idle timeout policy in app layer |

---

## Suggested first-build milestone (plan § “Suggested First Build Scope”)

Cross-check vs main app:

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Authenticate a demo user | ✅ Password / OAuth1 / pasted session |
| 2 | Map user → LP identity | 🔄 Single LP session only; **no** external user mapping |
| 3 | Show open conversations | ✅ Via subscription + list API |
| 4 | Open one conversation | ✅ Select + snapshot |
| 5 | Join as `ASSIGNED_AGENT` | ✅ Default in UI |
| 6 | Send a message | ✅ |
| 7 | Representative display name in UI / events | ✅ Status + enriched participant profiles where SDK returns data |
| 8 | Evidence that shared login is insufficient for production attribution | 🔄 Documented in Sahar plan; **not** enforced in code |

---

## Quick “what’s left” prioritization

1. **Identity & audit** (Phase 3) — if MySahar-style integration is real; otherwise defer.
2. **DTO/contracts** (Phase 2) — OpenAPI/schemas for stable integrations.
3. **UI polish** (Phase 4) — timer, multi-chat layout, fewer `alert()` flows.
4. **Hardening** (Phase 7) — tests, demo script, operational logging.

---

*Reference plan location (historical): `Sahar/LivePerson Agent UI Enhancement Plan.md` — enhancement work targets **this** repo root, not the Sahar folder.*

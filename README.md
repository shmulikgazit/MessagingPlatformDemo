# Messaging Platform SDK — Demo workspace

A small **Express** app plus a browser UI that wraps the official **[LivePerson Messaging Platform SDK](https://developers.liveperson.com/messaging-platform-sdk-overview.html)** (`lp-messaging-sdk`) **brand** (agent) workspace. Use it to sign in as a human agent or app user, drive **availability** (`setAgentState`), **routing rings**, **conversations**, **typing (`ParticipantChatState`)**, and to watch activity over **Server-Sent Events (SSE)**.

## Requirements

- **Node.js** (LTS recommended) and **npm**

## Setup

```bash
npm install
```

Copy the environment template and fill in your account details (never commit real secrets):

```bash
copy .env.example .env
```

Edit `.env` at minimum:

- **`ACCOUNT_ID`** — your Conversational Cloud account ID  
- **`LP_AUTH_MODE`** and credentials for **one** login path (see **Authentication** below)

Optional: **`PORT`** (default **3000**), **`LP_DEMO_USERNAMES`** for quick-fill usernames in the UI, **`LP_AUTH_MODE`**, OAuth keys, subscription filters — all are documented inline in `.env.example`.

## Run

```bash
npm start
```

Open **http://localhost:3000** (or `http://localhost:<PORT>`). The UI is served from **`public/`**.

For **auto-restart** on backend changes while developing:

```bash
npm run dev
```

## CLI probe (optional)

Loads configuration from `.env` and connects using the Messaging Platform SDK (password mode if **`LPM_PASSWORD`** is set, otherwise OAuth1 keys):

```bash
npm run connect-demo
```

## Authentication (summary)

| Mode | Typical use |
|------|--------------|
| **Password** (`LP_AUTH_MODE=password`) | Human agent — SDK uses Agent VEP login (`authData.username` / `password`). Enter credentials in the web UI as well when not using `.env`. |
| **OAuth1** | Automated / bot-style app user when the six OAuth env vars are present. |
| **Session** | Pre-built bearer session — **`authAgentSessionData`: `token`, `csrf`, `sessionId`** via the UI when using SAML-like flows (not full IdP wiring in this demo). |

Details and naming match **`lp-messaging-sdk`**; do not mix bearer fields into `authData` as arbitrary `accessToken`.

## Project layout

| Path | Role |
|------|------|
| **`server.js`** | Express: static **`public/`**, REST API, SSE **`/api/events`**. |
| **`lib/lpWorkspace.js`** | SDK connection, conversations, rings, status, typing, broadcasts to SSE. |
| **`public/`** | Static demo UI (`index.html`, `app.js`, `styles.css`). |
| **`index.js`** | Standalone connection demo for **`npm run connect-demo`**. |

## Health check

```http
GET /api/health
```

## Troubleshooting

See **`TROUBLESHOOTING.md`** for common connection and workspace issues.

## Security

- Keep **`.env`** out of version control (it is listed in **`.gitignore`**).  
- Do not paste production passwords into files you share or commit.

## License

See **`package.json`** (`license` field).

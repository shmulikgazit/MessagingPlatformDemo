# Troubleshooting LivePerson Messaging Platform SDK Connection

## Web workspace (new)

From the project root, with `.env` filled the same way as the basic script:

```bash
npm start
```

Then open the URL printed in the console (by default `http://127.0.0.1:3000`). The UI is static files in `public/`; the server process holds one brand SDK connection and streams events to the browser over Server-Sent Events (`/api/events`).

The original command-line check remains available as `npm run connect-demo` (runs `index.js`).

---

This document provides common solutions for the "VError: Error opening websocket connection" issue, especially when working behind a proxy or firewall.

## 1. Proxy Configuration
The SDK requires a global proxy configuration to handle both authentication (HTTP) and the WebSocket connection.

### How to configure:
In your `index.js`, use the built-in `configureProxy` method before creating the connection:

```javascript
const lpm = require('lp-messaging-sdk');

lpm.configureProxy({
    host: 'your.proxy.host',
    port: 8080,
    protocol: 'http', // or 'https'
    // auth: { username: '...', password: '...' } // if required
});
```

### Common Proxy Issues:
- **WebSocket Protocol Support**: Many enterprise proxies allow `HTTPS` (port 443) but block the `WebSocket Upgrade` (HTTP 101). Ensure your proxy is configured to allow `WSS` traffic.
- **conflicting Environment Variables**: If you have `HTTPS_PROXY` or `HTTP_PROXY` set in your environment, they might conflict with how the SDK handles the WebSocket handshake. Prefer using `lpm.configureProxy`.

## 2. Authentication (401 Errors)
If you see 401 errors before the WebSocket error, check the following:
- **Credentials**: Ensure all 4 OAuth 1.0 values (App Key, Secret, Access Token, Access Token Secret) are correct.
- **Username**: Brand-side connections **require** a `username` (email or bot login name) in the `authData` object.
- **Account Permissions**: Ensure the API user has the "Agent" or "Bot" role and is enabled for the Messaging Platform.

## 3. Network and Firewall
Ensure the following domains are allowlisted in your firewall:
- `*.liveperson.net`
- `*.lpcdn.net`
- `*.lpsnmedia.net`

## 4. Timeouts
Websocket handshakes can be slow through proxies. Increase the `responseTimeout` in your connection configuration:

```javascript
const connection = lpm.createConnection({
    accountId: '...',
    userType: lpm.UserType.BRAND,
    responseTimeout: 30000, // Increase to 30 seconds
    authData: { ... }
});
```

## 5. Regional Endpoints
The SDK uses the CSDS service to find the correct regional endpoint. If your network blocks traffic to certain regions (e.g., `va.liveperson.net`, `lo.liveperson.net`), the connection will fail.

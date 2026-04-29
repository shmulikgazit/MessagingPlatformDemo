/**
 * Optional console logging for this demo app's HTTP surface and outbound Skills API calls.
 * Enable with LP_DEBUG_API=1 in .env (no file logging; stdout only).
 */

function isLpDebugApi() {
  return process.env.LP_DEBUG_API === '1' || process.env.LP_DEBUG_API === 'true';
}

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return (
    k.includes('password') ||
    k.includes('secret') ||
    k.includes('token') ||
    k.includes('csrf') ||
    k.includes('sessionid') ||
    k.includes('bearer') ||
    k.includes('authorization') ||
    k === 'authagentsessiondata'
  );
}

/** Shallow-ish clone for logging; redacts likely-secrets by key name. */
function redactForLog(value, depth = 0) {
  if (depth > 8) {
    return '[max-depth]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = '[redacted]';
    } else if (v !== null && typeof v === 'object') {
      out[key] = redactForLog(v, depth + 1);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Logs each /api request and JSON response bodies to the terminal (redacted).
 * @param {import('express').Application} app
 */
function attachApiDebugLogging(app) {
  if (!isLpDebugApi()) {
    return;
  }
  console.warn('[demo-api] LP_DEBUG_API enabled — logging /api requests and JSON responses (secrets redacted).');

  app.use((req, res, next) => {
    if (!req.originalUrl.startsWith('/api')) {
      return next();
    }

    const t0 = Date.now();
    let inbound = '';
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      try {
        inbound = ` ${JSON.stringify(redactForLog(req.body))}`;
      } catch (_) {
        inbound = ' [body unserializable]';
      }
    }
    console.log(`[demo-api] --> ${req.method} ${req.originalUrl}${inbound}`);

    const origJson = res.json.bind(res);
    res.json = function logJsonBody(body) {
      let snippet = '';
      try {
        const r = redactForLog(body);
        snippet = typeof r === 'object' ? JSON.stringify(r) : String(r);
        if (snippet.length > 8000) {
          snippet = `${snippet.slice(0, 8000)}…`;
        }
      } catch (_) {
        snippet = '[response not serializable]';
      }
      console.log(`[demo-api] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t0}ms ${snippet}`);
      return origJson(body);
    };

    next();
  });
}

module.exports = {
  isLpDebugApi,
  attachApiDebugLogging,
  redactForLog,
};

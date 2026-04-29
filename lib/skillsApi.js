/**
 * LivePerson Skills API (Contact Center Management) — transfer skill discovery.
 * @see https://developers.liveperson.com/skills-api-overview.html
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { isLpDebugApi } = require('./apiDebugLog');

/** Dedicated client so debug interceptors never touch other axios users in the process. */
const axiosLp = axios.create();

function attachSkillsAxiosDebug() {
  if (!isLpDebugApi()) {
    return;
  }
  console.warn('[skills-api] LP_DEBUG_API enabled — logging Domain + Skills HTTP calls.');
  axiosLp.interceptors.request.use((config) => {
    console.log(`[skills-api] --> ${(config.method || 'get').toUpperCase()} ${config.url}`);
    return config;
  });
  axiosLp.interceptors.response.use(
    (response) => {
      let snippet = '';
      try {
        const d = response.data;
        snippet = typeof d === 'object' ? JSON.stringify(d) : String(d);
        if (snippet.length > 6000) {
          snippet = `${snippet.slice(0, 6000)}…`;
        }
      } catch (_) {
        snippet = '[unserializable]';
      }
      console.log(`[skills-api] <-- ${response.status} ${response.config.url} ${snippet}`);
      return response;
    },
    (error) => {
      const st = error.response && error.response.status;
      const url = error.config && error.config.url;
      console.warn(`[skills-api] xx ${st || '-'} ${url || '-'} ${error.message}`);
      return Promise.reject(error);
    }
  );
}

attachSkillsAxiosDebug();

const DOMAIN_API =
  'https://api.liveperson.net/api/account/{accountId}/service/accountConfigReadOnly/baseURI.json?version=1.0';

function httpsAgentFromEnv() {
  const host = process.env.PROXY_HOST || process.env.FIDDLER_HOST;
  const port = process.env.PROXY_PORT || process.env.FIDDLER_PORT;
  if (host && port) {
    return new HttpsProxyAgent(`http://${host}:${port}`);
  }
  return undefined;
}

function axiosBaseConfig() {
  const agent = httpsAgentFromEnv();
  return {
    timeout: Number(process.env.SKILLS_API_TIMEOUT_MS) || 60000,
    ...(agent ? { httpsAgent: agent, proxy: false } : {}),
  };
}

async function fetchAccountConfigDomain(accountId) {
  const url = DOMAIN_API.replace('{accountId}', encodeURIComponent(accountId));
  const { data } = await axiosLp.get(url, axiosBaseConfig());
  /** Docs show `{ baseURIs: [{ baseURI }] }`; some responses return a single `{ baseURI }` object. */
  let raw = null;
  if (data && Array.isArray(data.baseURIs) && data.baseURIs.length && data.baseURIs[0].baseURI != null) {
    raw = data.baseURIs[0].baseURI;
  }
  if (!raw && data && typeof data.baseURI === 'string' && data.baseURI.trim()) {
    raw = data.baseURI;
  }
  if (!raw) {
    throw new Error('Domain API: missing baseURI for accountConfigReadOnly');
  }
  return String(raw)
    .trim()
    .replace(/^https?:\/\//i, '');
}

function skillsListPath(accountId) {
  return `/api/account/${encodeURIComponent(accountId)}/configuration/le-users/skills`;
}

function skillByIdPath(accountId, skillId) {
  return `${skillsListPath(accountId)}/${encodeURIComponent(skillId)}`;
}

function normalizeSkillArray(body) {
  if (!body) {
    return [];
  }
  if (Array.isArray(body)) {
    return body;
  }
  for (const k of ['skillObjects', 'skills', 'items', 'records', 'skillConfigurationRecords']) {
    if (body[k] && Array.isArray(body[k])) {
      return body[k];
    }
  }
  return [];
}

function toRow(skill) {
  if (!skill) {
    return null;
  }
  const rawId = skill.id != null ? skill.id : skill.skillId;
  if (rawId == null) {
    return null;
  }
  const skillId = String(rawId).trim();
  const name = skill.name != null ? String(skill.name).trim() : '';
  return {
    skillId,
    label: name || skillId,
  };
}

/** Normalize LE-users skill ids from skillTransferList (numbers, strings, or API-specific shapes). */
function normalizeSkillListEntry(entry) {
  if (entry == null) {
    return null;
  }
  if (typeof entry === 'number' || typeof entry === 'boolean') {
    return String(entry).trim() || null;
  }
  if (typeof entry === 'string') {
    const s = entry.trim();
    return s || null;
  }
  if (typeof entry === 'object') {
    const id =
      entry.skillId != null
        ? entry.skillId
        : entry.id != null
          ? entry.id
          : entry.skill && entry.skill.id != null
            ? entry.skill.id
            : entry.skill && entry.skill.skillId != null
              ? entry.skill.skillId
              : null;
    if (id != null) {
      return String(id).trim() || null;
    }
  }
  const fallback = String(entry).trim();
  return fallback && fallback !== '[object Object]' ? fallback : null;
}

function idsFromSkillTransferList(rawList) {
  if (!Array.isArray(rawList)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const e of rawList) {
    const id = normalizeSkillListEntry(e);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Builds rows for skill ids using Get All Skills when possible, then GET-by-id for any missing (pagination / partial payloads).
 * @param {Set<string>} allowedIds
 */
async function rowsForSkillIds(connection, allowedIds) {
  const all = await getAllSkillsRows(connection);
  const byId = new Map(all.map((r) => [r.skillId, r]));
  const ordered = [...allowedIds];
  const rows = [];
  const missing = [];
  for (const id of ordered) {
    const hit = byId.get(id);
    if (hit) {
      rows.push(hit);
    } else {
      missing.push(id);
    }
  }
  for (const id of missing) {
    try {
      let s = await getSkillById(connection, id);
      if (s && s.id == null && s.skill && s.skill.id != null) {
        s = s.skill;
      }
      const row = toRow(s);
      rows.push(row || { skillId: id, label: id });
    } catch (_) {
      rows.push({ skillId: id, label: id });
    }
  }
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    if (!r || r.skillId == null) {
      continue;
    }
    const k = String(r.skillId).trim();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    deduped.push({ skillId: k, label: r.label || k });
  }
  return deduped.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

async function apiGet(connection, relativePath, queryString) {
  const accountId = connection.accountId;
  const token = await connection.getToken();
  const host = await fetchAccountConfigDomain(accountId);
  const qs = queryString ? (relativePath.includes('?') ? `&${queryString}` : `?${queryString}`) : '';
  const url = `https://${host}${relativePath}${qs}`;
  const { data } = await axiosLp.get(url, {
    ...axiosBaseConfig(),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  return data;
}

/** @param {import('lp-messaging-sdk/lib/connection/connection-websocket-brand')} connection */
async function getAllSkillsRows(connection) {
  const accountId = connection.accountId;
  const data = await apiGet(
    connection,
    `${skillsListPath(accountId)}`,
    'v=4.0&select=id,name,deleted'
  );
  const rows = [];
  const seen = new Set();
  for (const s of normalizeSkillArray(data)) {
    if (!s || s.deleted === true) {
      continue;
    }
    const row = toRow(s);
    if (!row || seen.has(row.skillId)) {
      continue;
    }
    seen.add(row.skillId);
    rows.push(row);
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** @param {import('lp-messaging-sdk/lib/connection/connection-websocket-brand')} connection */
async function getSkillById(connection, skillId) {
  const accountId = connection.accountId;
  return apiGet(connection, `${skillByIdPath(accountId, skillId)}`, 'v=4.0');
}

function mergeEnvRows(apiRows, envRows) {
  const seen = new Set(apiRows.map((r) => r.skillId));
  const out = [...apiRows];
  for (const e of envRows || []) {
    if (!e || e.skillId == null) {
      continue;
    }
    const id = String(e.skillId).trim();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ skillId: id, label: e.label || id });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/**
 * Resolves transferable skills using Skills API + optional current conversation skill.
 * @param {*} connection Open lp-messaging-sdk brand websocket connection (`getToken()` required).
 * @param {string|null|undefined} conversationSkillId conv.skill.skillId from messaging snapshot.
 * @param {Array<{skillId:string,label:string}>} envFallbackSkills
 * @returns {Promise<{ skills: Array, strategy: string, source: string[] }>}
 */
async function resolveTransferSkillsFromApi(connection, conversationSkillId, envFallbackSkills) {
  const sid = conversationSkillId != null && String(conversationSkillId).trim() ? String(conversationSkillId).trim() : null;

  if (!sid) {
    const all = await getAllSkillsRows(connection);
    return {
      skills: mergeEnvRows(all, envFallbackSkills),
      strategy: 'all_skills',
      source: ['skills-api', 'env'],
    };
  }

  let detail;
  try {
    detail = await getSkillById(connection, sid);
  } catch (e) {
    const status = e && e.response && e.response.status;
    if (status !== 404) {
      throw e;
    }
    detail = null;
  }

  if (detail && detail.id == null && detail.skill && detail.skill.id != null) {
    detail = detail.skill;
  }

  if (!detail || detail.id == null) {
    const all = await getAllSkillsRows(connection);
    return {
      skills: mergeEnvRows(all, envFallbackSkills),
      strategy: 'all_skills_fallback',
      source: ['skills-api', 'env'],
    };
  }

  if (detail.canTransfer === false) {
    const row = toRow(detail);
    const label = row ? `${row.label} (requeue only)` : `${sid} (requeue only)`;
    return {
      skills: mergeEnvRows([{ skillId: String(detail.id), label }], envFallbackSkills),
      strategy: 'restricted_requeue',
      source: ['skills-api', 'env'],
    };
  }

  const transferIds = idsFromSkillTransferList(detail.skillTransferList);
  if (transferIds.length > 0) {
    const masterId = detail.id != null ? String(detail.id).trim() : sid;
    const allowed = new Set(transferIds);
    if (masterId) {
      allowed.add(masterId);
    }
    if (sid) {
      allowed.add(String(sid).trim());
    }
    const rows = await rowsForSkillIds(connection, allowed);
    return {
      skills: mergeEnvRows(rows, envFallbackSkills),
      strategy: 'skill_transfer_list',
      source: ['skills-api', 'env'],
    };
  }

  const all = await getAllSkillsRows(connection);
  return {
    skills: mergeEnvRows(all, envFallbackSkills),
    strategy: 'all_skills_open_transfer',
    source: ['skills-api', 'env'],
  };
}

module.exports = {
  resolveTransferSkillsFromApi,
};

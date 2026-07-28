export class ApiError extends Error {
  constructor(data, status) {
    super(data?.error || `Errore HTTP ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function j(method, url, body) {
  const res = await fetch(url, {
    method,
    // Always declared on writes: the server rejects non-JSON POST/PUT
    // (protezione da richieste cross-site).
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    body: JSON.stringify(body ?? (method !== 'GET' ? {} : undefined)),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data, res.status);
  return data;
}

const q = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') s.set(k, v);
  return s.toString();
};

export const api = {
  // connections
  listConnections: () => j('GET', '/api/connections'),
  createConnection: (body) => j('POST', '/api/connections', body),
  updateConnection: (id, body) => j('PUT', `/api/connections/${id}`, body),
  deleteConnection: (id) => j('DELETE', `/api/connections/${id}`),
  testConnection: (body) => j('POST', '/api/connections/test', body),
  previewImportConnections: (content) => j('POST', '/api/connections/import/preview', { content }),
  importConnections: (body) => j('POST', '/api/connections/import', body),
  // `password` solo quando l'utente la digita al volo: il server la salva
  // sulla connessione se il login riesce.
  connect: (id, password) =>
    j('POST', `/api/connections/${id}/connect`, password ? { password } : {}),
  disconnect: (id) => j('POST', `/api/connections/${id}/disconnect`),

  // metadata
  schemas: (id) => j('GET', `/api/conn/${id}/schemas`),
  objects: (id, owner, type) => j('GET', `/api/conn/${id}/objects?${q({ owner, type })}`),
  autocomplete: (id, owner) => j('GET', `/api/conn/${id}/autocomplete?${q({ owner })}`),
  tableColumns: (id, owner, name) =>
    j('GET', `/api/conn/${id}/table/columns?${q({ owner, name })}`),
  tableData: (id, params) => j('GET', `/api/conn/${id}/table/data?${q(params)}`),
  tableCount: (id, params) => j('GET', `/api/conn/${id}/table/count?${q(params)}`),
  tableConstraints: (id, owner, name) =>
    j('GET', `/api/conn/${id}/table/constraints?${q({ owner, name })}`),
  tableIndexes: (id, owner, name) =>
    j('GET', `/api/conn/${id}/table/indexes?${q({ owner, name })}`),
  tableTriggers: (id, owner, name) =>
    j('GET', `/api/conn/${id}/table/triggers?${q({ owner, name })}`),
  tableComment: (id, owner, name) =>
    j('GET', `/api/conn/${id}/table/comment?${q({ owner, name })}`),
  source: (id, owner, name, type) =>
    j('GET', `/api/conn/${id}/source?${q({ owner, name, type })}`),
  errors: (id, owner, name, type) =>
    j('GET', `/api/conn/${id}/errors?${q({ owner, name, type })}`),
  viewText: (id, owner, name) => j('GET', `/api/conn/${id}/view/text?${q({ owner, name })}`),
  ddl: (id, owner, name, type) => j('GET', `/api/conn/${id}/ddl?${q({ owner, name, type })}`),
  sequenceDetails: (id, owner, name) =>
    j('GET', `/api/conn/${id}/sequence?${q({ owner, name })}`),
  synonymDetails: (id, owner, name) =>
    j('GET', `/api/conn/${id}/synonym?${q({ owner, name })}`),
  indexDetails: (id, owner, name) => j('GET', `/api/conn/${id}/index?${q({ owner, name })}`),

  // sql
  execute: (id, body) => j('POST', `/api/conn/${id}/execute`, body),
  explain: (id, body) => j('POST', `/api/conn/${id}/explain`, body),
  commit: (id) => j('POST', `/api/conn/${id}/commit`, {}),
  rollback: (id) => j('POST', `/api/conn/${id}/rollback`, {}),
  cancel: (id) => j('POST', `/api/conn/${id}/cancel`, {}),
  status: (id) => j('GET', `/api/conn/${id}/status`),

  // confronto fra due database
  diffRun: (body) => j('POST', '/api/diff/run', body),
  diffDetail: (runId, type, name) =>
    j('GET', `/api/diff/${runId}/detail?${q({ type, name })}`),
  diffScript: (runId, body) => j('POST', `/api/diff/${runId}/script`, body),

  // assistente AI
  aiSettings: () => j('GET', '/api/ai/settings'),
  saveAiSettings: (body) => j('PUT', '/api/ai/settings', body),
  aiModels: (provider, refresh) =>
    j('GET', `/api/ai/models?${q({ provider, refresh: refresh ? '1' : '' })}`),
  aiSessions: () => j('GET', '/api/ai/sessions'),
  aiCreateSession: (body) => j('POST', '/api/ai/sessions', body),
  aiSession: (id) => j('GET', `/api/ai/sessions/${id}`),
  aiUpdateSession: (id, body) => j('PATCH', `/api/ai/sessions/${id}`, body),
  aiDeleteSession: (id) => j('DELETE', `/api/ai/sessions/${id}`),
  aiSend: (id, text) => j('POST', `/api/ai/sessions/${id}/messages`, { text }),
  aiApprove: (id, body) => j('POST', `/api/ai/sessions/${id}/approve`, body),
  aiStop: (id) => j('POST', `/api/ai/sessions/${id}/stop`, {}),
  aiEventsUrl: (id) => `/api/ai/sessions/${id}/events`,

  // cronologia query
  history: (params) => j('GET', `/api/history?${q(params)}`),
  deleteHistoryEntry: (entryId) => j('DELETE', `/api/history/${entryId}`),
  clearHistory: (connId) => j('DELETE', `/api/history?${q({ connId })}`),
};

// src/integrations/supabase/client.ts
// Cliente HTTP customizado — espelha a interface @supabase/supabase-js
// Todas as chamadas vão para VITE_API_URL (backend Express próprio)
// NÃO usa Supabase real — zero dependência externa

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

// ── Token helpers ─────────────────────────────────────────────
function _getToken(): string | null { return localStorage.getItem('access_token'); }

function _authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = _getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

function _decodeUser(token: string): any | null {
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return { id: p.sub, email: p.email, role: p.role, display_name: p.display_name,
      user_metadata: { display_name: p.display_name }, app_metadata: { role: p.role }, aud: 'authenticated' };
  } catch { return null; }
}

function _isExpired(token: string): boolean {
  try { const p = JSON.parse(atob(token.split('.')[1])); return p.exp ? p.exp * 1000 < Date.now() + 30_000 : false; }
  catch { return true; }
}

let _currentUser: any = null;
let _authCallbacks: Array<(event: string, session: any) => void> = [];
function _notify(ev: string, s: any) { _authCallbacks.forEach(cb => cb(ev, s)); }

// ── Auth ──────────────────────────────────────────────────────
const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: { message: e.message || 'Login falhou' } }; }
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    _currentUser = data.user;
    const session = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user };
    _notify('SIGNED_IN', session);
    return { data: { user: data.user, session }, error: null };
  },

  async signUp({ email, password, options }: { email: string; password: string; options?: any }) {
    const display_name = options?.data?.display_name || options?.data?.name;
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: { message: e.message || 'Cadastro falhou' } }; }
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    _currentUser = data.user;
    const session = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user };
    _notify('SIGNED_IN', session);
    return { data: { user: data.user, session }, error: null };
  },

  async signOut() {
    const refreshToken = localStorage.getItem('refresh_token');
    const token = _getToken();
    if (token) await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: _authHeaders(), body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => {});
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    _currentUser = null;
    _notify('SIGNED_OUT', null);
    return { error: null };
  },

  async getUser() {
    const token = _getToken();
    if (!token) return { data: { user: null }, error: null };
    if (_isExpired(token)) { const ok = await auth._refreshSilent(); if (!ok) { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); _currentUser = null; return { data: { user: null }, error: null }; } }
    if (!_currentUser) _currentUser = _decodeUser(localStorage.getItem('access_token')!);
    return { data: { user: _currentUser }, error: null };
  },

  async getSession() {
    const token = _getToken();
    if (!token) return { data: { session: null }, error: null };
    if (_isExpired(token)) { const ok = await auth._refreshSilent(); if (!ok) return { data: { session: null }, error: null }; }
    const t = localStorage.getItem('access_token')!;
    if (!_currentUser) _currentUser = _decodeUser(t);
    return { data: { session: { access_token: t, refresh_token: localStorage.getItem('refresh_token') ?? '', user: _currentUser } }, error: null };
  },

  async _refreshSilent(): Promise<boolean> {
    const r = localStorage.getItem('refresh_token');
    if (!r) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: r }) });
      if (!res.ok) return false;
      const data = await res.json();
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      _currentUser = data.user;
      return true;
    } catch { return false; }
  },

  onAuthStateChange(cb: (event: string, session: any) => void) {
    _authCallbacks.push(cb);
    const token = _getToken();
    if (token) auth.getSession().then(({ data }) => cb(data.session ? 'SIGNED_IN' : 'SIGNED_OUT', data.session));
    else setTimeout(() => cb('SIGNED_OUT', null), 0);
    return { data: { subscription: { unsubscribe: () => { _authCallbacks = _authCallbacks.filter(c => c !== cb); } } } };
  },

  async setSession(tokens: { access_token: string; refresh_token: string }) {
    localStorage.setItem('access_token', tokens.access_token);
    localStorage.setItem('refresh_token', tokens.refresh_token);
    _currentUser = _decodeUser(tokens.access_token);
    const session = { ...tokens, user: _currentUser };
    _notify('SIGNED_IN', session);
    return { data: { session }, error: null };
  },
};

// ── Query Builder ─────────────────────────────────────────────
type FilterOp = 'eq'|'in'|'gte'|'lte'|'gt'|'lt'|'ilike'|'not_is';
interface Filter { col: string; op: FilterOp; val: any }

class QueryBuilder {
  private _table: string;
  private _op: 'select'|'insert'|'update'|'delete' = 'select';
  private _selectCols = '*';
  private _selectOpts: Record<string, any> = {};
  private _filters: Filter[] = [];
  private _orderCol: string | null = null;
  private _orderAsc = true;
  private _limit: number | null = null;
  private _single = false;
  private _maybeSingle = false;
  private _insertData: any = null;
  private _updateData: any = null;

  constructor(table: string) { this._table = table; }

  select(cols = '*', opts: Record<string, any> = {}) { this._op = 'select'; this._selectCols = cols; this._selectOpts = opts; return this; }
  insert(data: any)  { this._op = 'insert'; this._insertData = data; return this; }
  update(data: any)  { this._op = 'update'; this._updateData = data; return this; }
  delete()           { this._op = 'delete'; return this; }
  upsert(data: any)  { this._op = 'insert'; this._insertData = data; return this; }

  eq(col: string, val: any)            { this._filters.push({ col, op: 'eq', val }); return this; }
  in(col: string, vals: any[])         { this._filters.push({ col, op: 'in', val: vals }); return this; }
  gte(col: string, val: any)           { this._filters.push({ col, op: 'gte', val }); return this; }
  lte(col: string, val: any)           { this._filters.push({ col, op: 'lte', val }); return this; }
  gt(col: string, val: any)            { this._filters.push({ col, op: 'gt', val }); return this; }
  lt(col: string, val: any)            { this._filters.push({ col, op: 'lt', val }); return this; }
  ilike(col: string, pattern: string)  { this._filters.push({ col, op: 'ilike', val: pattern }); return this; }
  not(col: string, _op: string, val: any) { this._filters.push({ col, op: 'not_is', val }); return this; }
  neq(_col: string, _val: any)         { return this; }

  order(col: string, opts: { ascending?: boolean } = {}) { this._orderCol = col; this._orderAsc = opts.ascending !== false; return this; }
  limit(n: number)   { this._limit = n; return this; }
  single()           { this._single = true; return this; }
  maybeSingle()      { this._maybeSingle = true; return this; }

  then(resolve: (v: any) => any, reject: (r: any) => any) { return this._exec().then(resolve, reject); }

  private _buildParams(): URLSearchParams {
    const p = new URLSearchParams();
    for (const f of this._filters) {
      if (f.col === 'user_id') continue;
      if      (f.op === 'eq')    p.set(f.col, String(f.val));
      else if (f.op === 'in')    p.set(`${f.col}_in`, f.val.join(','));
      else if (f.op === 'gte')   p.set(`${f.col}_gte`, String(f.val));
      else if (f.op === 'lte')   p.set(`${f.col}_lte`, String(f.val));
      else if (f.op === 'gt')    p.set(`${f.col}_gt`, String(f.val));
      else if (f.op === 'lt')    p.set(`${f.col}_lt`, String(f.val));
      else if (f.op === 'ilike') p.set(`${f.col}_ilike`, String(f.val));
    }
    if (this._orderCol) { p.set('order', this._orderCol); p.set('asc', String(this._orderAsc)); }
    if (this._limit)    p.set('limit', String(this._limit));
    return p;
  }

  private _idFilter(): Filter | undefined { return this._filters.find(f => f.col === 'id' && f.op === 'eq'); }

  private async _exec(): Promise<{ data: any; count?: number | null; error: any }> {
    const headers = _authHeaders();
    const baseUrl = `${API_BASE}/api/${this._table}`;

    if (this._op === 'select') {
      const params = this._buildParams();
      if (this._selectOpts.head) {
        params.set('head', '1');
        const res = await fetch(`${baseUrl}?${params}`, { headers });
        if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, count: null, error: e }; }
        const json = await res.json();
        return { data: null, count: json.count ?? 0, error: null };
      }
      const idF = this._idFilter();
      if ((this._single || this._maybeSingle) && idF) {
        const res = await fetch(`${baseUrl}/${idF.val}`, { headers });
        if (res.status === 404) return { data: null, error: null };
        if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: e }; }
        return { data: await res.json(), error: null };
      }
      const qs = params.toString();
      const res = await fetch(qs ? `${baseUrl}?${qs}` : baseUrl, { headers });
      if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, count: null, error: e }; }
      const rows = await res.json();
      const data = Array.isArray(rows) ? rows : rows.data ?? rows;
      if (this._single || this._maybeSingle) return { data: data[0] ?? null, error: null };
      return { data, count: Array.isArray(data) ? data.length : 0, error: null };
    }

    if (this._op === 'insert') {
      const res = await fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify(this._insertData) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: e }; }
      return { data: await res.json(), error: null };
    }

    if (this._op === 'update') {
      const idF = this._idFilter();
      if (idF) {
        const res = await fetch(`${baseUrl}/${idF.val}`, { method: 'PUT', headers, body: JSON.stringify(this._updateData) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: e }; }
        return { data: await res.json(), error: null };
      }
      const params = this._buildParams();
      const qs = params.toString();
      const res = await fetch(qs ? `${baseUrl}?${qs}` : baseUrl, { method: 'PUT', headers, body: JSON.stringify(this._updateData) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: e }; }
      return { data: await res.json(), error: null };
    }

    if (this._op === 'delete') {
      const idF = this._idFilter();
      const url = idF ? `${baseUrl}/${idF.val}` : (() => { const p = this._buildParams(); return p.toString() ? `${baseUrl}?${p}` : baseUrl; })();
      const res = await fetch(url, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 204) { const e = await res.json().catch(() => ({})); return { data: null, error: e }; }
      return { data: null, error: null };
    }

    return { data: null, error: { message: 'Operação desconhecida' } };
  }
}

// ── Functions ─────────────────────────────────────────────────
const functions = {
  invoke: async (name: string, opts: { body?: any } = {}) => {
    const res = await fetch(`${API_BASE}/api/functions/${name}`, {
      method: 'POST', headers: _authHeaders(), body: JSON.stringify(opts.body ?? {}),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return { data: null, error: e }; }
    return { data: await res.json(), error: null };
  },
};

// ── Upload helper (para catálogo de imagens) ──────────────────
export async function uploadImagem(url: string, file: File, fields?: Record<string, string>): Promise<{ url: string }> {
  const form = new FormData();
  form.append('imagem', file);
  if (fields) Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  const token = _getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { method: 'POST', headers, body: form });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Upload falhou'); }
  return res.json();
}

// ── Export ────────────────────────────────────────────────────
export const supabase = {
  auth,
  from: (table: string) => new QueryBuilder(table),
  functions,
  // Stubs para compatibilidade (sem Realtime real)
  channel: (_name: string) => ({ 
    on: (_type: string, _filter: any, _callback: (p: any) => void) => ({ 
      subscribe: () => ({ unsubscribe: () => {} }) 
    }),
    subscribe: () => ({ unsubscribe: () => {} })
  }),
  removeChannel: (_ch: any) => {},
  removeAllChannels: () => {},
};

export default supabase;
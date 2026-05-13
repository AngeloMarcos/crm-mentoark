# SPRINT 1 — Corrigir Aba WhatsApp (Conversas Reais + Status Evolution)

## Contexto do Projeto
CRM com backend Express.js/TypeScript em `backend/src/` e frontend React/Vite em `src/`.
- Backend roda em `api.mentoark.com.br` (VPS `147.93.9.172`)
- Todas as rotas `/api/*` exigem `Authorization: Bearer <token>` (JWT HS256)
- O token JWT fica em `localStorage.getItem('access_token')`
- Variável de ambiente frontend: `VITE_API_URL` (ex: `https://api.mentoark.com.br`)

---

## Problema Raiz (3 causas encadeadas)

### Causa 1 — `src/services/evolutionService.ts` chama Supabase Edge Function que não existe

```typescript
// ATUAL (QUEBRADO):
async function call(action: string) {
  const res = await callEdgeFunction<any>('evolution-proxy', { ... }); // ← Supabase. Não existe.
}
```

Este projeto **não usa Supabase**. Usa o backend Express próprio. Toda chamada de status/QR/desconectar falha silenciosamente.

### Causa 2 — `src/pages/WhatsApp.tsx` lê da tabela errada

```typescript
// ATUAL (QUEBRADO):
await api.from("chat_messages").select("*") // ← tabela vazia/legado
```

O agente IA (`backend/src/services/agentEngine.ts`) salva o histórico em `n8n_chat_histories`, com a estrutura:
```sql
-- n8n_chat_histories
session_id TEXT,         -- telefone do contato (ex: "5511999998888")
message    JSONB,        -- {"role":"user"|"assistant","content":"..."}
user_id    UUID,         -- UUID do usuário dono do agente
instancia  TEXT,         -- nome da instância Evolution
created_at TIMESTAMPTZ
```

A tabela `chat_messages` não é onde as mensagens reais ficam.

### Causa 3 — Backend não tem rota `/api/whatsapp/*`

Não existe nenhum endpoint que:
- Agrupe conversas de `n8n_chat_histories` por telefone
- Proxie chamadas de status/QR para a Evolution API
- Use as credenciais do agente do usuário autenticado

---

## O Que Fazer

### PASSO 1 — Criar `backend/src/routes/whatsapp.ts`

Crie este arquivo novo completo:

```typescript
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function whatsappRouter(pool: Pool): Router {
  const router = Router();

  // Helper: busca config Evolution do agente ativo do usuário
  async function getEvolutionConfig(userId: string) {
    const r = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes
       WHERE user_id = $1 AND ativo = true
         AND evolution_instancia IS NOT NULL AND evolution_instancia <> ''
         AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    if (!r.rows.length) {
      throw new Error('Nenhum agente ativo com Evolution configurada. Configure em Agentes → aba WhatsApp.');
    }
    return r.rows[0] as { url: string; api_key: string; instancia: string };
  }

  // ── GET /api/whatsapp/conversas ─────────────────────────────
  // Lista todas as conversas do usuário (agrupadas por telefone)
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const r = await pool.query(
        `SELECT
           h.session_id,
           h.instancia,
           MAX(h.created_at) AS ultima_atividade,
           COUNT(*) AS total,
           (SELECT (msg->>'content')
            FROM n8n_chat_histories h2
            WHERE h2.session_id = h.session_id AND h2.user_id = $1
            ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultima_mensagem,
           (SELECT (msg->>'role')
            FROM n8n_chat_histories h2
            WHERE h2.session_id = h.session_id AND h2.user_id = $1
            ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultimo_role
         FROM n8n_chat_histories h
         WHERE h.user_id = $1
         GROUP BY h.session_id, h.instancia
         ORDER BY ultima_atividade DESC
         LIMIT 300`,
        [userId]
      );

      // Enriquece com nomes dos contatos
      let nomes: Record<string, string> = {};
      if (r.rows.length) {
        const contatos = await pool.query(
          `SELECT telefone, nome FROM contatos WHERE user_id = $1`,
          [userId]
        );
        for (const c of contatos.rows) {
          const d = (c.telefone || '').replace(/\D/g, '');
          if (d) nomes[d] = c.nome;
        }
      }

      const conversas = r.rows.map(row => {
        const digits = (row.session_id || '').replace(/\D/g, '');
        const nome = nomes[digits] || nomes[digits.slice(-11)] || null;
        return {
          session_id: row.session_id,
          instancia: row.instancia,
          nome,
          ultima_atividade: row.ultima_atividade,
          ultima_mensagem: row.ultima_mensagem || '',
          ultimo_role: row.ultimo_role,
          total: Number(row.total),
        };
      });

      return res.json(conversas);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/whatsapp/conversas/:phone ──────────────────────
  // Histórico completo de um contato
  router.get('/conversas/:phone', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const phone = decodeURIComponent(req.params.phone);

      const r = await pool.query(
        `SELECT message, created_at
         FROM n8n_chat_histories
         WHERE session_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
        [phone, userId]
      );

      const mensagens = r.rows.map(row => {
        const msg = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
        return {
          role: msg.role as 'user' | 'assistant',
          content: msg.content as string,
          created_at: row.created_at,
        };
      }).filter(m => m.role && m.content);

      return res.json(mensagens);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/whatsapp/status ────────────────────────────────
  router.post('/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      const r = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      });

      if (!r.ok) return res.json({ state: 'close' });

      const data: any = await r.json();
      const state = data?.instance?.state || data?.state || 'close';
      const phoneNumber = data?.instance?.wuid?.split('@')[0] || data?.instance?.profileName || '';

      return res.json({ state, phoneNumber, instancia: cfg.instancia });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/whatsapp/connect ───────────────────────────────
  // Cria/reconecta instância e retorna QR code
  router.post('/connect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      // Verifica estado atual
      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (stateRes?.ok) {
        const d: any = await stateRes.json();
        const state = d?.instance?.state || d?.state || 'close';
        if (state === 'open') {
          const phoneNumber = d?.instance?.wuid?.split('@')[0] || d?.instance?.profileName || '';
          return res.json({ state: 'open', phoneNumber });
        }
      }

      // Tenta conectar (instância já existe mas desconectada)
      const connectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      if (connectRes?.ok) {
        const d: any = await connectRes.json();
        const qrRaw = d?.base64 || d?.qrcode?.base64 || null;
        if (qrRaw) {
          return res.json({
            state: 'connecting',
            qrCode: qrRaw.startsWith('data:') ? qrRaw : `data:image/png;base64,${qrRaw}`,
          });
        }
      }

      // Instância não existe — cria
      const createRes = await fetch(`${base}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify({
          instanceName: cfg.instancia,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Evolution create error: ${createRes.status} — ${err.slice(0, 200)}`);
      }

      const created: any = await createRes.json();
      const qrRaw = created?.qrcode?.base64 || created?.hash?.qrcode || null;

      return res.json({
        state: 'connecting',
        qrCode: qrRaw ? (qrRaw.startsWith('data:') ? qrRaw : `data:image/png;base64,${qrRaw}`) : null,
        instanceName: cfg.instancia,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/whatsapp/disconnect ────────────────────────────
  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      await fetch(`${base}/instance/logout/${cfg.instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      await fetch(`${base}/instance/delete/${cfg.instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return router;
}
```

### PASSO 2 — Registrar a rota em `backend/src/index.ts`

Adicione o import junto aos outros imports de rotas:
```typescript
import whatsappRouter from './routes/whatsapp';
```

Adicione o registro após `app.use('/api/modulos', modulosRouter(pool));`:
```typescript
app.use('/api/whatsapp', whatsappRouter(pool));
```

### PASSO 3 — Reescrever `src/services/evolutionService.ts`

Substitua o conteúdo inteiro do arquivo:

```typescript
// src/services/evolutionService.ts
// Chama o backend Express próprio — NÃO usa Supabase Edge Functions

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

function getToken(): string {
  return localStorage.getItem('access_token') || localStorage.getItem('crm_access_token') || '';
}

async function callBackend(path: string) {
  const res = await fetch(`${API_BASE}/api/whatsapp/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Erro ${res.status}`);
  return data;
}

export interface CreateInstanceResult {
  qrCode?: string;
  instanceName?: string;
  state?: string;
  phoneNumber?: string;
}

export interface StatusResult {
  state: 'open' | 'close' | 'connecting';
  phoneNumber?: string;
  instancia?: string;
}

export async function fetchConnectionStatus(): Promise<StatusResult> {
  const data = await callBackend('status');
  return data || { state: 'close' };
}

export async function createInstance(): Promise<CreateInstanceResult> {
  return await callBackend('connect');
}

export async function reconnectInstance(): Promise<CreateInstanceResult> {
  return await callBackend('connect');
}

export async function disconnectInstance(): Promise<void> {
  await callBackend('disconnect');
}
```

### PASSO 4 — Corrigir `src/pages/WhatsApp.tsx`

**4a.** Substituir a interface `ChatRow` e `Conversa` pelas corretas:

```typescript
// REMOVER interface ChatRow (não usada mais)

interface Conversa {
  session_id: string;
  instancia: string | null;
  nome: string | null;
  mensagens: { role: 'user' | 'assistant'; content: string; created_at: string }[];
  ultima_atividade: string;
  ultima_mensagem: string;
  total: number;
}
```

**4b.** Substituir o state `rows` por `conversas`:

```typescript
// REMOVER: const [rows, setRows] = useState<ChatRow[]>([]);
const [conversas, setConversas] = useState<Conversa[]>([]);
```

**4c.** Substituir a função `carregar` inteira:

```typescript
const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

const carregar = async () => {
  if (conversas.length === 0) setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/whatsapp/conversas`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` },
    });
    if (!res.ok) throw new Error('Erro ao carregar conversas');
    const data: Conversa[] = await res.json();
    setConversas(data.map(c => ({ ...c, mensagens: [] })));
  } catch (err: any) {
    toast.error(err.message);
  }
  setLoading(false);
};
```

**4d.** Substituir a função `abrirConversa` inteira:

```typescript
const abrirConversa = async (c: Conversa) => {
  setSelecionada({ ...c, mensagens: [] });
  setChatSearch('');
  setLead(null);
  setLeadStatus('novo');
  buscarLead(c.session_id);

  try {
    const res = await fetch(
      `${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(c.session_id)}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem('access_token') || ''}` } }
    );
    if (!res.ok) return;
    const msgs = await res.json();
    setSelecionada(prev => prev ? { ...prev, mensagens: msgs } : null);
  } catch (err: any) {
    toast.error(err.message);
  }
};
```

**4e.** Corrigir o `useMemo` de `filtradas` — remover a lógica de `rows` e usar `conversas`:

```typescript
const filtradas = useMemo(() => {
  const since = PERIODOS[periodo]();
  let list = since
    ? conversas.filter(c => c.ultima_atividade >= since)
    : conversas;

  const q = search.trim().toLowerCase();
  if (q) {
    list = list.filter(c =>
      c.session_id.toLowerCase().includes(q.replace(/\D/g, '')) ||
      c.ultima_mensagem.toLowerCase().includes(q) ||
      (c.nome && c.nome.toLowerCase().includes(q))
    );
  }
  return list; // já vem ordenado pelo backend
}, [conversas, search, periodo]);
```

**4f.** Corrigir o `useMemo` dos KPIs:

```typescript
const kpis = useMemo(() => {
  const hojeIso = PERIODOS.hoje();
  const hojeList = conversas.filter(c => c.ultima_atividade >= hojeIso);
  const totalMsgsHoje = hojeList.reduce((acc, c) => acc + c.total, 0);
  const allTotals = conversas.map(c => c.total);
  const maior = allTotals.length ? Math.max(...allTotals) : 0;
  const media = conversas.length ? Math.round(conversas.reduce((a, c) => a + c.total, 0) / conversas.length) : 0;
  return { conversasHoje: hojeList.length, mensagensHoje: totalMsgsHoje, media, maior };
}, [conversas]);
```

**4g.** No render dos cards de conversa, já usa `c.ultima_mensagem` e `c.nome` — não muda.

**4h.** No painel de chat (mensagens), trocar `m.type === "human"` por `m.role === "user"`:

```typescript
// ANTES:
const isHuman = m.type === "human";

// DEPOIS:
const isHuman = m.role === "user";
```

E a chave do map:
```typescript
// ANTES:
{mensagensFiltradas.map((m, idx) => (
  <div key={m.id ?? idx} ...>

// DEPOIS:
{mensagensFiltradas.map((m, idx) => (
  <div key={`${m.created_at}-${idx}`} ...>
```

**4i.** Corrigir `mensagensFiltradas` useMemo:

```typescript
const mensagensFiltradas = useMemo(() => {
  if (!selecionada) return [];
  const q = chatSearch.trim().toLowerCase();
  if (!q) return selecionada.mensagens;
  return selecionada.mensagens.filter(m => m.content.toLowerCase().includes(q));
}, [selecionada, chatSearch]);
```

---

## Checklist de Verificação

- [ ] `backend/src/routes/whatsapp.ts` criado com 5 endpoints
- [ ] `backend/src/index.ts` importa e registra `whatsappRouter`
- [ ] `src/services/evolutionService.ts` não usa mais `callEdgeFunction` nem Supabase
- [ ] `src/pages/WhatsApp.tsx` usa `conversas` (não `rows`) e chama `/api/whatsapp/conversas`
- [ ] Render das mensagens usa `m.role === 'user'` (não `m.type === 'human'`)
- [ ] `npm run build` no backend passa sem erros TypeScript
- [ ] No browser: aba WhatsApp carrega lista de conversas reais
- [ ] Status do WhatsApp (QR/conectado) funciona via backend

---

## Observação
Se o campo `message` no banco for string JSON (ex: `'{"role":"user","content":"oi"}'`),
o `JSON.parse` já está tratado no backend (`typeof row.message === 'string' ? JSON.parse(row.message) : row.message`).
Se for JSONB nativo do Postgres, o pg driver já retorna como objeto — ambos os casos estão cobertos.

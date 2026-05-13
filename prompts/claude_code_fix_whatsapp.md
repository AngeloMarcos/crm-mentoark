# Fix WhatsApp Page — 3 Problemas Críticos

## Contexto do projeto
CRM com backend Express.js/TypeScript em `backend/src/` e frontend React/Vite em `src/`.
O backend roda em `api.mentoark.com.br`. Todas as rotas `/api/*` exigem JWT (Bearer token).
A autenticação usa JWT HS256 com `payload.sub` = UUID do usuário.

---

## PROBLEMA 1 — `evolutionService.ts` chama Supabase que não existe

**Arquivo:** `src/services/evolutionService.ts`

Atualmente chama `callEdgeFunction('evolution-proxy', ...)` que tenta bater em uma Edge Function do Supabase. Este projeto NÃO usa Supabase — usa o backend Express próprio. Essa chamada sempre falha silenciosamente.

**Correção:** Reescreva `src/services/evolutionService.ts` para chamar o backend próprio:

```typescript
// src/services/evolutionService.ts
const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

function getToken(): string {
  return localStorage.getItem('access_token') || localStorage.getItem('crm_access_token') || '';
}

async function callBackend(path: string, body?: object) {
  const res = await fetch(`${API_BASE}/api/whatsapp/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || 'Erro ao comunicar com o servidor');
  }
  return res.json();
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

---

## PROBLEMA 2 — `WhatsApp.tsx` lê de `chat_messages`, mas o agente escreve em `n8n_chat_histories`

**Arquivo:** `src/pages/WhatsApp.tsx`

O frontend faz:
```typescript
await api.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(2000);
```

Mas o `agentEngine.ts` salva as conversas assim:
```typescript
INSERT INTO n8n_chat_histories (session_id, message, user_id, instancia)
VALUES ($1, $2::jsonb, $3, $4)
-- onde message = JSON.stringify({ role: 'user'|'assistant', content: string })
-- e session_id = telefone do contato
```

A tabela `chat_messages` provavelmente está vazia. O histórico real está em `n8n_chat_histories`.

**Correção em `WhatsApp.tsx`:** Trocar a busca de dados para chamar `/api/whatsapp/conversas`:

```typescript
const carregar = async () => {
  if (rows.length === 0) setLoading(true);
  try {
    const token = localStorage.getItem('access_token') || localStorage.getItem('crm_access_token') || '';
    const res = await fetch(
      `${(import.meta.env.VITE_API_URL as string) || 'http://localhost:3000'}/api/whatsapp/conversas`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('Erro ao carregar conversas');
    const data = await res.json();
    setConversas(data); // array de { session_id, nome, instancia, mensagens[], ultima_atividade, ultima_mensagem, total }
  } catch (err: any) {
    toast.error(err.message);
  }
  setLoading(false);
};
```

Também trocar `abrirConversa` para buscar o histórico em `/api/whatsapp/conversas/:phone`:
```typescript
const abrirConversa = async (c: Conversa) => {
  setSelecionada(c);
  setChatSearch('');
  setLead(null);
  buscarLead(c.session_id);

  const token = localStorage.getItem('access_token') || localStorage.getItem('crm_access_token') || '';
  const res = await fetch(
    `${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(c.session_id)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const msgs = await res.json();
  setSelecionada({ ...c, mensagens: msgs });
};
```

Adaptar a interface `Conversa` para trabalhar com os dados novos:
```typescript
interface Conversa {
  session_id: string;
  nome: string | null;
  instancia: string | null;
  mensagens: { role: 'user' | 'assistant'; content: string; created_at: string }[];
  ultima_atividade: string;
  ultima_mensagem: string;
  total: number;
}
```

---

## PROBLEMA 3 — Backend não tem rota `/api/whatsapp/*`

Crie o arquivo `backend/src/routes/whatsapp.ts`:

```typescript
import { Router, Response } from 'express';
import { Pool } from 'pg';
import { AuthRequest } from '../middleware';

export default function whatsappRouter(pool: Pool): Router {
  const router = Router();

  // ── HELPER: busca config da Evolution pelo agente ativo do usuário ──
  async function getEvolutionConfig(userId: string) {
    const r = await pool.query(
      `SELECT evolution_server_url AS url, evolution_api_key AS api_key, evolution_instancia AS instancia
       FROM agentes
       WHERE user_id = $1 AND ativo = true AND evolution_instancia IS NOT NULL
         AND evolution_server_url IS NOT NULL AND evolution_api_key IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    if (!r.rows.length) {
      throw new Error('Nenhum agente ativo com Evolution configurada. Configure em Agentes → WhatsApp.');
    }
    return r.rows[0] as { url: string; api_key: string; instancia: string };
  }

  // ── GET /api/whatsapp/conversas ─────────────────────────────────────
  // Lista todas as conversas do usuário agrupadas por telefone (session_id)
  router.get('/conversas', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const r = await pool.query(
        `SELECT
           h.session_id,
           h.instancia,
           MAX(h.created_at) AS ultima_atividade,
           COUNT(*) AS total,
           (
             SELECT (m->>'content')
             FROM n8n_chat_histories h2
             WHERE h2.session_id = h.session_id AND h2.user_id = $1
             ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultima_mensagem,
           (
             SELECT m->>'role'
             FROM n8n_chat_histories h2
             WHERE h2.session_id = h.session_id AND h2.user_id = $1
             ORDER BY h2.created_at DESC LIMIT 1
           ) AS ultimo_role
         FROM n8n_chat_histories h
         WHERE h.user_id = $1
         GROUP BY h.session_id, h.instancia
         ORDER BY ultima_atividade DESC
         LIMIT 200`,
        [userId]
      );

      // Busca nomes dos contatos
      const phones = r.rows.map(row => row.session_id);
      let nomes: Record<string, string> = {};
      if (phones.length) {
        const contatos = await pool.query(
          `SELECT telefone, nome FROM contatos WHERE user_id = $1`,
          [userId]
        );
        for (const c of contatos.rows) {
          const digits = (c.telefone || '').replace(/\D/g, '');
          nomes[digits] = c.nome;
        }
      }

      const conversas = r.rows.map(row => {
        const digits = (row.session_id || '').replace(/\D/g, '');
        return {
          session_id: row.session_id,
          instancia: row.instancia,
          nome: nomes[digits] || nomes[digits.slice(-11)] || null,
          ultima_atividade: row.ultima_atividade,
          ultima_mensagem: row.ultima_mensagem || '',
          ultimo_role: row.ultimo_role,
          total: Number(row.total),
          mensagens: [],
        };
      });

      return res.json(conversas);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/whatsapp/conversas/:phone ──────────────────────────────
  // Retorna histórico completo de mensagens de um contato
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

  // ── POST /api/whatsapp/status ────────────────────────────────────────
  // Verifica status da instância Evolution do usuário
  router.post('/status', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      const r = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      });

      if (!r.ok) {
        return res.json({ state: 'close' });
      }

      const data: any = await r.json();
      // Evolution retorna { instance: { state: 'open'|'close'|'connecting' } }
      const state = data?.instance?.state || data?.state || 'close';
      const phoneNumber = data?.instance?.profileName || data?.phoneNumber || '';

      return res.json({ state, phoneNumber });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/whatsapp/connect ───────────────────────────────────────
  // Cria/reconecta instância e retorna QR code se necessário
  router.post('/connect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      // Verifica se já existe e está conectada
      const stateRes = await fetch(`${base}/instance/connectionState/${cfg.instancia}`, {
        headers: { apikey: cfg.api_key },
      });

      if (stateRes.ok) {
        const stateData: any = await stateRes.json();
        const state = stateData?.instance?.state || stateData?.state || 'close';
        if (state === 'open') {
          return res.json({ state: 'open', phoneNumber: stateData?.instance?.profileName || '' });
        }
      }

      // Tenta conectar / gerar QR
      const connectRes = await fetch(`${base}/instance/connect/${cfg.instancia}`, {
        method: 'GET',
        headers: { apikey: cfg.api_key },
      });

      if (!connectRes.ok) {
        // Instância pode não existir ainda — cria
        const createRes = await fetch(`${base}/instance/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
          body: JSON.stringify({
            instanceName: cfg.instancia,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });
        const created: any = await createRes.json();
        const qrCode = created?.qrcode?.base64 || created?.hash?.qrcode || null;
        return res.json({
          state: 'connecting',
          qrCode: qrCode ? `data:image/png;base64,${qrCode.replace(/^data:image\/\w+;base64,/, '')}` : null,
          instanceName: cfg.instancia,
        });
      }

      const connectData: any = await connectRes.json();
      const qrRaw = connectData?.base64 || connectData?.qrcode?.base64 || null;
      return res.json({
        state: connectData?.state || 'connecting',
        qrCode: qrRaw ? `data:image/png;base64,${qrRaw.replace(/^data:image\/\w+;base64,/, '')}` : null,
        instanceName: cfg.instancia,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/whatsapp/disconnect ────────────────────────────────────
  // Desconecta e remove instância
  router.post('/disconnect', async (req: AuthRequest, res: Response) => {
    try {
      const cfg = await getEvolutionConfig(req.userId!);
      const base = cfg.url.replace(/\/$/, '');

      // Logout primeiro
      await fetch(`${base}/instance/logout/${cfg.instancia}`, {
        method: 'DELETE',
        headers: { apikey: cfg.api_key },
      }).catch(() => null);

      // Depois remove a instância
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

---

## PROBLEMA 4 — Registrar a nova rota em `backend/src/index.ts`

Adicione no arquivo `backend/src/index.ts` após os imports existentes:

```typescript
import whatsappRouter from './routes/whatsapp';
```

E após `app.use('/api/modulos', modulosRouter(pool));` adicione:

```typescript
app.use('/api/whatsapp', whatsappRouter(pool));
```

---

## Adaptação final do `WhatsApp.tsx`

No componente `WhatsApp.tsx`, os cards de conversa renderizam `m.type === 'human'` e `m.type === 'ai'`, mas o histórico novo vem com `m.role === 'user'` e `m.role === 'assistant'`.

Ajuste os componentes de renderização de bolha:
```typescript
// Antes:
const isHuman = m.type === "human";

// Depois:
const isHuman = m.role === "user";
```

E o texto do autor:
```typescript
// Antes:
{!isHuman && <div>... Agente</div>}
{isHuman && <div>... Lead</div>}

// Depois: igual, mas usando isHuman = m.role === 'user'
```

---

## Checklist pós-implementação

- [ ] `src/services/evolutionService.ts` reescrito para chamar `/api/whatsapp/*`
- [ ] `backend/src/routes/whatsapp.ts` criado com 5 endpoints
- [ ] `backend/src/index.ts` registra `whatsappRouter`
- [ ] `src/pages/WhatsApp.tsx` lê de `/api/whatsapp/conversas` em vez de `chat_messages`
- [ ] Build do backend passa sem erros TypeScript (`cd backend && npm run build`)
- [ ] Página WhatsApp mostra conversas reais do `n8n_chat_histories`
- [ ] Status/QR Code do WhatsApp funciona via backend (não Supabase)

---

## Observação importante sobre `chat_messages`

A tabela `chat_messages` em `SIMPLE_TABLES` no `index.ts` tem `user_id` filtering automático. Ela provavelmente NÃO é a tabela onde o agente salva mensagens. O agente real (`agentEngine.ts`) escreve SEMPRE em `n8n_chat_histories`. A tabela `chat_messages` pode ser um legado do n8n e pode ser removida do `SIMPLE_TABLES` para evitar confusão.

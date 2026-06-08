# PROMPT DE DIAGNÓSTICO — CHAT WHATSAPP CRM MENTOARK

Você é um engenheiro sênior fazendo diagnóstico completo de um sistema de chat WhatsApp.
O sistema é um CRM com React/Vite/TypeScript (frontend) + Express.js/TypeScript (backend) + PostgreSQL 16.
WhatsApp é via Evolution API v2 em `disparo.mentoark.com.br`.
VPS: `147.93.9.172`, acesso: `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172`

---

## ARQUIVOS RELEVANTES (leia todos antes de diagnosticar)

### FRONTEND

**`/opt/crm/src/pages/WhatsApp.tsx`**
→ Página principal com 3 tabs: Conversas, Instâncias, Diagnóstico.
→ Renderiza `<WhatsAppInterface />` e `<InstanceManagementPanel />`

**`/opt/crm/src/components/WhatsAppInterface.tsx`** (arquivo principal, ~2873 linhas)
→ Gerencia lista de chats + janela de mensagens
→ Chama os seguintes endpoints do backend:
  - `GET /api/whatsapp/conversas` — lista todas as conversas
  - `GET /api/whatsapp/conversas/:phone?limit=100` — mensagens de uma conversa
  - `POST /api/whatsapp/send` — envia mensagem/mídia
  - `GET /api/whatsapp/ia-status/:phone` — verifica se IA está pausada
  - `POST /api/whatsapp/ia-toggle` — pausa/reativa IA
  - `GET /api/whatsapp/profile-pic/:phone` — foto de perfil
  - `POST /api/whatsapp/sync-profiles` — sincroniza todas as fotos
  - `PATCH /api/whatsapp/contato/:phone` — edita nome do contato
  - `GET /api/whatsapp/search?q=` — busca global de mensagens (**⚠️ ROTA PODE NÃO EXISTIR NO BACKEND**)
  - `DELETE /api/whatsapp/messages/:id` — apaga mensagem (**⚠️ ROTA PODE NÃO EXISTIR NO BACKEND**)
  - `PATCH /api/whatsapp/conversas/:phone/read` — marca como lida (**⚠️ ROTA PODE NÃO EXISTIR NO BACKEND**)
  - `POST /api/whatsapp/chat-prefs/:phone` — fixar/arquivar/silenciar (**⚠️ ROTA PODE NÃO EXISTIR NO BACKEND**)
  - `GET /api/respostas_rapidas` — respostas rápidas

**`/opt/crm/src/components/whatsapp/InstanceManagementPanel.tsx`**
→ Painel de gerenciamento de instâncias Evolution
→ Usa `fetchConnectionStatus(instancia)` do `evolutionService.ts`

**`/opt/crm/src/services/evolutionService.ts`** (**⚠️ BUG CRÍTICO**)
→ `fetchConnectionStatus()` NÃO chama `/api/whatsapp/evo/status`
→ Chama `/api/integracoes_config` e verifica `status === 'conectado'` no banco
→ Isso significa que o status mostrado é do banco, NÃO do estado real da Evolution API
→ O backend tem `/api/whatsapp/evo/status?instancia=NOME` mas o frontend NÃO usa

---

### BACKEND

**`/opt/crm/backend/src/routes/whatsapp.ts`** (VERSÃO CORRETA/ATUALIZADA)
→ `webhookPayload()` usa: `{ enabled: true, webhookByEvents: false, webhookBase64: false }`
→ `registrarWebhook()` envia payload flat (sem wrapper `{ webhook: ... }`)
→ `GET /evo/status` aceita `?instancia=` query param
→ **ENDPOINTS PRESENTES**: connect, disconnect, send, conversas, ia-status, ia-toggle, contato, media, sync-history, sync-profiles, profile-pic, status, evo/status, evo/connect, evo/test, debug-agente, contatos-search, logs-ia, register-webhook
→ **ENDPOINTS AUSENTES** (usados pelo frontend mas não implementados aqui):
  - `GET /search` — busca global de mensagens
  - `DELETE /messages/:id` — apagar mensagem
  - `PATCH /conversas/:phone/read` — marcar como lida
  - `POST /chat-prefs/:phone` — pin/archive/mute

**`/opt/crm/backend/src/services/whatsapp.ts`** (**⚠️ VERSÃO ANTIGA/COM BUGS**)
→ `webhookPayload()` usa CAMPOS ERRADOS: `{ byEvents: false, base64: false }` (sem `enabled`, sem prefixo `webhook`)
→ `registrarWebhook()` ainda tenta `{ webhook: payload }` E flat (tentativa dupla)
→ `GET /evo/status` NÃO aceita `?instancia=` query param
→ **ATENÇÃO**: Verifique se o `backend/src/index.ts` importa de `routes/whatsapp.ts` ou `services/whatsapp.ts`!
→ Se a VPS ainda usa `services/whatsapp.ts`, o webhook está com campos errados → Evolution desativa o webhook

**`/opt/crm/backend/src/routes/webhook.ts`** (receptor de eventos Evolution)
→ Rota: `POST /webhook/evolution`
→ Lookup de userId em 5 fontes: agent_configs → agentes → prefixo UUID → integracoes_config → admin
→ N8N routing: se `agentes.n8n_webhook_url` existe, encaminha para N8N e não processa IA
→ Anti-loop: verifica `botMessageIds`, `botSentTexts`, banco de dados
→ Salva mensagens em `whatsapp_messages`
→ Processa IA via `processarComDebounce()` com 3s de debounce

**`/opt/crm/backend/src/services/agentEngine.ts`** (motor de IA)
→ Debounce de 3s para mensagens picotadas
→ Lock de concorrência por instância:telefone
→ Busca agente em `agentes` table, fallback por userId
→ Provider OpenAI/Claude/Gemini via `ai_providers` table
→ Suporte a N8N routing, OpenClaw motor
→ Salva histórico em `n8n_chat_histories` e resposta em `whatsapp_messages`

---

## PROBLEMAS IDENTIFICADOS (para confirmar/corrigir)

### P1 — CRÍTICO: Dois arquivos `whatsapp.ts` com implementações diferentes
```
/opt/crm/backend/src/routes/whatsapp.ts  → CORRIGIDO (enabled, webhookByEvents, webhookBase64)
/opt/crm/backend/src/services/whatsapp.ts → ANTIGO/BUGADO (byEvents, base64)
```
**Verificar:** Em `/opt/crm/backend/src/index.ts`, qual dos dois é importado?
Se `index.ts` importa o de `services/`, o webhook está quebrado (Evolution desativa a cada 30s).

### P2 — CRÍTICO: 4 rotas usadas pelo frontend NÃO existem no backend
O `WhatsAppInterface.tsx` chama estas rotas que retornam 404:
- `GET /api/whatsapp/search?q=TERMO` → busca global de mensagens
- `DELETE /api/whatsapp/messages/:id` → apagar mensagem (para si / para todos)
- `PATCH /api/whatsapp/conversas/:phone/read` → marcar conversa como lida
- `POST /api/whatsapp/chat-prefs/:phone` → fixar, arquivar, silenciar conversa

**Verificar:** Confirme os 404s nos logs: `docker logs crm-api --tail=200 | grep "404\|search\|messages\|read\|chat-prefs"`

### P3 — BUG: `evolutionService.ts` não verifica status real da Evolution
`fetchConnectionStatus()` consulta o banco (`integracoes_config.status`), não a Evolution API.
Resultado: painel mostra "Conectado" mesmo quando Evolution está desconectada.
**Fix:** Deve chamar `GET /api/whatsapp/evo/status?instancia=NOME` no backend.

### P4 — VERIFICAR: Instâncias no banco x Evolution
Rodar na VPS:
```bash
# Listar instâncias na Evolution
curl -s -H "apikey: $(grep EVOLUTION_API_KEY /opt/crm/backend/.env | cut -d= -f2)" \
  https://disparo.mentoark.com.br/instance/fetchInstances | python3 -m json.tool

# Listar instâncias no banco
docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT user_id, nome, evolution_instancia, ativo FROM agentes WHERE evolution_instancia IS NOT NULL;"
```

### P5 — VERIFICAR: Webhook ativo na Evolution
```bash
API_KEY=$(grep EVOLUTION_API_KEY /opt/crm/backend/.env | cut -d= -f2)
# Para cada instância (crm_435ee4720fc3, crm_5319f0ed61b3):
curl -s -H "apikey: $API_KEY" \
  https://disparo.mentoark.com.br/webhook/find/crm_435ee4720fc3 | python3 -m json.tool
```
O campo `enabled` deve ser `true` e `url` deve ser `https://api.mentoark.com.br/webhook/evolution`.

### P6 — VERIFICAR: Mensagens chegando no banco
```bash
docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT created_at, instance_name, from_me, left(content,50), remote_jid 
   FROM whatsapp_messages ORDER BY created_at DESC LIMIT 20;"
```

### P7 — VERIFICAR: Logs em tempo real ao enviar mensagem de teste
```bash
# Terminal 1: logs do backend
docker logs -f crm-api 2>&1 | grep -E "WEBHOOK|ENGINE|SEND|WH:"

# Terminal 2: enviar mensagem de teste pelo WhatsApp para o número conectado
```

---

## TAREFAS DE DIAGNÓSTICO (execute em ordem)

1. **Identificar qual whatsapp.ts está em uso:**
   ```bash
   grep -n "whatsapp" /opt/crm/backend/src/index.ts
   ```

2. **Se usa services/whatsapp.ts, fazer o fix:**
   Copiar `/opt/crm/backend/src/routes/whatsapp.ts` para substituir `/opt/crm/backend/src/services/whatsapp.ts`
   OU corrigir o import em `index.ts`.

3. **Implementar as 4 rotas ausentes** em `/opt/crm/backend/src/routes/whatsapp.ts`:

   ```typescript
   // GET /api/whatsapp/search
   router.get('/search', async (req: AuthRequest, res: Response) => {
     const userId = req.userId!;
     const q = ((req.query.q as string) || '').trim();
     if (!q || q.length < 2) return res.json([]);
     const r = await pool.query(
       `SELECT m.id, m.content, m.timestamp_wa, m.from_me,
               split_part(m.remote_jid,'@',1) AS phone,
               COALESCE(c.nome, c.push_name, split_part(m.remote_jid,'@',1)) AS contact_name,
               COALESCE(c.foto_perfil, c.profile_pic_url) AS profile_pic
        FROM whatsapp_messages m
        LEFT JOIN contatos c ON c.user_id = m.user_id
          AND c.telefone ILIKE '%' || RIGHT(split_part(m.remote_jid,'@',1), 11)
        WHERE m.user_id = $1 AND m.content ILIKE $2
          AND m.remote_jid NOT LIKE '%@g.us'
        ORDER BY m.created_at DESC LIMIT 50`,
       [userId, `%${q}%`]
     );
     return res.json(r.rows);
   });

   // DELETE /api/whatsapp/messages/:id
   router.delete('/messages/:id', async (req: AuthRequest, res: Response) => {
     const userId = req.userId!;
     const id = req.params.id;
     const { forEveryone, instancia, remoteJid } = req.body as { forEveryone?: boolean; instancia?: string; remoteJid?: string };
     // Soft delete local
     await pool.query(
       `DELETE FROM whatsapp_messages WHERE (id::text = $1 OR message_id = $1) AND user_id = $2`,
       [id, userId]
     ).catch(() => {});
     // Se forEveryone, tenta apagar na Evolution API também
     if (forEveryone && instancia && remoteJid) {
       const cfg = await getEvolutionConfig(userId);
       const base = cfg.url.replace(/\/$/, '');
       await fetch(`${base}/chat/deleteMessage/${instancia}`, {
         method: 'DELETE',
         headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
         body: JSON.stringify({ remoteJid, messageId: id }),
       }).catch(() => {});
     }
     return res.json({ ok: true });
   });

   // PATCH /api/whatsapp/conversas/:phone/read
   router.patch('/conversas/:phone/read', async (req: AuthRequest, res: Response) => {
     const userId = req.userId!;
     const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
     await pool.query(
       `UPDATE whatsapp_messages SET is_read = true
        WHERE user_id = $1 AND split_part(remote_jid,'@',1) = $2 AND from_me = false`,
       [userId, phone]
     ).catch(() => {});
     return res.json({ ok: true });
   });

   // POST /api/whatsapp/chat-prefs/:phone
   router.post('/chat-prefs/:phone', async (req: AuthRequest, res: Response) => {
     const userId = req.userId!;
     const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
     const { pinned, archived, muted_until } = req.body as { pinned?: boolean; archived?: boolean; muted_until?: string | null };
     const setParts: string[] = [];
     const vals: any[] = [userId, `%${phone.slice(-11)}`];
     if (pinned !== undefined) { setParts.push(`is_pinned = $${vals.length+1}`); vals.push(pinned); }
     if (archived !== undefined) { setParts.push(`is_archived = $${vals.length+1}`); vals.push(archived); }
     if (muted_until !== undefined) { setParts.push(`muted_until = $${vals.length+1}`); vals.push(muted_until); }
     if (!setParts.length) return res.json({ ok: true });
     await pool.query(
       `UPDATE contatos SET ${setParts.join(', ')}, updated_at = NOW()
        WHERE user_id = $1 AND telefone ILIKE $2`,
       vals
     ).catch(() => {});
     return res.json({ ok: true });
   });
   ```
   **Nota:** A tabela `contatos` precisa das colunas `is_pinned`, `is_archived`, `muted_until` (boolean/timestamptz).
   Adicionar se não existirem:
   ```sql
   ALTER TABLE contatos ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
   ALTER TABLE contatos ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
   ALTER TABLE contatos ADD COLUMN IF NOT EXISTS muted_until timestamptz;
   ```

4. **Corrigir `evolutionService.ts`** para usar a rota real do backend:
   ```typescript
   // src/services/evolutionService.ts — função fetchConnectionStatus
   export async function fetchConnectionStatus(instancia?: string): Promise<StatusResult> {
     const API_URL = instancia
       ? `${API_BASE}/api/whatsapp/evo/status?instancia=${encodeURIComponent(instancia)}`
       : `${API_BASE}/api/whatsapp/evo/status`;
     const res = await fetch(API_URL, { headers: authHeaders() });
     if (!res.ok) return { state: 'close' };
     const data = await res.json();
     return { state: data.state ?? 'close', phoneNumber: data.phoneNumber };
   }
   ```

5. **Após todas as correções, rebuild e redeploy:**
   ```bash
   # Frontend
   cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm
   # Backend
   cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d
   ```

6. **Verificar se mensagens chegam e são exibidas:**
   - Enviar mensagem de WhatsApp para o número conectado
   - Verificar logs: `docker logs -f crm-api | grep -E "WH:|ENGINE|INSERT"`
   - Confirmar no banco: `SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT 5;`
   - Confirmar no frontend: abrir `/whatsapp` e verificar se a conversa aparece

---

## CONTEXTO DO AMBIENTE

- **VPS**: `147.93.9.172`
- **Evolution API**: `https://disparo.mentoark.com.br` (container `evolution` em `/opt/evolution/`)
- **Backend CRM**: `https://api.mentoark.com.br` (container `crm-api` em `/opt/crm/backend/`)
- **Frontend CRM**: `https://crm.mentoark.com.br` (container `crm` em `/opt/crm/`)
- **PostgreSQL**: `147.93.9.172:5432` db=`crm` user=`mentoark`
- **Webhook URL**: `https://api.mentoark.com.br/webhook/evolution`
- **Usuário MentoArk**: `user_id=435ee472...`, instância=`crm_435ee4720fc3`
- **Usuária Cris**: `user_id=d7b74de0...`, instância=`crm_5319f0ed61b3`, N8N routing ativo

## TABELAS PRINCIPAIS

- `whatsapp_messages` — todas as mensagens (from_me, remote_jid, content, status, timestamp_wa)
- `contatos` — contatos com telefone, nome, push_name, foto_perfil, atendente_pausou_ia
- `agentes` — configuração de instâncias Evolution (evolution_instancia, evolution_server_url, n8n_webhook_url)
- `integracoes_config` — config de integração por usuário (tipo='evolution', instancia, url, api_key, status)
- `n8n_chat_histories` — histórico de conversas da IA (session_id=telefone, message JSON)
- `agent_configs` — config do agente IA (prompt_sistema, modelo_llm, evolution_instancia)
- `agent_prompts` — prompts legados

---

**Prioridade de diagnóstico:** P1 → P2 → P3 → P4 → P5 → P6 → P7

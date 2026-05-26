# Diagnóstico Evolution + Sync de Conversas

> Análise read-only de `backend/src/routes/whatsapp.ts`, `backend/src/routes/webhook.ts`, `backend/src/services/agentEngine.ts`, `backend/src/migrations.ts` e `backend/src/index.ts`. Nenhum código foi alterado.

---

## ✅ O que está funcionando

- **Endpoint público correto** — `app.use('/webhook', webhookRouter(pool))` está registrado **antes** de `app.use('/api', authMiddleware)` (`index.ts:98`), então Evolution consegue postar sem JWT.
- **Deduplicação em 2 camadas:**
  - `Set<string>` em memória com TTL de 60 s (`webhook.ts:processados`).
  - Tabela `webhook_mensagens_processadas` com índice `idx_webhook_dedup_criado` em `criado_em`.
  - Limpeza de registros > 24 h executada no **startup** (`migrations.ts:204-207`) **e** diariamente às 03:00 BRT via `cron.ts`.
- **Filtros do payload corretos:**
  - Só processa `event === 'messages.upsert'`.
  - Ignora `fromMe === true`, `status === 'READ'` e JIDs de grupo (`@g.us`).
- **Extração de conteúdo robusta** — `extrairTexto` e `extrairTipo` cobrem: conversation, extendedTextMessage, image/audio/video/document/sticker, buttonsResponse, listResponse e templateButtonReply.
- **Roteamento condicional** — Quando `agentes.n8n_webhook_url` está preenchido, encaminha para n8n; senão chama `agentEngine.processarMensagem` (`webhook.ts:233-253`).
- **Opt-out automático** — Palavras-chave (`sair/stop/parar/cancelar/remover/não quero`) marcam `contatos.opt_out = true`, registram em `disparo_optouts` e enviam confirmação via Evolution.
- **Tabela `whatsapp_messages` indexada** — `idx_wamsg_user_session (user_id, session_id, created_at DESC)`, `idx_wamsg_user_instancia (user_id, instancia, created_at DESC)` e o duplicado `idx_wamsg_session_user_desc`.
- **`getEvolutionConfig` com fallback global** — Se o agente não tem `evolution_server_url`/`evolution_api_key`, usa `DEFAULT_EVO_URL` / `DEFAULT_EVO_KEY` do ambiente (`whatsapp.ts:33-41`).
- **Resposta do `agentEngine` é persistida** — Salva em `whatsapp_messages` com `from_me=true` e id `resp_${messageId}` (`agentEngine.ts:215-230`).
- **HMAC suportado** — Se `EVOLUTION_WEBHOOK_SECRET` estiver setado, valida `x-evolution-hmac` em tempo constante.

---

## ⚠️ Gaps e inconsistências encontradas

### G1 — Duas fontes de configuração Evolution
- `whatsapp.ts::getEvolutionConfig` lê de **`agentes.evolution_*`**.
- `webhook.ts` (handler de opt-out, linhas ~205-220) lê de **`integracoes_config WHERE tipo='evolution'`**.
- As duas tabelas nunca são sincronizadas. Se o usuário configurou apenas pela tela "WhatsApp" (que grava em `agentes`), a mensagem de confirmação de opt-out **nunca é enviada** porque `integracoes_config` está vazio (o `if (evoConf.rows.length)` falha em silêncio).

### G2 — Nome de instância padrão fraco
- `crm_${userId.slice(0, 8)}` usa só 8 chars hex (~32 bits de entropia).
- Probabilidade de colisão entre dois usuários ultrapassa 25 % com ~50 000 contas (paradoxo do aniversário).
- Risco real de duas contas disputarem a mesma instância na Evolution.

### G3 — Falta UNIQUE/índice em `agentes.evolution_instancia`
- Query crítica do webhook: `SELECT user_id, n8n_webhook_url FROM agentes WHERE evolution_instancia = $1` (`webhook.ts:148-153`).
- Sem índice → seq scan a cada mensagem recebida.
- Sem `UNIQUE` parcial → dois agentes podem terminar com a mesma instância; o `ORDER BY updated_at DESC LIMIT 1` mascara o problema mas escolhe o usuário "errado" silenciosamente.

### G4 — Webhook não cria contato quando ele não existe
- Em `webhook.ts:163-172` o código é `UPDATE contatos SET push_name=..., ultima_mensagem_em=NOW() WHERE user_id=$1 AND telefone ILIKE $2`.
- Se o contato ainda não está em `contatos`, o `UPDATE` afeta 0 linhas e nada é registrado.
- O `agentEngine.upsertContato` existe (`agentEngine.ts:117-134`) e **cria** o contato, mas só roda no caminho **agentEngine**. No caminho **n8n** o contato fantasma permanece.

### G5 — Tabelas duplicadas de contato
- `contatos`: nome, telefone, push_name, opt_out, ultima_mensagem_em (CRM principal).
- `dados_cliente`: telefone, nomewpp, atendimento_ia (controle de pausa da IA).
- Não há sincronização entre elas. A tela Contatos lê `atendimento_ia` de `dados_cliente`; a tela WhatsApp lê nome de `contatos`. Um cliente pode existir em uma e não na outra.

### G6 — `EVOLUTION_WEBHOOK_SECRET` não está exposto no painel de status
- `index.ts:219-231` lista as secrets monitoradas pela tela "Segurança" e `EVOLUTION_WEBHOOK_SECRET` **não consta**. Sugere fortemente que HMAC está desativado em produção.

### G7 — Fallback de instância no `agentEngine`
- `enviarResposta(..., agente.evolution_instancia || entrada.instancia, ...)` (`agentEngine.ts:233-239`).
- Se `agentes.evolution_instancia` for `NULL`, cai no nome vindo do payload Evolution, que pode divergir do que está salvo no banco do usuário. Risco de enviar resposta pela instância errada em ambientes com migração de nomes.

### G8 — `session_id` indocumentado
- É o telefone limpo (sem `@s.whatsapp.net`). Consistente entre `webhook.ts` (`telefone`) e `agentEngine.ts` (`entrada.telefone`), mas não há comentário ou contrato escrito.

---

## ❌ Bugs confirmados

### B1 — Contatos fantasmas no fluxo n8n
Consequência direta de G4 + G5: quando uma mensagem nova chega de um número desconhecido e o agente está em modo n8n, a mensagem é salva em `whatsapp_messages` e encaminhada ao n8n, **mas nada é inserido em `contatos`**. Efeitos:

- O contato aparece na lista de Conversas (pelo `push_name`) mas **não aparece na lista de Contatos**.
- Não pode ser movido no funil, não recebe tags, não tem timeline, não tem tarefas/follow-ups (todas essas tabelas exigem `contato_id`).
- Tela `ContatoDetalhe` quebra porque não há `id`.
- Opt-out futuro via webhook falha silenciosamente (o `UPDATE contatos SET opt_out=true` afeta 0 linhas).

### B2 — Respostas do n8n nunca aparecem na UI
- `webhook.ts:130` filtra `payload.data?.key?.fromMe === true` antes de qualquer processamento.
- Quando o n8n envia uma resposta ao cliente via Evolution, a própria Evolution dispara webhook com `fromMe=true` — que é descartado.
- Resultado: conversas processadas pelo n8n ficam **unilaterais** na tela "WhatsApp" — só aparecem mensagens do cliente, nunca as do bot.
- O caminho `agentEngine` não tem esse problema porque grava a resposta diretamente em `whatsapp_messages` antes de enviar.

### B3 — Confirmação de opt-out não chega para a maioria dos usuários
Consequência de G1: o lookup em `integracoes_config` falha para qualquer usuário que configurou Evolution apenas pela tela "WhatsApp". O contato é marcado como opt-out e a mensagem é registrada, mas o cliente nunca recebe a confirmação que o código pretende enviar.

### B4 — `ON CONFLICT DO NOTHING` sem constraint em `agentes`
- `saveEvolutionConfig` faz `INSERT INTO agentes (...) ON CONFLICT DO NOTHING` (`whatsapp.ts:56-61`).
- Não existe `UNIQUE` em `agentes(user_id)` nem em `(user_id, nome)`. Postgres aceita o `ON CONFLICT` sem erro porque é sintaxe válida sem alvo, mas **nunca dispara** — sempre insere.
- Chamadas repetidas a `/api/whatsapp/connect` (ex.: usuário clica "Conectar" várias vezes após `disconnect`) podem **criar agentes duplicados**, e a query `ORDER BY updated_at DESC LIMIT 1` em `getEvolutionConfig` mascara o problema escolhendo um deles aleatoriamente.

### B5 — Resposta do `agentEngine` salva com `instancia` potencialmente errada
Em `agentEngine.ts:218`, a resposta é gravada com `instancia = entrada.instancia` (vindo do webhook). Já o envio em `enviarResposta` usa `agente.evolution_instancia || entrada.instancia`. Se forem diferentes (G7), a mensagem registrada na UI fica com nome de instância divergente da que efetivamente entregou.

---

## 🔧 Correções recomendadas (em ordem de prioridade)

### P0 — Bugs que quebram fluxo de usuário

#### 1. Criar contato no webhook (corrige B1)
Em `backend/src/routes/webhook.ts`, substituir o bloco `UPDATE contatos` (≈ linhas 163-172) por um upsert executado **sempre** (antes do branch n8n/agentEngine):

```ts
// Substitui o UPDATE atual
if (userId) {
  await pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, origem, status, push_name, ultima_mensagem_em)
     VALUES ($1, $2, $3, 'WhatsApp', 'novo', $2, NOW())
     ON CONFLICT (user_id, telefone) DO UPDATE
       SET push_name = COALESCE(EXCLUDED.push_name, contatos.push_name),
           ultima_mensagem_em = NOW(),
           updated_at = NOW()`,
    [userId, pushName || telefone, telefone]
  );
}
```

Pré-requisito: criar UNIQUE (ver P1.5).

#### 2. Capturar respostas do n8n em `whatsapp_messages` (corrige B2)
Opção recomendada (menor invasão): aceitar `fromMe=true` quando vier de uma instância roteada via n8n.

```ts
// Em vez de: if (payload.data?.key?.fromMe === true) return;
const isFromMe = payload.data?.key?.fromMe === true;
// ...buscar agente como hoje...
if (isFromMe && !n8nWebhookUrl) return;     // mantém comportamento antigo p/ agentEngine
if (isFromMe) {
  // Salvar como mensagem do bot e encerrar
  await pool.query(
    `INSERT INTO whatsapp_messages
       (id, user_id, instancia, session_id, remote_jid, from_me, push_name,
        tipo, conteudo, midia_url, midia_mime, midia_nome, status, timestamp_unix)
     VALUES ($1,$2,$3,$4,$5,true,'Bot n8n',$6,$7,$8,$9,$10,'sent',$11)
     ON CONFLICT (id) DO NOTHING`,
    [messageId, userId, instancia, telefone, remoteJid,
     tipo, texto || null, midia.url || null, midia.mime || null, midia.nome || null,
     timestamp]
  );
  return;
}
```

Alternativa (mais limpa, mais trabalho): expor `POST /webhook/n8n-resposta` autenticado por `x-n8n-secret`, e fazer o workflow do n8n postar a resposta de volta após enviar via Evolution.

#### 3. Unificar fonte de config Evolution (corrige B3 + G1)
Em `backend/src/routes/webhook.ts`, no handler de opt-out, trocar o `SELECT ... FROM integracoes_config` por um lookup em `agentes`, reaproveitando a lógica de `getEvolutionConfig`:

```ts
const evoConf = await pool.query(
  `SELECT
     COALESCE(evolution_server_url, $2) AS url,
     COALESCE(evolution_api_key,    $3) AS api_key,
     COALESCE(evolution_instancia,  $4) AS instancia
   FROM agentes
   WHERE user_id = $1 AND ativo = true
   ORDER BY updated_at DESC LIMIT 1`,
  [userId,
   process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br',
   process.env.EVOLUTION_API_KEY || 'mentoark2025evolutionkey',
   instancia]
);
```

A médio prazo: extrair `getEvolutionConfig` para um service compartilhado (`services/evolutionConfig.ts`) e usar nos dois arquivos.

---

### P1 — Integridade de dados

#### 4. UNIQUE parcial em `agentes.evolution_instancia` (corrige G3)
Em `backend/src/migrations.ts`, adicionar:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_agentes_evolution_instancia
ON agentes (evolution_instancia)
WHERE evolution_instancia IS NOT NULL;
```

> ⚠️ Antes de rodar em produção, executar `SELECT evolution_instancia, COUNT(*) FROM agentes WHERE evolution_instancia IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;` e limpar duplicatas.

#### 5. UNIQUE em `agentes(user_id)` ou UPSERT real (corrige B4)
Mais seguro: trocar o `INSERT ... ON CONFLICT DO NOTHING` por **UPDATE-then-INSERT** dentro de uma transação:

```ts
const upd = await pool.query(
  `UPDATE agentes
   SET evolution_server_url=$1, evolution_api_key=$2, evolution_instancia=$3, updated_at=NOW()
   WHERE user_id=$4 AND ativo=true`,
  [url, api_key, instancia, userId]
);
if (upd.rowCount === 0) {
  await pool.query(
    `INSERT INTO agentes (user_id, nome, ativo, evolution_server_url, evolution_api_key, evolution_instancia)
     VALUES ($1, 'Agente IA', true, $2, $3, $4)`,
    [userId, url, api_key, instancia]
  );
}
```

#### 6. Instância padrão segura (corrige G2)
Trocar `crm_${userId.slice(0, 8)}` por:

```ts
const instancia = `crm_${userId.replace(/-/g, '')}`;
```

(UUID completo, 128 bits — colisão impossível.)

#### 7. Criar UNIQUE em `contatos(user_id, telefone)` (pré-requisito de P0.1)
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contatos_user_telefone
ON contatos (user_id, telefone)
WHERE telefone IS NOT NULL;
```

> Limpar duplicatas antes: manter o registro mais antigo por (user_id, telefone).

---

### P2 — Segurança

#### 8. Ativar HMAC do webhook
- Definir `EVOLUTION_WEBHOOK_SECRET` no `.env` do container `crm-api`.
- Adicionar a chave em `index.ts:219-231` para aparecer no painel de Segurança.
- Configurar a Evolution para enviar `x-evolution-hmac` correspondente.

---

### P3 — Higiene

#### 9. Documentar `session_id`
Comentário no topo de `webhook.ts` e `whatsapp.ts`: *"`session_id` = telefone E.164 sem o sufixo `@s.whatsapp.net` nem `@c.us`. Sempre dígitos puros."*

#### 10. Deprecar `dados_cliente` ou criar view de sincronização
- Mover `atendimento_ia` para `contatos` como coluna `pausa_ia_ate TIMESTAMPTZ NULL`.
- Manter `dados_cliente` apenas como view para compatibilidade.
- Esta mudança é grande — agendar para sprint dedicada.

#### 11. Resposta do `agentEngine` usar mesma instância (corrige B5)
Em `agentEngine.ts:218`, gravar `instancia = agente.evolution_instancia || entrada.instancia` (a mesma usada no envio).

---

## Resumo executivo

| Prioridade | Itens | Impacto |
|---|---|---|
| **P0** | 3 correções | Contatos novos via n8n viram fantasmas; respostas do bot n8n não aparecem na UI; opt-out não confirma. |
| **P1** | 4 correções | Risco de colisão de instância, agentes duplicados, queries sem índice. |
| **P2** | 1 correção | Webhook aberto sem validação de origem. |
| **P3** | 3 itens | Documentação e dívida técnica (tabelas duplicadas). |

Atacar **P0.1 + P0.2 + P0.3 + P1.7** primeiro resolve ~90 % dos sintomas reportados pelos usuários ("conversa some", "contato não aparece em lugar nenhum", "opt-out não responde").

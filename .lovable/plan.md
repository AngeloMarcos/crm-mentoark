## Objetivo

Criar **apenas um arquivo** Markdown em `backend/DIAGNOSTICO-EVOLUTION.md` com diagnóstico read-only da integração Evolution API e sincronização de conversas. Nenhum código será alterado.

## Achados que entrarão no relatório

Baseado na leitura de `whatsapp.ts`, `webhook.ts`, `agentEngine.ts`, `migrations.ts` e `index.ts`:

### ✅ Funcionando
- Webhook montado em `/webhook/evolution` (público, antes do `authMiddleware`) — Evolution consegue postar.
- Deduplicação em 2 camadas: `Set` em memória (60s) + tabela `webhook_mensagens_processadas` com índice em `criado_em` e limpeza diária via `cron.ts` (03:00 BRT) + limpeza no startup em `migrations.ts`.
- Filtros corretos: ignora `fromMe`, ignora `@g.us`, ignora `status=READ`, só processa `messages.upsert`.
- Extração de texto/mídia cobre conversation, extendedText, image, audio, video, document, sticker, buttons, list, template.
- Roteamento condicional `n8n_webhook_url` vs `agentEngine` implementado.
- Opt-out automático com keywords (`sair/stop/parar/...`) marca `contatos.opt_out`, loga em `disparo_optouts` e envia confirmação via Evolution.
- Migration cria `whatsapp_messages` com índices `(user_id, session_id, created_at DESC)` e `(user_id, instancia, ...)`.
- `getEvolutionConfig` faz fallback para `DEFAULT_EVO_URL`/`DEFAULT_EVO_KEY` quando agente não tem config própria.
- `agentEngine.salvarMensagem` grava resposta do bot em `whatsapp_messages` com `from_me=true` e id `resp_${messageId}`.

### ⚠️ Gaps e inconsistências
1. **Duas fontes de config Evolution** — `whatsapp.ts` lê de `agentes.evolution_*`, mas o handler de opt-out em `webhook.ts` lê de `integracoes_config WHERE tipo='evolution'`. Se um usuário só configurou pela tela de WhatsApp (que grava em `agentes`), a confirmação de opt-out **não é enviada** porque `integracoes_config` está vazio. As duas fontes nunca são sincronizadas.
2. **Instância padrão `crm_${userId.slice(0,8)}`** — 8 chars de UUID v4 = ~32 bits. Em uma base de ~50k usuários, probabilidade de colisão > 25% (paradoxo do aniversário). Risco real de dois usuários disputarem a mesma instância na Evolution.
3. **Falta índice/UNIQUE em `agentes.evolution_instancia`** — A query `WHERE evolution_instancia = $1` em `webhook.ts` faz seq scan; e nada impede dois `agentes` com a mesma instância (a query usa `ORDER BY updated_at DESC LIMIT 1`, mascarando o problema).
4. **Webhook não cria contato** — O `UPDATE contatos SET push_name=...` em `webhook.ts` silenciosamente não afeta nada se o contato ainda não existe na tabela. `push_name` fica apenas em `whatsapp_messages`. Não há `INSERT ... ON CONFLICT` nem chamada a `upsertContato`.
   - `agentEngine.upsertContato` existe e cria o contato, mas só é chamado no caminho **agentEngine** — no caminho **n8n** o contato nunca é criado.
5. **Tabelas duplicadas de contato** — `contatos` (CRM principal, com `opt_out`, `push_name`) e `dados_cliente` (com `atendimento_ia`, `nomewpp`). Não há sincronização entre elas. A lista de conversas usa `contatos`; o badge de IA na lista de Contatos usa `dados_cliente` (conforme conversa anterior).
6. **n8n não salva resposta em `whatsapp_messages`** — Quando `n8n_webhook_url` está preenchido, o webhook só faz `fetch` para o n8n e retorna. Se o n8n responde ao cliente via Evolution, **a resposta nunca chega à tabela `whatsapp_messages`**, portanto não aparece na tela de conversas. Só apareceria se o n8n chamasse de volta um endpoint do CRM (não implementado) ou se a Evolution disparasse webhook `messages.upsert` com `fromMe=true` — que é explicitamente filtrado em `webhook.ts:130`.
7. **HMAC opcional** — `EVOLUTION_WEBHOOK_SECRET` provavelmente não está setado em produção (não aparece na lista de secrets do `index.ts:/api/seguranca/status-chaves`). Webhook está aberto.
8. **`session_id` = telefone sem `@s.whatsapp.net`** — Consistente entre webhook (`telefone`) e agentEngine (`entrada.telefone`). OK, mas indocumentado.
9. **`evolution_instancia` no fallback do `agentEngine`** — Usa `agente.evolution_instancia || entrada.instancia`. Se vier `null`, cai no nome da instância do payload, o que pode divergir do nome salvo no agente.

### ❌ Bugs confirmados
1. **Mensagens recebidas de contatos novos não criam contato** (gap #4). O contato fica "fantasma" — aparece na lista de conversas pelo `push_name` de `whatsapp_messages`, mas não tem registro em `contatos`, então:
   - Não pode ser atribuído a estágio do funil.
   - Não pode receber tags.
   - Tela de detalhe `/contatos/:id` quebra (não há id).
   - `opt_out` futuro via webhook falha silenciosamente.
2. **Filtro de `fromMe=true`** corta respostas enviadas pelo n8n via Evolution — combinado com gap #6, conversas processadas pelo n8n ficam **unilaterais** na UI.
3. **Confirmação de opt-out depende de `integracoes_config`** (gap #1) — para usuários sem registro nessa tabela, o opt-out marca o contato mas o cliente nunca recebe a mensagem de confirmação.
4. **`saveEvolutionConfig` faz `ON CONFLICT DO NOTHING` sem constraint** — Não há UNIQUE em `agentes(user_id)` nem em `(user_id, nome)`, então `ON CONFLICT` na prática nunca dispara — sempre insere. Múltiplas chamadas a `/whatsapp/connect` quando o agente foi deletado podem criar agentes duplicados.

### 🔧 Correções recomendadas (ordem de prioridade)

**P0 — Bugs que quebram fluxo de usuário**
1. **Criar contato no webhook** — substituir o `UPDATE contatos` por upsert (espelhar `agentEngine.upsertContato`), executado SEMPRE (antes do branch n8n vs agentEngine), em `webhook.ts`.
2. **Salvar resposta do n8n em `whatsapp_messages`** — duas opções:
   - (a) Aceitar `fromMe=true` no webhook quando `n8n_webhook_url` estiver configurado para a instância (e gravar como `from_me=true, status='sent'`), OU
   - (b) Criar endpoint `POST /api/webhook/n8n-resposta` autenticado por `x-n8n-secret` para o n8n postar de volta o que enviou.
3. **Unificar config Evolution** — fonte única em `agentes`. Remover lookup em `integracoes_config` no handler de opt-out; usar a mesma `getEvolutionConfig`.

**P1 — Integridade de dados**
4. **UNIQUE parcial em `agentes(evolution_instancia)`** — `CREATE UNIQUE INDEX idx_agentes_evolution_instancia ON agentes(evolution_instancia) WHERE evolution_instancia IS NOT NULL` em `migrations.ts`.
5. **UNIQUE em `agentes(user_id)`** (ou `(user_id, nome)`) para fazer o `ON CONFLICT DO NOTHING` do `saveEvolutionConfig` realmente funcionar — ou trocar por `UPDATE ... ; if rowCount=0 then INSERT`.
6. **Aumentar tamanho da instância padrão** — `crm_${userId.slice(0,8)}` → `crm_${userId.replace(/-/g,'')}` (UUID completo) para zerar risco de colisão.

**P2 — Segurança**
7. **Setar `EVOLUTION_WEBHOOK_SECRET`** em produção e validar HMAC obrigatoriamente.

**P3 — Higiene**
8. Documentar formato de `session_id` (telefone limpo, sem sufixo) em comentário no topo de `webhook.ts` e `whatsappRouter`.
9. Considerar deprecação de `dados_cliente` em favor de campos em `contatos`, ou criar view de compatibilidade.

## Entregável

Um único arquivo:

- `backend/DIAGNOSTICO-EVOLUTION.md` — relatório completo com as 4 seções (✅ / ⚠️ / ❌ / 🔧) acima, incluindo trechos de SQL e diffs sugeridos para cada correção P0/P1.

Nenhum outro arquivo do projeto será modificado.

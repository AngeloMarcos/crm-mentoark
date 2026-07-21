# Auditoria de Código — Log

Ver protocolo completo em `AUDITORIA_PROTOCOLO.md`. Status possíveis: `✅ revisado sem bug` · `🔧 corrigido` · `⚠️ pendente (precisa decisão)` · `🗑️ candidato a remoção` · `🔄 em progresso`.

### Sprint 4/5 (2026-07-21) — backend/src/services/disparoProcessor.ts + backend/src/routes/disparos.ts, blindagem do motor de disparo em lote

| Achado | Descrição | Ação |
|--------|-----------|------|
| 1 — timeout na rota manual | `POST /disparos/enviar` usava `fetch()` bruto contra a Evolution API, sem `AbortController`/timeout — se a Evolution travasse, a requisição ficava pendurada indefinidamente | 🔧 corrigido — trocado por `evolutionFetch()` (mesmo padrão já usado no motor em lote) |
| 2 — delay fixo entre mensagens | Motor em lote (`disparoProcessor.ts`) usava `sleep(1500)` fixo, ignorando o campo `perfil_velocidade` da campanha | 🔧 corrigido — delay dinâmico aleatorizado por perfil (`safe` 15-30s, `normal` 5-12s, `fast` 1.5-4s) |
| 3 — sem pausa por falhas consecutivas | Colunas `pausa_erros_consecutivos`/`limite_erros_consecutivos` existiam no schema mas nunca eram lidas — campanha continuava tentando enviar mesmo com canal desconectado/banido | 🔧 corrigido — contador de erros consecutivos por campanha; ao atingir o limite (respeitando a flag `pausa_erros_consecutivos`), campanha vai para `status='pausado'` e o lote é abortado |
| 4 — sem respeito à janela de horário/fim de semana no lote | `horario_inicio`/`horario_fim`/`pausa_fins_semana` só eram validados na rota manual, não no motor em lote (fuso America/Sao_Paulo) | 🔧 corrigido — mesma validação adicionada ao motor em lote, antes de cada mensagem |
| 5 — mensagens órfãs em `'sending'` (achado durante a correção dos itens 3/4) | `get_next_disparo_batch` marca até 5 linhas como `'sending'` atomicamente ao buscar o lote; se o motor abortasse o lote (itens 3/4) sem processar todas as linhas já dequeueadas, elas ficariam presas em `'sending'` para sempre (a função só busca `'pending'`) | 🔧 corrigido — `requeuePendentes()` devolve as linhas não processadas para `'pending'` antes de cada `break` |

Verificação de tipos: `tsc --noEmit` do projeto completo estoura memória mesmo com 4GB de heap (problema pré-existente, não relacionado a esta mudança — build oficial usa `swc`, que não é afetado). Check escopado (`disparoProcessor.ts`/`disparos.ts` + grafo de imports direto, mesmas flags do `tsconfig.json`) rodou limpo, sem erros.

Deploy: commit `eb81f0f`, testado em homolog (`/opt/crm-homolog`, banco `crm_hml` isolado) antes de ir para produção (`/opt/crm/backend`).

### Infra — Evolution API (2026-07-21) — bug P2010 (mensagens recebidas não chegam ao CRM): investigado, fix tentado e revertido, causa raiz refinada

**Contexto:** bug conhecido desde 2026-07-08/10 (ver seção "Rastreio mensagens novas não atualizam" mais abaixo neste arquivo) — Evolution API v2.3.7 quebra internamente em `updateChatUnreadMessages()` (chamado a partir de `messages.upsert`) antes de conseguir despachar o webhook, então o CRM nunca recebe mensagens genuínas de WhatsApp. Confirmado ainda ativo em produção em 2026-07-21 (teste ao vivo, número real, 0 eventos `messages.upsert` em 72h de log).

**Nova informação encontrada nesta sessão:** o erro real alterna entre duas variantes, ambas dentro do código `P2010` do Prisma:
1. `Code: 1064` — `You have an error in your SQL syntax ... near '"Message"'` — erro de sintaxe MySQL genuíno: a query usa aspas duplas para identificador (`"Message"`), válido em PostgreSQL, **inválido em MySQL** (que usa crase por padrão). Forte indício de que a raw query foi escrita para Postgres e nunca adaptada corretamente para MySQL.
2. `Error querying the database: Named and positional parameters mixed in one statement` — incompatibilidade de binding de parâmetros do Prisma especificamente contra MySQL.

Encontrado no upstream (`github.com/evolution-foundation/evolution-api`) o PR #2333 ("fix(mysql): compatibilidade da coluna lid e queries RAW", merged 2026-02-24 em `develop`) que reescreve exatamente `updateChatUnreadMessages()` com versões MySQL dedicadas — mas **não há release estável desde v2.3.7** (2025-12-05); só existem prereleases `2.4.0-rc1` (2026-05-06) e `2.4.0-rc2` (2026-05-17), lançadas depois desse PR.

**Tentativa de fix, revertida:** atualizamos `evolution` (VPS) de `evoapicloud/evolution-api:latest` (= v2.3.7, imagem local cacheada há 2 meses, não recebia atualização automática) para `2.4.0-rc2`. Resultado: **P2010 resolvido** (mensagem real recebida e salva em `whatsapp_messages` com sucesso, confirmado no banco) — mas **toda a API REST da Evolution passou a exigir licença paga** (`{"code":"LICENSE_REQUIRED"}` em qualquer chamada, inclusive `fetchInstances` e `sendText`), quebrando o **envio** de mensagens (motor de disparo e chat manual) em produção. Testado também `2.4.0-rc1` — mesmo bloqueio de licença. **Ambos revertidos**, confirmado envio e recebimento restaurados ao comportamento anterior (send OK / receive com P2010).

**Ação de blindagem aplicada:** `image:` em `/opt/evolution/docker-compose.yml` fixado explicitamente em `evoapicloud/evolution-api:v2.3.7` (era `:latest`, uma tag flutuante) com comentário `[AUDITORIA]` documentando o bloqueio de licença do 2.4.x — evita upgrade acidental para uma versão paga sem essa informação, e evita que o `:latest` "ande sozinho" se o publisher atualizar o ponteiro no futuro.

**Estado atual:** recebimento de mensagens **continua quebrado** (P2010, mesma causa raiz de sempre); envio funcionando normalmente. `FIX PENDENTE`, próxima linha de investigação levantada nesta sessão (não testada ainda): migrar `DATABASE_PROVIDER` do Evolution de `mysql` para `postgresql` na v2.3.7 atual — a hipótese do erro 1064 (aspas duplas de identificador, sintaxe válida em Postgres) tornou essa opção mais promissora do que constava no registro anterior de 2026-07-10 (que a descartava com "garantia baixa"/relatos genéricos). Requer provisionar schema Postgres novo para o Evolution e rodar as migrations internas dele — ação de infra maior, não tentada nesta sessão por já ter havido um incidente de produção (quebra de envio) na tentativa anterior.

### Sprint 3 (2026-07-13) — backend/src/routes/webhook.ts, blindagem de status numérico e sanitização LIKE

| Achado | Descrição | Ação |
|--------|-----------|------|
| 1 — handleStatusUpdate | Condicional só reconhecia `status === 'READ' \|\| status === 'PLAYED'` (strings). Se a Evolution repassar o status bruto do Baileys como número, a mensagem nunca era marcada como lida no CRM | 🔧 corrigido, com correção sobre o patch original proposto: o patch sugeria `3=READ, 4=PLAYED`, mas verifiquei o enum oficial `WebMessageInfo.Status` direto na fonte do Baileys (`WAProto/index.js`, `WhiskeySockets/Baileys`) e os valores reais são `ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5`. Aplicar `3=READ` teria marcado mensagens **apenas entregues** (não lidas de verdade) como lidas — um bug pior que o silêncio original. Corrigido para aceitar `4`/`'4'` (READ) e `5`/`'5'` (PLAYED), além das strings literais |
| 2 — fallback prefixo UUID | `prefixo` (derivado de `payload.instance`, campo controlado pelo emissor do webhook) ia direto para um `LIKE $1` sem sanitizar `%`/`_` — um valor malicioso poderia alargar o casamento do LIKE e resolver para o `userId` errado | 🔧 corrigido — `prefixo = instancia.slice(4).replace(/[%_]/g, '')` antes de montar o padrão do LIKE. Aplicado exatamente como proposto |

Build do backend (`npm run build`, swc) ok, sem erros de sintaxe.

### Sprint 2 (2026-07-13) — backend/src/routes/integracoes.ts, 2 correções de persistência

| Achado | Descrição | Ação |
|--------|-----------|------|
| 1 — PUT /:id | `UPDATE ... SET campo = COALESCE($N, campo)` com `null` no lugar de `$N` sempre mantinha o valor antigo — não havia como o atendente realmente limpar URL/API key/instância pela tela do CRM | 🔧 corrigido — query dinâmica: só entram no `SET` os campos com `!== undefined` (enviados de propósito), permitindo `null` real passar e limpar a coluna. Caso nenhum campo seja enviado, retorna a linha atual sem tentar um `UPDATE` vazio (inválido em SQL) |
| 2 — DELETE /:id | Deletava o conector mas nunca limpava o espelho em `agent_configs` (ver `syncEvolution()`), deixando o webhook/motor de IA com `evolution_instancia`/`evolution_server_url`/`evolution_api_key` de uma instância já excluída | 🔧 corrigido, com ajuste sobre o patch original proposto: `agent_configs` tem `UNIQUE(user_id)` (uma linha só por usuário), mas `integracoes_config` **não** tem UNIQUE em `(user_id, tipo, instancia)` — um usuário pode ter mais de um conector `evolution` (múltiplas instâncias). Limpar `agent_configs` só pelo `user_id` a cada delete de qualquer conector evolution apagaria a instância **realmente ativa** se o usuário excluísse uma instância antiga/extra. Corrigido para só limpar quando `agent_configs.evolution_instancia` bate exatamente com a instância do conector deletado (`IS NOT DISTINCT FROM`, null-safe) |

Build do backend (`npm run build`, swc) ok, sem erros de sintaxe. `tsc --noEmit` completo estourou memória no ambiente local (não relacionado à mudança — projeto já usa swc no build oficial por esse motivo); tipos revisados manualmente, consistentes com o padrão non-tipado de `pool.query` já usado no resto do arquivo.

## Módulo: WhatsApp

| Módulo   | Arquivo                                              | Status         | Resumo |
|----------|-------------------------------------------------------|----------------|--------|
| WhatsApp | backend/src/routes/webhook.ts                          | 🔧 corrigido | Cabeçalho desatualizado corrigido; dedup agora escopado por instancia; fromMe órfão agora loga [WEBHOOK_REJECT]; isValidJid não usado → FIX PENDENTE (risco de derrubar msgs legítimas sem teste manual). **2026-07-10 (rodada 2 revisão externa):** roteamento N8N movido para antes do descarte de grupo (grupos com n8n_webhook_url configurado agora são encaminhados); guarda `!payload?.instance` adicionada em handleStatusUpdate/handleMessageDelete; timer individual por mensagem na dedup em memória → FIX PENDENTE (otimização, não bug) |
| WhatsApp | backend/src/routes/whatsapp.ts                          | ⚠️ pendente | getEvolutionConfig/saveEvolutionConfig nunca leem/escrevem agent_configs (webhook.ts lê de lá primeiro) → possível instância errada em send/connect/disconnect para quem só tem agent_configs; limpeza de duplicatas em /connect pode causar delete+recreate se cfg.instancia≠stableInstancia. Ambos FIX PENDENTE (decisão de produto / correlação com logs) |
| WhatsApp | backend/src/services/agentEngine.ts                     | ⚠️ pendente | Check `agentConfig?.motor_ia` nunca é true (coluna não vem no SELECT, e sem evidência de existir em agent_configs) → FIX PENDENTE (risco de coluna inexistente); demais notas são acoplamento documentado, não bugs |
| WhatsApp | backend/src/services/humanizationService.ts             | ✅ revisado sem bug | Não é usado pelo chat (só por disparoProcessor.ts); usa chave OpenAI global em vez do provider por usuário — FIX PENDENTE se isso não for intencional |
| WhatsApp | backend/src/services/whatsapp.ts                        | 🗑️ removido | Confirmado morto e removido (commit 2be8309) |
| WhatsApp | backend/src/services/webhook.ts                         | 🗑️ removido | Confirmado morto e removido (commit 2be8309) |
| WhatsApp | src/pages/WhatsApp.tsx                                  | ✅ revisado sem bug | Nota de nomenclatura: aba "Diagnóstico" ≠ DiagnosticoWhatsApp.tsx |
| WhatsApp | src/components/WhatsAppInterface.tsx                    | 🔧 corrigido | BUG SEVERO: handleSendMessage chamava /api/openclaw/chat (agente admin da VPS) em vez de gerar resposta ao cliente → **corrigido em 2026-07-08** a pedido do usuário (OpenAI sem crédito bloqueando envio de mensagens): bloco removido, envio agora sempre manda o texto digitado pelo atendente, sem tocar em IA/OpenAI; aba "Meus" corrigida (misturava arquivados); menu Silenciar 8h/1sem/sempre não persistia nada → corrigido; modal "Nova Conversa" duplicado → removido (commit 2be8309). **2026-07-10:** BUG confirmado ao vivo (401 em produção) — `apiHeaders()` lia token do localStorage sem checar expiração/refresh, diferente do QueryBuilder de client.ts; corrigido para usar `getFreshToken()` (async) em todas as ~21 chamadas fetch da tela |
| WhatsApp | src/integrations/database/client.ts                     | 🔧 corrigido | **2026-07-10:** `api.get/post/patch/delete` montavam headers de auth sem checar expiração nem tentar refresh (só `QueryBuilder._exec()` fazia isso) → exportado `getFreshToken()` centralizando o check+refresh, usado nos 4 helpers |
| WhatsApp | src/services/evolutionService.ts                        | 🔧 corrigido | fetchConnectionStatus(instancia) aceitava parâmetro mas nunca usava — corrigido |
| WhatsApp | src/components/whatsapp/InstanceManagementPanel.tsx     | 🔧 corrigido / ⚠️ pendente | BUG: pollQrLoop/pollUntilConnected usavam estado (closure obsoleto) na condição do while — loop nunca rodava de verdade → corrigido com refs; targetInstancia calculado e não usado → corrigido; carregarStatus aplica 1 status a todas instâncias → FIX PENDENTE; modal "Conectar Novo WhatsApp" duplicado → removido (commit 2be8309) |
| WhatsApp | src/components/whatsapp/TesteInstancias.tsx             | ✅ revisado sem bug | Referência correta de status por instância |
| WhatsApp | src/pages/admin/DiagnosticoWhatsApp.tsx                 | ✅ revisado sem bug | Bug real estava no backend consumido (ver index.ts abaixo), corrigido |
| WhatsApp | src/pages/MonitorWhatsApp.tsx                           | 🔧 corrigido | BUG: fetchConversas dependia de [conversas] no useCallback mas alterava conversas — recriava o useEffect a cada fetch, virando um loop contínuo em vez de polling de 30s → corrigido com ref |
| WhatsApp | src/pages/SimuladorWebhook.tsx                          | 🔧 corrigido | BUG: URL errada (/api/webhook/evolution em vez de /webhook/evolution) — simulador sempre batia em 404 → corrigido; mensagem de ajuda do erro 401 desatualizada → corrigida |
| WhatsApp | backend/src/index.ts (lateral — só rota /api/admin/webhook-trace) | 🔧 corrigido | Filtro de dedup comparava message_id com padrão de telefone (nunca casava) → corrigido com JOIN em whatsapp_messages |
| WhatsApp | backend/src/services/migrations.ts (lateral)            | 🗑️ removido | Duplicata não importada de backend/src/migrations.ts — confirmado morto e removido (commit 2be8309) |

### Rastreio "mensagens novas não atualizam na tela" (2026-07-08) — camada por camada

Query pendente executada (overlap `agent_configs` x `integracoes_config` x `agentes`): confirmou 1 divergência real (`agent_configs.evolution_instancia='teste'` para mentoark@gmail.com vs `crm_435ee4720fc3` correto nas outras duas tabelas), mas **descartada como causa** — o lookup de userId em `webhook.ts` resolve certo via fallback `agentes`. Documentado no comentário [AUDITORIA] existente em `getEvolutionConfig()` (whatsapp.ts).

Teste ao vivo (mensagem WhatsApp real enviada para instância conectada `crm_435ee4720fc3`, status "open"): **nenhum evento `messages.upsert` chegou ao webhook do CRM.** Causa raiz encontrada nos logs brutos do container `evolution` (não do CRM): `PrismaClientKnownRequestError` (code P2010, "Named and positional parameters mixed in one statement") dentro de `io.updateChatUnreadMessages`, chamado internamente por `messages.upsert` do próprio Evolution API v2.3.7 antes de despachar o webhook. **Bug upstream no Evolution API, não no código do CRM.**

| Camada | Arquivo | Status | Resumo |
|--------|---------|--------|--------|
| 0 (Evolution API, fora do CRM) | N/A — infra | ❌ causa raiz confirmada | Bug interno do Evolution v2.3.7 (Prisma + MySQL) impede `messages.upsert` de ser despachado para qualquer mensagem recebida. FIX PENDENTE: trocar DATABASE_PROVIDER para postgresql, ou fixar versão anterior do Evolution — mudança de infra, não de código, fora do escopo desta sessão ("não fazer deploy") |
| 1 — webhook.ts | backend/src/routes/webhook.ts | ✅ revisado sem bug | Rota/auth funcionam (confirmado com eventos reais chats.upsert/presence.update chegando); nunca recebe messages.upsert por causa da Camada 0 |
| 2 — API GET /conversas, /conversas/:phone | backend/src/routes/whatsapp.ts | ✅ revisado sem bug | Ambas filtram corretamente por user_id, sem staleness; pegariam mensagem nova se ela existisse no banco |
| 3 — fetch frontend | src/components/WhatsAppInterface.tsx (fetchConversas, fetchMensagens) | ✅ revisado sem bug | Early-return de fetchMensagens verificado a fundo — só bloqueia quando conteúdo é idêntico (tamanho de array já difere com msg nova); sem outro early-return ou comparação de referência problemática |
| 4 — polling (3 intervals) | src/components/WhatsAppInterface.tsx | 🔧 corrigido | BUG real e independente encontrado: Interval B chamava `fetchConversas(false)` fixo, ignorando `activeTab` — brigava com Interval A na aba "Arquivadas", causando flicker entre listas arquivada/não-arquivada. Corrigido (agora usa `activeTab === "arquivadas"` + adicionado à dependência do efeito). Os 3 intervals continuam redundantes entre si (não é bug, é ineficiência) → consolidação FIX PENDENTE (risco de mudar cadência percebida) |
| 5 — render | src/components/WhatsAppInterface.tsx | ✅ revisado sem bug | Sem React.memo em componentes filhos; useMemo com dependências corretas |

### Busca lateral — arquivos fora da lista original, avaliados como genuinamente parte do fluxo WhatsApp mas NÃO auditados nesta sessão (recomendo para a próxima)

| Módulo   | Arquivo                                              | Status         | Resumo |
|----------|-------------------------------------------------------|----------------|--------|
| WhatsApp | backend/src/routes/integracoes.ts                       | ⚠️ pendente (não auditado) | Contém syncEvolution(), o outro caminho de escrita em agent_configs mencionado em vários FIX PENDENTE deste log — essencial para resolver a inconsistência agent_configs vs integracoes_config/agentes |
| WhatsApp | backend/src/utils/resilientFetch.ts                     | ⚠️ pendente (não auditado) | evolutionFetch()/sanitizeEvolutionUrl() usados por quase todo request à Evolution API neste módulo — vale conferir timeouts/retry |
| WhatsApp | src/pages/Integracoes.tsx                               | ⚠️ pendente (não auditado) | Tela de Integrações — contraparte de frontend do syncEvolution() |
| WhatsApp | src/pages/Agentes.tsx                                   | ⚠️ pendente (não auditado) | Configuração de agentes, provavelmente edita evolution_instancia/evolution_server_url |
| WhatsApp | src/pages/TesteConversas.tsx                            | ⚠️ pendente (não auditado) | Nome sugere ferramenta de teste de conversas — não confirmado |
| WhatsApp | src/pages/OpenClaw.tsx                                  | 🗑️ removido | **Removido por completo em 2026-07-08** (agente admin com shell na VPS, alvo do BUG SEVERO em WhatsAppInterface.tsx; Grafana assume o papel de observabilidade). Junto: `backend/src/routes/openclaw.ts`, `src/components/openclaw/` (pasta inteira), rota `/openclaw` (App.tsx), item de menu (AppSidebar.tsx), bloco `usarOpenClaw`/`chamarOpenClawAgent` em `agentEngine.ts`. Confirmado antes da remoção: coluna `motor_ia` não existe em `agentes` nem `agent_configs` em produção — `usarOpenClaw` era sempre `false`, nenhum agente real dependia desse caminho. |

Demais arquivos da busca lateral (`src/components/catalogo/*`, `src/components/marketing/*`, `src/components/campanhas/*`, `src/components/kanban/*`, `src/components/workflows/*`, `src/components/seguranca/*`, `src/pages/Disparos.tsx`, `src/pages/Campanhas.tsx`, `src/pages/CatalogoEnvios.tsx`, `App.tsx`, `AppSidebar.tsx`, `docs-content.ts`, `mockData.ts`, `tailwind.config.ts`, etc.) foram avaliados como menções incidentais (WhatsApp citado como um canal de envio entre outros, ou "evolution" usado como palavra comum) — não são núcleo do módulo WhatsApp, não adicionados à auditoria.

### Revisão externa (Google AI Studio) sobre webhook.ts — rodada 3 / Sprint 6 (2026-07-10, noite) — fechamento

| Achado | Descrição | Ação |
|--------|-----------|------|
| — | Fetch de confirmação de opt-out (`message/sendText`) com `await` direto, sem timeout — terceiro lugar do arquivo com o mesmo risco (Evolution travar prende a requisição do webhook) | 🔧 corrigido — `AbortController` 5s, mesmo padrão dos fetches de foto de perfil (rodada 1) e N8N (rodada 2) |

**Fechamento de `webhook.ts`:** com esta rodada, todos os achados de revisão externa (linha-a-linha, 3 rodadas, 9 achados no total: A-E na rodada 1, 1-3 na rodada 2, 1 nesta rodada) foram corrigidos, verificados como falso positivo, ou documentados como `FIX PENDENTE`. Os únicos itens em aberto no arquivo são os 2 que exigem decisão de infraestrutura/produto, não código: (1) migração de `telefone` pra E.164 antes de trocar `ILIKE '%...'` por igualdade exata (~9 ocorrências, documentado no cabeçalho do arquivo); (2) bug upstream Prisma P2010 do Evolution API (causa raiz de "zero mensagens recebidas", 3 opções de contorno levantadas, nenhuma aplicada — decisão do usuário). Nenhum achado de código pendente. `webhook.ts` está fechado para esta linha de auditoria.

### Revisão externa (Google AI Studio) sobre webhook.ts — rodada 2 (2026-07-10, noite) — 3 achados

| Achado | Descrição | Ação |
|--------|-----------|------|
| 1 | `fetch` fire-and-forget pro N8N (`n8nWebhookUrl`) sem timeout — instância N8N lenta de um usuário podia degradar recepção de webhook pra todos | 🔧 corrigido — `AbortController` 8s, mesmo padrão do achado B da rodada 1 |
| 2 | Suspeita de que upsert de contato + fetch de foto de perfil rodariam sem `userId` resolvido, gastando query+HTTP antes do descarte | ✅ verificado, **falso positivo** — bloco já está aninhado dentro de `if (userId)`; comentário `[AUDITORIA] LÓGICA` adicionado, nenhuma mudança funcional |
| 3 | Loop de `handleStatusUpdate` sem guarda contra item `null`/`undefined` em `updates` — `TypeError` interromperia o resto do lote | 🔧 corrigido — `if (!upd \|\| typeof upd !== 'object') continue;` |

**Avaliação de cobertura:** com esta rodada, os achados conhecidos de `webhook.ts` (linha isolada, sem contexto de sistema) parecem esgotados — os itens que restam (`ILIKE` sem índice, `isValidJid` não usado, schema `webhook_mensagens_processadas` a confirmar, bug upstream Prisma P2010) já são `FIX PENDENTE` documentados que exigem decisão/dado externo, não mais bugs de lógica isolados que uma leitura linha-a-linha do arquivo colado consiga achar. Mandar pra mais uma rodada só faz sentido se algo mudar no arquivo.

### Revisão externa (Google AI Studio) sobre webhook.ts — rodada 1 (2026-07-10, noite) — 5 achados

| Achado | Descrição | Ação |
|--------|-----------|------|
| A | Race condition no upsert de contato: dois caminhos concorrentes escrevendo em `contatos`, o segundo (`INSERT` sem `ON CONFLICT`) podia colidir se duas mensagens do mesmo contato novo chegassem próximas | 🔧 corrigido — `ON CONFLICT (user_id, telefone) DO NOTHING` adicionado |
| B | `fetch` sem timeout nas 2 chamadas de foto de perfil da Evolution API — conexão pendurada indefinidamente se a Evolution travar | 🔧 corrigido — `AbortController` com 5s de timeout em ambas |
| C | `telefone ILIKE '%...'` em ~9 queries do arquivo impede uso de índice B-Tree, full table scan em toda mensagem recebida | ⚠️ pendente — exige migração de dados (normalizar `telefone` pra E.164), documentado no cabeçalho do arquivo |
| D | `fs.appendFileSync` em `wlog()` bloqueava o event loop a cada chamada (todo webhook), degradando latência de toda a API sob tráfego alto | 🔧 corrigido — trocado por `fs.appendFile` assíncrono |
| E | Regex candidata de `isValidJid()` (já `FIX PENDENTE`) também estava incorreta pra JIDs de grupo (aceitam hífen, não são só dígitos) | 📝 comentário existente atualizado com a ressalva, função continua não ativada |

### Sprint 3 (2026-07-10, tarde) — teste de contorno do P2010 + itens pendentes

| Item | Resultado |
|------|-----------|
| Tarefa A — `DATABASE_SAVE_DATA_CHATS=false` | ❌ Testado ao vivo (backup + restart + mensagem real de fora), **descartado**: mesmo crash `PrismaClientKnownRequestError P2010`, mesma frequência, revertido e instância reconectada. Pesquisa adicional: esse bug em `Chat.unreadMessages` já ocorre em outras versões do Evolution rodando em PostgreSQL também — não é exclusivo do MySQL/v2.3.7. `FIX PENDENTE`, ver comentário `[AUDITORIA]` atualizado em `webhook.ts`. |
| Tarefa B — 401 em `/api/whatsapp/*` | ✅ Investigado. Confirmado que **não é bug específico do WhatsApp** — o mesmo IP recebe 401 em `/api/dados_cliente` (rota não relacionada) de forma consistente por 25+ minutos, sem nenhuma request bem-sucedida no meio. Conclusão: sessão/token expirado ou inválido no navegador do usuário, não um bug de código. Ação recomendada: logout/login. |
| Tarefa C — instância órfã `crm_5319f0ed61b3` | ⚠️ pendente (decisão do usuário). `connectionState: "connecting"` confirmado (nunca pareia). **Correção ao ground truth da Sprint 3:** não está referenciada em nenhuma das 3 tabelas (`agent_configs`, `agentes`, `integracoes_config`) para nenhum usuário — inclusive a config de "Cris" (`agent_configs`) existe mas está com `evolution_instancia` vazio e `ativo=false`, contradizendo a premissa de "N8N routing ativo" citada no prompt. Instância genuinamente órfã, sem vínculo ativo no CRM. `DEL_INSTANCE=true` já habilitado no Evolution, então deletar é tecnicamente simples — mas é ação destrutiva num serviço externo de produção, `FIX PENDENTE` aguardando confirmação do usuário (deletar vs. deixar disponível pra pareamento manual futuro). |

### Continuação da busca lateral (2026-07-10) — os 5 arquivos pendentes acima, revisados

| Módulo   | Arquivo                                              | Status         | Resumo |
|----------|-------------------------------------------------------|----------------|--------|
| WhatsApp | backend/src/routes/integracoes.ts                       | 🔧 corrigido / ⚠️ pendente | `syncEvolution()` sobrescreve `agent_configs` sempre que `integracoes_config` é salvo com `status='conectado'` — status esse que vinha só de `/instance/fetchInstances` responder HTTP 200 (API key válida), sem checar se a instância está de fato pareada. Explica a divergência `agent_configs.evolution_instancia='teste'` já documentada. Mitigação aplicada no frontend (ver `Integracoes.tsx`); validação server-side ainda `FIX PENDENTE` (exige chamada síncrona à Evolution API antes de confiar no status do cliente — decisão do usuário) |
| WhatsApp | src/pages/Integracoes.tsx                               | 🔧 corrigido | `testar()` agora só marca `status='conectado'` se a instância aparecer com `connectionStatus:'open'` na resposta real da Evolution, em vez de confiar em HTTP 200 sozinho |
| WhatsApp | backend/src/utils/resilientFetch.ts                     | ✅ revisado sem bug | Retry/timeout/backoff conferidos, lógica correta; usado por agentEngine.ts, whatsapp.ts, disparoProcessor.ts |
| WhatsApp | src/pages/Agentes.tsx                                   | ⚠️ pendente | `testarEvolution()` exige `evolution_instancia` preenchido mas nunca o envia ao backend — `/api/whatsapp/status` resolve/retorna status de qualquer instância que achar pro userId, não necessariamente a deste agente; pode dar falso positivo "conectado". `FIX PENDENTE` (exige mudança de contrato de rota + decisão de produto sobre múltiplas instâncias por usuário) |
| WhatsApp | src/pages/TesteConversas.tsx                            | ⚠️ pendente | Página DEV (`/dev/teste-conversas`). Painel "Comparação de Fontes" renderiza a mesma variável duas vezes e sempre mostra "consistente" sem comparar nada de verdade — falsa confiança numa ferramenta cujo propósito é justamente validar consistência. `verificarTabelas()` manda body sem `Content-Type`, `force` nunca chega ao backend. Ambos `FIX PENDENTE`, baixa prioridade (ferramenta DEV) |

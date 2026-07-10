# Auditoria de Código — Log

Ver protocolo completo em `AUDITORIA_PROTOCOLO.md`. Status possíveis: `✅ revisado sem bug` · `🔧 corrigido` · `⚠️ pendente (precisa decisão)` · `🗑️ candidato a remoção` · `🔄 em progresso`.

## Módulo: WhatsApp

| Módulo   | Arquivo                                              | Status         | Resumo |
|----------|-------------------------------------------------------|----------------|--------|
| WhatsApp | backend/src/routes/webhook.ts                          | 🔧 corrigido | Cabeçalho desatualizado corrigido; dedup agora escopado por instancia; fromMe órfão agora loga [WEBHOOK_REJECT]; isValidJid não usado → FIX PENDENTE (risco de derrubar msgs legítimas sem teste manual) |
| WhatsApp | backend/src/routes/whatsapp.ts                          | ⚠️ pendente | getEvolutionConfig/saveEvolutionConfig nunca leem/escrevem agent_configs (webhook.ts lê de lá primeiro) → possível instância errada em send/connect/disconnect para quem só tem agent_configs; limpeza de duplicatas em /connect pode causar delete+recreate se cfg.instancia≠stableInstancia. Ambos FIX PENDENTE (decisão de produto / correlação com logs) |
| WhatsApp | backend/src/services/agentEngine.ts                     | ⚠️ pendente | Check `agentConfig?.motor_ia` nunca é true (coluna não vem no SELECT, e sem evidência de existir em agent_configs) → FIX PENDENTE (risco de coluna inexistente); demais notas são acoplamento documentado, não bugs |
| WhatsApp | backend/src/services/humanizationService.ts             | ✅ revisado sem bug | Não é usado pelo chat (só por disparoProcessor.ts); usa chave OpenAI global em vez do provider por usuário — FIX PENDENTE se isso não for intencional |
| WhatsApp | backend/src/services/whatsapp.ts                        | 🗑️ removido | Confirmado morto e removido (commit 2be8309) |
| WhatsApp | backend/src/services/webhook.ts                         | 🗑️ removido | Confirmado morto e removido (commit 2be8309) |
| WhatsApp | src/pages/WhatsApp.tsx                                  | ✅ revisado sem bug | Nota de nomenclatura: aba "Diagnóstico" ≠ DiagnosticoWhatsApp.tsx |
| WhatsApp | src/components/WhatsAppInterface.tsx                    | 🔧 corrigido | BUG SEVERO: handleSendMessage chamava /api/openclaw/chat (agente admin da VPS) em vez de gerar resposta ao cliente → **corrigido em 2026-07-08** a pedido do usuário (OpenAI sem crédito bloqueando envio de mensagens): bloco removido, envio agora sempre manda o texto digitado pelo atendente, sem tocar em IA/OpenAI; aba "Meus" corrigida (misturava arquivados); menu Silenciar 8h/1sem/sempre não persistia nada → corrigido; modal "Nova Conversa" duplicado → removido (commit 2be8309) |
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

### Revisão externa (Google AI Studio) sobre webhook.ts (2026-07-10, noite) — 5 achados

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

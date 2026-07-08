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
| WhatsApp | src/components/WhatsAppInterface.tsx                    | 🔧 corrigido / ⚠️ pendente | BUG SEVERO: handleSendMessage chama /api/openclaw/chat (agente admin da VPS) em vez de gerar resposta ao cliente → FIX PENDENTE (alta prioridade, precisa decisão de produto); aba "Meus" corrigida (misturava arquivados); menu Silenciar 8h/1sem/sempre não persistia nada → corrigido; modal "Nova Conversa" duplicado → removido (commit 2be8309) |
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
| WhatsApp | src/pages/OpenClaw.tsx                                  | ⚠️ pendente (não auditado formalmente) | Lido informalmente em sessão anterior (não como parte deste protocolo) — é o alvo do BUG SEVERO encontrado em WhatsAppInterface.tsx |

Demais arquivos da busca lateral (`src/components/catalogo/*`, `src/components/marketing/*`, `src/components/campanhas/*`, `src/components/kanban/*`, `src/components/workflows/*`, `src/components/seguranca/*`, `src/pages/Disparos.tsx`, `src/pages/Campanhas.tsx`, `src/pages/CatalogoEnvios.tsx`, `App.tsx`, `AppSidebar.tsx`, `docs-content.ts`, `mockData.ts`, `tailwind.config.ts`, etc.) foram avaliados como menções incidentais (WhatsApp citado como um canal de envio entre outros, ou "evolution" usado como palavra comum) — não são núcleo do módulo WhatsApp, não adicionados à auditoria.

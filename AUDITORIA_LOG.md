# Auditoria de Código — Log

Ver protocolo completo em `AUDITORIA_PROTOCOLO.md`. Status possíveis: `✅ revisado sem bug` · `🔧 corrigido` · `⚠️ pendente (precisa decisão)` · `🗑️ candidato a remoção` · `🔄 em progresso`.

## Módulo: WhatsApp

| Módulo   | Arquivo                                              | Status         | Resumo |
|----------|-------------------------------------------------------|----------------|--------|
| WhatsApp | backend/src/routes/webhook.ts                          | 🔧 corrigido | Cabeçalho desatualizado corrigido; dedup agora escopado por instancia; fromMe órfão agora loga [WEBHOOK_REJECT]; isValidJid não usado → FIX PENDENTE (risco de derrubar msgs legítimas sem teste manual) |
| WhatsApp | backend/src/routes/whatsapp.ts                          | ⚠️ pendente | getEvolutionConfig/saveEvolutionConfig nunca leem/escrevem agent_configs (webhook.ts lê de lá primeiro) → possível instância errada em send/connect/disconnect para quem só tem agent_configs; limpeza de duplicatas em /connect pode causar delete+recreate se cfg.instancia≠stableInstancia. Ambos FIX PENDENTE (decisão de produto / correlação com logs) |
| WhatsApp | backend/src/services/agentEngine.ts                     | ⚠️ pendente | Check `agentConfig?.motor_ia` nunca é true (coluna não vem no SELECT, e sem evidência de existir em agent_configs) → FIX PENDENTE (risco de coluna inexistente); demais notas são acoplamento documentado, não bugs |
| WhatsApp | backend/src/services/humanizationService.ts             | ✅ revisado sem bug | Não é usado pelo chat (só por disparoProcessor.ts); usa chave OpenAI global em vez do provider por usuário — FIX PENDENTE se isso não for intencional |
| WhatsApp | backend/src/services/whatsapp.ts                        | 🗑️ candidato a remoção | Confirmado morto (git grep sem resultado, index.ts importa routes/whatsapp) — versão antiga/limitada da rota atual |
| WhatsApp | backend/src/services/webhook.ts                         | 🗑️ candidato a remoção | Confirmado morto (git grep sem resultado, index.ts importa routes/webhook) — versão antiga/simplificada do webhook atual |
| WhatsApp | src/pages/WhatsApp.tsx                                  | ✅ revisado sem bug | Nota de nomenclatura: aba "Diagnóstico" ≠ DiagnosticoWhatsApp.tsx |
| WhatsApp | src/components/WhatsAppInterface.tsx                    | 🔧 corrigido / ⚠️ pendente | BUG SEVERO: handleSendMessage chama /api/openclaw/chat (agente admin da VPS) em vez de gerar resposta ao cliente → FIX PENDENTE (alta prioridade); aba "Meus" corrigida (misturava arquivados); menu Silenciar 8h/1sem/sempre não persistia nada → corrigido; modal "Nova Conversa" duplicado (mesmo estado de outro modal) → FIX PENDENTE |
| WhatsApp | src/services/evolutionService.ts                        | 🔧 corrigido | fetchConnectionStatus(instancia) aceitava parâmetro mas nunca usava — corrigido |
| WhatsApp | src/components/whatsapp/InstanceManagementPanel.tsx     | 🔧 corrigido / ⚠️ pendente | BUG: pollQrLoop/pollUntilConnected usavam estado (closure obsoleto) na condição do while — loop nunca rodava de verdade → corrigido com refs; targetInstancia calculado e não usado → corrigido; carregarStatus aplica 1 status a todas instâncias → FIX PENDENTE; modal "Conectar Novo WhatsApp" duplicado → FIX PENDENTE |
| WhatsApp | src/components/whatsapp/TesteInstancias.tsx             | ✅ revisado sem bug | Referência correta de status por instância |
| WhatsApp | src/pages/admin/DiagnosticoWhatsApp.tsx                 | ✅ revisado sem bug | Bug real estava no backend consumido (ver index.ts abaixo), corrigido |
| WhatsApp | src/pages/MonitorWhatsApp.tsx                           | 🔧 corrigido | BUG: fetchConversas dependia de [conversas] no useCallback mas alterava conversas — recriava o useEffect a cada fetch, virando um loop contínuo em vez de polling de 30s → corrigido com ref |
| WhatsApp | src/pages/SimuladorWebhook.tsx                          | 🔧 corrigido | BUG: URL errada (/api/webhook/evolution em vez de /webhook/evolution) — simulador sempre batia em 404 → corrigido; mensagem de ajuda do erro 401 desatualizada → corrigida |
| WhatsApp | backend/src/index.ts (lateral — só rota /api/admin/webhook-trace) | 🔧 corrigido | Filtro de dedup comparava message_id com padrão de telefone (nunca casava) → corrigido com JOIN em whatsapp_messages |
| WhatsApp | backend/src/services/migrations.ts (lateral)            | 🗑️ candidato a remoção | Duplicata não importada de backend/src/migrations.ts (só este roda, via runMigrations em index.ts) — mesmo padrão de services/*.ts morto já visto |

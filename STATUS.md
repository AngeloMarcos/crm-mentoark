# STATUS — CRM Mentoark

> Atualizado em: 2026-07-10 18:45 UTC. Este arquivo é o ponto de partida de qualquer sessão nova — ler antes de qualquer outro arquivo em `diagnosticos/`.

## Núcleo CRM

| Serviço    | Status | Detalhe                                      | Diagnóstico/Fix relacionado |
|------------|--------|-----------------------------------------------|------------------------------|
| crm-api    | 🟢 | **Corrigido e deployado (2026-07-10):** limite de payload do Express elevado de 1mb para 5mb (era `PayloadTooLargeError` com payloads do Evolution >1MB — mídia em base64 passa fácil disso). Confirmado subindo saudável em produção. | `backend/src/index.ts`, commit `edc921f` |
| crm        | 🟡 | **Achado novo (2026-07-10), não investigado ainda:** durante teste ao vivo, todas as chamadas de `/api/whatsapp/*` vindas do IP do usuário (177.143.119.69) retornaram **401** (`conversas`, `conversas/:phone`, `send`) — sessão do navegador pode ter expirado no meio do teste. Recomendação imediata: dar logout/login de novo no CRM. Se persistir, investigar em sessão futura. | — |
| postgres   | 🟢     | 14MB, saudável                                | — |
| evolution  | 🟡 | **RECONFIRMADO AO VIVO (2026-07-10):** erro Prisma `P2010` em `io.updateChatUnreadMessages` dispara a cada mensagem/atualização de status recebida, **antes** do Evolution despachar `messages.upsert` pro webhook — só `chats.update`/`contacts.update` (que não passam por esse código) chegam ao crm-api. **Esta é a causa raiz confirmada de "zero mensagens recebidas".** Documentado com comentário `[AUDITORIA]` em `backend/src/routes/webhook.ts`. Bug upstream do Evolution v2.3.7 — nenhuma correção possível no código do CRM. | `backend/src/routes/webhook.ts` (comentário `[AUDITORIA]`), `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md` |

## Observabilidade — ✅ 4 dashboards, logs/métricas saudáveis, chat WhatsApp isolado (2026-07-10)

| Serviço       | Status | Detalhe |
|---------------|--------|---------|
| grafana       | 🟢 | `grafana.mentoark.com.br`, 4 dashboards provisionados: "Mentoark - Logs dos Containers", "Node Exporter Full" (#1860), "Docker and system monitoring" (#893, métricas de host corrigidas), "WhatsApp - Envio e Recebimento" (novo, pasta própria "Chat WhatsApp") |
| loki          | 🟢 | **Confirmado ao vivo (2026-07-10):** ingestão contínua e sem gaps de crm-api/evolution nas últimas 6h (contagem por bucket de 15min sem zeros). Não houve rate-limit nem disco cheio — hipótese da Fase 1 do prompt foi descartada com evidência direta. |
| alloy         | 🟢 | Coletando logs via docker.sock; `discovery.docker` reconecta sozinho após recriação de containers (viu gaps de ~2-10min durante os redeploys de 07-08, autolimitados, não é bug) |
| prometheus    | 🟢 | v3.13.0, scrape de node-exporter + cadvisor confirmado (`targets` up) |
| node-exporter | 🟢 | v1.11.1, métricas de host confirmadas |
| cadvisor      | 🟢 | v0.60.3, métricas por container confirmadas |

## Sessão 2026-07-10 — varredura observabilidade + isolamento do painel de chat

- **Dashboard "Mentoark - Logs dos Containers"**: investigado a fundo — Loki **nunca parou** de receber logs de crm-api/evolution (verificado com `count_over_time` por bucket de 15min nas últimas 6h, sem nenhum gap). O que o usuário viu no print foi provavelmente uma aba/sessão do Grafana desatualizada (há rotação de token de sessão nos logs do Grafana às 17:01, comportamento normal mas pode gerar um blip visual no navegador) — recomendação: dar refresh forçado (Ctrl+Shift+R) na aba. Nenhuma ação de infra foi necessária aqui; **não** foram tocados `loki-config.yaml` nem reiniciado loki/alloy, porque não havia evidência de rate-limit/disco cheio (hipótese do prompt descartada).
- **Dashboard "Docker and system monitoring" (#893) com N/A em Uptime/Disk/Memory/Swap/Load — CAUSA RAIZ CONFIRMADA E CORRIGIDA:** o dashboard é da era pré-2018 do node_exporter e usa nomes de métrica antigos sem sufixo (`node_boot_time`, `node_memory_MemTotal`, `node_filesystem_free`, `node_cpu`), que não existem mais no node_exporter v1.11.1 rodando hoje (que usa `node_boot_time_seconds`, `node_memory_MemTotal_bytes`, `node_filesystem_avail_bytes`, `node_cpu_seconds_total`). Os painéis de CPU/Network/contagem de containers funcionavam porque consultam métricas do cAdvisor (`container_*`), não do node_exporter. **Fix aplicado:** `sed` em `/opt/observability/grafana/provisioning/dashboards/docker-containers.json` renomeando todas as métricas legadas para os nomes atuais (inclui a variável de template `$server`, que também usava `node_boot_time` e por isso nunca resolvia nenhuma instância). Grafana reiniciado, todos os 5 painéis validados com dado real via query direta no Prometheus (Uptime ~29.8 dias, Disk 68.9%, Memory 60.6%, Swap ~1.4GB, Load 2.89). Backup do JSON original salvo como `docker-containers.json.bak-<timestamp>` no mesmo diretório na VPS.
- **Dashboard novo "WhatsApp - Envio e Recebimento"** criado em pasta própria do Grafana ("Chat WhatsApp", `folderUid: chat-whatsapp`), isolado dos dashboards de infra. Arquivo: `/opt/observability/grafana/provisioning/dashboards-whatsapp/whatsapp-chat.json` (fora do diretório escaneado pelo provider "default" — foi necessário mover para um diretório irmão porque o provider "default" varre `dashboards/` recursivamente e "roubava" o dashboard antes do provider dedicado conseguir reivindicá-lo; erro `Cannot change resource manager` nos logs do Grafana confirmou o conflito, resolvido movendo o JSON para fora do escopo do provider default). Provider dedicado adicionado em `dashboards.yaml`. Painéis: contagem envio vs. recebimento (15min), série temporal comparativa, stream de envio (`/api/whatsapp/send`), stream de recebimento (`INSERT whatsapp_messages`, evento com `from_me=false` hardcoded no INSERT — sinal correto de mensagem genuinamente recebida), erros de webhook/mensagem do crm-api e do evolution.
- **ACHADO CRÍTICO no painel de recebimento — ponto de partida da próxima investigação:** nas últimas 72h, **zero eventos reais `eventClean:"messagesupsert"`** chegaram ao crm-api (a contagem inicial de "571 eventos" era falso-positivo — a query batia também na string do log `"IGNORADO evento não é messagesupsert"`, corrigido). Descoberto que há **duas instâncias Evolution**: `crm_5319f0ed61b3` está presa em loop de reconexão (`connectionStatus: "connecting"`, 448 eventos `qrcode.updated` em 6h — nunca pareia, mesmo problema já registrado em sessão anterior de 07-03, aparentemente nunca resolvido) e `crm_435ee4720fc3` está **conectada de verdade** (`connectionStatus: "open"`, número `5511979579548`, 1119 mensagens/22 chats/452 contatos no histórico do Evolution). Isolando os eventos só da instância conectada nas últimas 6h: apenas 9 eventos webhook no total (`contacts.update`, `chats.update/upsert`, `send.message`) — nenhum `messages.upsert`. Não dá para concluir com certeza se é porque ninguém mandou mensagem real nesse período ou se há uma falha silenciosa de encaminhamento — **não há erro logado em nenhum lugar da cadeia** (zero `ERRO INSERT whatsapp_messages`, zero `FATAL: nenhum userId`). **Próximo passo, exatamente como o prompt original pediu:** mandar uma mensagem de teste de verdade de outro número para `5511979579548` com o dashboard "WhatsApp - Envio e Recebimento" aberto e ver ao vivo se `messagesupsert`/`INSERT whatsapp_messages` aparecem.
- Instância órfã `crm_5319f0ed61b3` (nunca pareada, loop de QR) não foi removida — ação destrutiva em produção, decisão do usuário.

## Sessão 2026-07-10 (tarde) — Sprint 2: teste ao vivo de recebimento

- **PASSO 0 aplicado:** havia mudanças locais não commitadas de sessões anteriores (`AUDITORIA_PROTOCOLO.md` com 2 seções novas, `SPRINT_1_COMENTAR_CHAT_WHATSAPP.md` nunca executado) — investigadas e commitadas/preservadas antes de iniciar tarefa nova, nada foi descartado.
- **Sprint 1 nunca tinha sido executada de fato** (arquivo `SPRINT_1_COMENTAR_CHAT_WHATSAPP.md` existia só como prompt preparado, untracked, nunca rodado) — seu ground truth citado pela Sprint 2 ("payload já deve ter sido corrigido") estava **errado**: confirmado que o limite ainda era 1mb. Fix aplicado e deployado nesta sessão (ver tabela Núcleo CRM acima).
- **Tarefa A (teste ao vivo) — CONCLUÍDA, causa raiz confirmada:** mensagem real enviada de fora para `5511979579548` durante a sessão, monitorada ao vivo via `docker logs -f` em `evolution` e `crm-api` simultaneamente. Resultado: o Evolution processa a mensagem internamente e falha com `PrismaClientKnownRequestError` (P2010) dentro de `io.updateChatUnreadMessages`, repetidamente, antes de conseguir despachar o evento `messages.upsert` pro webhook. Só os eventos derivados `chats.update`/`contacts.update` (que não passam por esse código quebrado) chegam ao crm-api — nunca a mensagem em si. Isso bate exatamente com o achado já documentado na sessão de 07-08 em `AUDITORIA_LOG.md`, agora **reconfirmado ao vivo, ainda sem fix, 2 dias depois**. Não é ausência de tráfego — é um bug upstream ativo bloqueando 100% das mensagens recebidas.
- **5 arquivos laterais do módulo WhatsApp auditados** (continuação da varredura de 07-08): `integracoes.ts`/`Integracoes.tsx` (bug real corrigido — `syncEvolution()` confiava em status não verificado, causa da divergência `agent_configs` já documentada), `resilientFetch.ts` (sem bug), `Agentes.tsx` (bug documentado, `FIX PENDENTE`), `TesteConversas.tsx` (bug documentado, `FIX PENDENTE`, baixa prioridade — ferramenta DEV). Ver `AUDITORIA_LOG.md` para detalhes.

## Concluído em 2026-07-08

- **OpenClaw Admin removido por completo** do sistema (backend, frontend, rotas, menu) — confirmado que a coluna `motor_ia` não existe em produção, então nenhum agente real dependia dele. Deploy validado: JS bundle sem referência a "OpenClaw", endpoint antigo agora se comporta como qualquer rota inexistente (401 genérico do middleware de auth).
- **Limpeza de disco**: `docker builder prune -a` liberou ~9.1GB de build cache (disco 81%→62% antes de subir os 3 containers novos).

## Em standby (não mexer sem pedido explícito)

| Serviço | Status | Nota |
|---------|--------|------|
| n8n     | ⚪ | `DB_TYPE=mysqldb` inválido, caindo em SQLite silenciosamente — sinalizado, não investigado |

## Pendências abertas (ordem de prioridade)

1. **CRÍTICO — corrigir o bug upstream do Evolution (Prisma P2010) que bloqueia 100% das mensagens recebidas.** Causa raiz confirmada e reconfirmada ao vivo (ver Sprint 2 acima e comentário `[AUDITORIA]` em `backend/src/routes/webhook.ts`). Opções ainda não tentadas, decisão do usuário: (a) trocar `DATABASE_PROVIDER` de mysql pra postgresql no compose do Evolution; (b) fixar uma tag de imagem mais antiga/estável do `evoapicloud/evolution-api`; (c) reportar bug upstream no repositório do Evolution API.
2. **Achado novo — 401 em todas as chamadas `/api/whatsapp/*` do frontend durante o teste ao vivo de hoje.** Não investigado ainda. Testar se é sessão expirada (relogar) ou algo mais sério.
3. Instância Evolution `crm_5319f0ed61b3` presa em loop de reconexão há dias (nunca pareia, gera ruído constante de `qrcode.updated`) — mesmo problema aberto desde 07-03 (ver [[project_evolution_whatsapp_infra]]), aparentemente nunca resolvido. Decidir: tentar corrigir (forçar versão do Baileys) ou remover a instância órfã.
4. `backend/src/routes/integracoes.ts` — validar `status='conectado'` contra a Evolution API de verdade antes de sincronizar com `agent_configs` (mitigação parcial já aplicada no frontend, ver `AUDITORIA_LOG.md`).
5. `src/pages/Agentes.tsx` — `testarEvolution()` não testa a instância específica do agente (ver `AUDITORIA_LOG.md`).
6. Alerta WhatsApp via n8n — aguardando número de destino do usuário (`diagnosticos/PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md`)
7. n8n `DB_TYPE` inválido — investigar quando sair do standby
8. Documentos de diagnóstico ainda não absorvidos/apagados: `diagnosticos/SPRINT_1_COMENTAR_CHAT_WHATSAPP.md` propunha uma lista grande (Tarefa B) de `PROMPT_CLAUDE_CODE_*.md`/`DIAGNOSTICO_*.md` para absorver e apagar — não executado ainda, decisão de escopo em aberto (ver relatório da sessão).

## Regra para sessões futuras

Toda vez que um prompt de `diagnosticos/` for executado (diagnóstico rodado, bug corrigido, ou descartado), atualizar a tabela acima e a data no topo. Este arquivo nunca deve ficar desatualizado — se um Claude Code terminar uma tarefa e não atualizar o `STATUS.md`, a tarefa não está completa.

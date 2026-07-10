# STATUS — CRM Mentoark

> Atualizado em: 2026-07-10 17:50 UTC. Este arquivo é o ponto de partida de qualquer sessão nova — ler antes de qualquer outro arquivo em `diagnosticos/`.

## Núcleo CRM

| Serviço    | Status | Detalhe                                      | Diagnóstico/Fix relacionado |
|------------|--------|-----------------------------------------------|------------------------------|
| crm-api    | 🟡 | **Confirmado ao vivo (2026-07-08):** rejeitando payloads do Evolution acima de 1MB (`PayloadTooLargeError`, limite atual 1.048.576 bytes vs. payload de 1.391.947 bytes) — **14 ocorrências na última 1h**. Isso responde com 500 pro Evolution, que fica em retry (ver linha `evolution` abaixo). | `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (payload grande) |
| crm        | 🟢     | Sem problema conhecido                        | — |
| postgres   | 🟢     | 14MB, saudável                                | — |
| evolution  | 🟡 | **Confirmado ao vivo:** erro Prisma `P2010` ainda ocorre (5x nas últimas 2h — não foi resolvido pela troca de imagem). Além disso, `Webhook-Global` está em retry ativo agora (tentativas 3/10 a 7/10 observadas nos últimos 15min, todas com "Request failed with status code 500") — consequência direta do 413 do crm-api acima, não um problema isolado do Evolution. | `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`, `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` |

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

## Concluído em 2026-07-08

- **OpenClaw Admin removido por completo** do sistema (backend, frontend, rotas, menu) — confirmado que a coluna `motor_ia` não existe em produção, então nenhum agente real dependia dele. Deploy validado: JS bundle sem referência a "OpenClaw", endpoint antigo agora se comporta como qualquer rota inexistente (401 genérico do middleware de auth).
- **Limpeza de disco**: `docker builder prune -a` liberou ~9.1GB de build cache (disco 81%→62% antes de subir os 3 containers novos).

## Em standby (não mexer sem pedido explícito)

| Serviço | Status | Nota |
|---------|--------|------|
| n8n     | ⚪ | `DB_TYPE=mysqldb` inválido, caindo em SQLite silenciosamente — sinalizado, não investigado |

## Pendências abertas (ordem de prioridade)

1. **CRÍTICO — confirmar se mensagens recebidas de verdade chegam ao CRM.** Ver achado detalhado na sessão 2026-07-10 acima. Ação: mandar mensagem de teste de número externo para `5511979579548` (instância `crm_435ee4720fc3`, a única realmente conectada) com o novo dashboard "WhatsApp - Envio e Recebimento" (pasta "Chat WhatsApp" no Grafana) aberto, e observar se aparece em `messagesupsert`/`INSERT whatsapp_messages`.
2. Instância Evolution `crm_5319f0ed61b3` presa em loop de reconexão há dias (nunca pareia, gera ruído constante de `qrcode.updated`) — mesmo problema aberto desde 07-03 (ver [[project_evolution_whatsapp_infra]]), aparentemente nunca resolvido. Decidir: tentar corrigir (forçar versão do Baileys) ou remover a instância órfã.
3. **Webhook-Global do Evolution em retry ativo por causa do limite de payload (1MB) do crm-api** — confirmado ao vivo em 07-08. Aplicar `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (aumentar o limite do body-parser do Express no crm-api para acomodar payloads do Evolution com mídia).
4. Erro Prisma `P2010` do Evolution (`io.updateChatUnreadMessages`) continua ocorrendo — bug upstream do Evolution v2.3.7, ver `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md` para as opções de contorno já levantadas (trocar DATABASE_PROVIDER, fixar versão anterior).
5. Alerta WhatsApp via n8n — aguardando número de destino do usuário (`diagnosticos/PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md`)
6. n8n `DB_TYPE` inválido — investigar quando sair do standby

## Regra para sessões futuras

Toda vez que um prompt de `diagnosticos/` for executado (diagnóstico rodado, bug corrigido, ou descartado), atualizar a tabela acima e a data no topo. Este arquivo nunca deve ficar desatualizado — se um Claude Code terminar uma tarefa e não atualizar o `STATUS.md`, a tarefa não está completa.

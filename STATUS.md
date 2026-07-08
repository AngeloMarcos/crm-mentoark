# STATUS — CRM Mentoark

> Atualizado em: 2026-07-08 20:15 UTC. Este arquivo é o ponto de partida de qualquer sessão nova — ler antes de qualquer outro arquivo em `diagnosticos/`.

## Núcleo CRM

| Serviço    | Status | Detalhe                                      | Diagnóstico/Fix relacionado |
|------------|--------|-----------------------------------------------|------------------------------|
| crm-api    | 🟡 | **Confirmado ao vivo (2026-07-08):** rejeitando payloads do Evolution acima de 1MB (`PayloadTooLargeError`, limite atual 1.048.576 bytes vs. payload de 1.391.947 bytes) — **14 ocorrências na última 1h**. Isso responde com 500 pro Evolution, que fica em retry (ver linha `evolution` abaixo). | `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (payload grande) |
| crm        | 🟢     | Sem problema conhecido                        | — |
| postgres   | 🟢     | 14MB, saudável                                | — |
| evolution  | 🟡 | **Confirmado ao vivo:** erro Prisma `P2010` ainda ocorre (5x nas últimas 2h — não foi resolvido pela troca de imagem). Além disso, `Webhook-Global` está em retry ativo agora (tentativas 3/10 a 7/10 observadas nos últimos 15min, todas com "Request failed with status code 500") — consequência direta do 413 do crm-api acima, não um problema isolado do Evolution. | `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`, `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` |

## Observabilidade — ✅ completa (logs + métricas), 2026-07-08

| Serviço       | Status | Detalhe |
|---------------|--------|---------|
| grafana       | 🟢 | `grafana.mentoark.com.br`, 3 dashboards provisionados: "Mentoark - Logs dos Containers", "Node Exporter Full" (community #1860), "Docker Containers" (community #893) |
| loki          | 🟢 | Recebendo logs de crm-api, evolution, crm, n8n |
| alloy         | 🟢 | Coletando logs via docker.sock |
| prometheus    | 🟢 | v3.13.0, scrape de node-exporter + cadvisor confirmado (`targets` up), datasource provisionado como default |
| node-exporter | 🟢 | v1.11.1, métricas de host confirmadas (`node_memory_MemAvailable_bytes` retornando dado real) |
| cadvisor      | 🟢 | v0.60.3 (`ghcr.io/google/cadvisor` — imagem migrou de `gcr.io/cadvisor/cadvisor` a partir da v0.53.0), métricas por container confirmadas (`container_cpu_usage_seconds_total`) |

## Concluído nesta sessão (2026-07-08)

- **OpenClaw Admin removido por completo** do sistema (backend, frontend, rotas, menu) — confirmado que a coluna `motor_ia` não existe em produção, então nenhum agente real dependia dele. Deploy validado: JS bundle sem referência a "OpenClaw", endpoint antigo agora se comporta como qualquer rota inexistente (401 genérico do middleware de auth).
- **Limpeza de disco**: `docker builder prune -a` liberou ~9.1GB de build cache (disco 81%→62% antes de subir os 3 containers novos).

## Em standby (não mexer sem pedido explícito)

| Serviço | Status | Nota |
|---------|--------|------|
| n8n     | ⚪ | `DB_TYPE=mysqldb` inválido, caindo em SQLite silenciosamente — sinalizado, não investigado |

## Pendências abertas (ordem de prioridade)

1. **Webhook-Global do Evolution em retry ativo por causa do limite de payload (1MB) do crm-api** — confirmado ao vivo agora, não é suposição de sessão antiga. Aplicar `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (aumentar o limite do body-parser do Express no crm-api para acomodar payloads do Evolution com mídia).
2. Erro Prisma `P2010` do Evolution (`io.updateChatUnreadMessages`) continua ocorrendo (5x/2h) — bug upstream do Evolution v2.3.7, ver `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md` para as opções de contorno já levantadas (trocar DATABASE_PROVIDER, fixar versão anterior).
3. Alerta WhatsApp via n8n — aguardando número de destino do usuário (`diagnosticos/PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md`)
4. n8n `DB_TYPE` inválido — investigar quando sair do standby

## Regra para sessões futuras

Toda vez que um prompt de `diagnosticos/` for executado (diagnóstico rodado, bug corrigido, ou descartado), atualizar a tabela acima e a data no topo. Este arquivo nunca deve ficar desatualizado — se um Claude Code terminar uma tarefa e não atualizar o `STATUS.md`, a tarefa não está completa.

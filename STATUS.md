# STATUS — CRM Mentoark

> Atualizado em: 2026-07-08 17:03 UTC. Este arquivo é o ponto de partida de qualquer sessão nova — ler antes de qualquer outro arquivo em `diagnosticos/`.

## Núcleo CRM

| Serviço    | Status | Detalhe                                      | Diagnóstico/Fix relacionado |
|------------|--------|-----------------------------------------------|------------------------------|
| crm-api    | 🟡 | **Confirmado ao vivo (2026-07-08):** rejeitando payloads do Evolution acima de 1MB (`PayloadTooLargeError`, limite atual 1.048.576 bytes vs. payload de 1.391.947 bytes) — **14 ocorrências na última 1h**. Isso responde com 500 pro Evolution, que fica em retry (ver linha `evolution` abaixo). | `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (payload grande) |
| crm        | 🟢     | Sem problema conhecido                        | — |
| postgres   | 🟢     | 14MB, saudável                                | — |
| evolution  | 🟡 | **Confirmado ao vivo:** erro Prisma `P2010` ainda ocorre (5x nas últimas 2h — não foi resolvido pela troca de imagem). Além disso, `Webhook-Global` está em retry ativo agora (tentativas 3/10 a 7/10 observadas nos últimos 15min, todas com "Request failed with status code 500") — consequência direta do 413 do crm-api acima, não um problema isolado do Evolution. | `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`, `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` |

## Observabilidade

| Serviço | Status | Detalhe |
|---------|--------|---------|
| grafana | 🟢 | `grafana.mentoark.com.br`, dashboard "Mentoark - Logs dos Containers" ativo |
| loki    | 🟢 | Recebendo logs de crm-api, evolution, crm, n8n |
| alloy   | 🟢 | Coletando logs via docker.sock |

## Em standby (não mexer sem pedido explícito)

| Serviço | Status | Nota |
|---------|--------|------|
| n8n     | ⚪ | `DB_TYPE=mysqldb` inválido, caindo em SQLite silenciosamente — sinalizado, não investigado |

## Pendências abertas (ordem de prioridade)

1. **Webhook-Global do Evolution em retry ativo por causa do limite de payload (1MB) do crm-api** — confirmado ao vivo agora, não é suposição de sessão antiga. Aplicar `diagnosticos/PROMPT_CLAUDE_CODE_WEBHOOK_GLOBAL_E_PAYLOAD.md` (aumentar o limite do body-parser do Express no crm-api para acomodar payloads do Evolution com mídia).
2. Erro Prisma `P2010` do Evolution (`io.updateChatUnreadMessages`) continua ocorrendo (5x/2h) — bug upstream do Evolution v2.3.7, ver `diagnosticos/PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md` para as opções de contorno já levantadas (trocar DATABASE_PROVIDER, fixar versão anterior).
3. Alerta WhatsApp via n8n — aguardando número de destino do usuário (`diagnosticos/PROMPT_CLAUDE_CODE_ALERTA_WHATSAPP.md`)
4. Limpeza de disco opcional (~10GB recuperável, disco em 77% de uso / 12GB livres — sem mudança desde o último inventário) — `diagnosticos/INVENTARIO_VPS.md`
5. n8n `DB_TYPE` inválido — investigar quando sair do standby

## Regra para sessões futuras

Toda vez que um prompt de `diagnosticos/` for executado (diagnóstico rodado, bug corrigido, ou descartado), atualizar a tabela acima e a data no topo. Este arquivo nunca deve ficar desatualizado — se um Claude Code terminar uma tarefa e não atualizar o `STATUS.md`, a tarefa não está completa.

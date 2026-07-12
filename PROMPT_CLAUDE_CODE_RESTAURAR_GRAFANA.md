# Prompt para Claude Code — Restaurar Grafana (logs parados + métricas N/A) e Isolar o Painel de Chat

Cole este prompt inteiro no Claude Code (CLI). Dois problemas confirmados por print do usuário: (1) o dashboard "Mentoark - Logs dos Containers" parou de mostrar dados de `crm-api`/`evolution` (estava funcionando antes); (2) o dashboard "Docker and system monitoring" mostra N/A em quase tudo (Uptime, Disk, Memory, Swap, Load), só CPU/Network/contagem de containers aparecem. Varredura completa da stack de observabilidade, com o painel de chat (WhatsApp envio/recebimento) tratado **separado e isolado** dos demais — é o ponto mais crítico e não pode ficar misturado/perdido no meio de logs genéricos.

---

## FASE 1 — DIAGNÓSTICO: POR QUE OS LOGS PARARAM (Loki/Alloy)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'EOF'
echo "=== Containers da stack de observabilidade ==="
docker ps -a --filter "name=grafana" --filter "name=loki" --filter "name=alloy" --filter "name=prometheus" --filter "name=node-exporter" --filter "name=cadvisor" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo "=== Logs recentes do Alloy (coletor) — procurar erro de coleta ou de envio pro Loki ==="
docker logs alloy --tail 150 2>&1

echo ""
echo "=== Logs recentes do Loki — procurar erro de ingestão (rate limit, disco cheio, etc) ==="
docker logs loki --tail 150 2>&1

echo ""
echo "=== Disco do volume do Loki ==="
docker system df -v | grep -A2 loki

echo ""
echo "=== Disco geral do host ==="
df -h /
EOF
```

Hipótese mais provável (verificar, não assumir): o volume de logs gerado pelo incidente do "Webhook-Global" em loop (achado nas sessões anteriores, ~1700 erros + 3400 unknown em 15min) pode ter estourado os limites padrão de ingestão do Loki (`ingestion_rate_mb`, `ingestion_burst_size_mb`, `per_stream_rate_limit` em `loki-config.yaml`), fazendo o Loki começar a **descartar** logs silenciosamente a partir de determinado volume — o que combina com "estava funcionando e parou". Confirmar essa hipótese procurando por linhas tipo `rate limited` / `too many` / `discarding` nos logs do Loki (Passo acima). Se for isso, aumentar os limites em `loki-config.yaml` (valores generosos considerando que `evolution` já demonstrou capacidade de gerar milhares de linhas em minutos) e reiniciar o Loki.

Outras causas a descartar: Alloy caiu/reiniciou e perdeu o `discovery.docker` (container `alloy` não aparece "Up" no primeiro comando), ou disco do host/volume do Loki cheio (`df -h` no limite).

## FASE 2 — CORRIGIR E VALIDAR OS LOGS

Aplicar o fix correspondente ao que a Fase 1 confirmou (ajustar `loki-config.yaml` e/ou reiniciar `alloy`/`loki`). **Isso é reinício de serviço de infraestrutura, não de produção do CRM — pode prosseguir sem parar pra confirmação, mas avisar no relatório final.**

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/observability && docker compose restart loki alloy'
```

Validar via query direta (não só olhando o dashboard, pra ter certeza que é a fonte e não o painel):
```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker run --rm --network observability_observability curlimages/curl:latest -s -G "http://loki:3100/loki/api/v1/query_range" --data-urlencode "query={container=\"crm-api\"}" --data-urlencode "limit=3"'
```

## FASE 3 — DIAGNÓSTICO: DASHBOARD DE MÉTRICAS COM N/A

Causas mais comuns pra esse padrão específico (CPU/Network ok, Disk/Memory/Uptime/Swap/Load em N/A): (a) o dashboard importado (Node Exporter Full, ID 1860) tem uma variável de template `$node`/`$instance` que não auto-selecionou o valor certo — olhar o dropdown "Node" no topo do dashboard, se estiver vazio é isso; (b) o `node-exporter` não está rodando ou o Prometheus não está conseguindo raspar ele.

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker ps --filter "name=node-exporter" --format "table {{.Names}}\t{{.Status}}"
   docker run --rm --network observability_observability curlimages/curl:latest -s http://prometheus:9090/api/v1/targets | python3 -m json.tool | grep -A5 "node-exporter\|cadvisor"'
```

Se o `node-exporter` não aparecer como `"health":"up"` no Prometheus, investigar o `docker-compose.yml` (rede, `pid: host`, mounts). Se estiver `up` mas o dashboard continuar N/A, o problema é a variável de template do dashboard — corrigir a datasource UID e a variável `$node` no JSON provisionado (`/opt/observability/grafana/provisioning/dashboards/`) pra selecionar automaticamente a única instância existente, sem depender de seleção manual.

## FASE 4 — ISOLAR O PAINEL DE CHAT (WhatsApp envio/recebimento) — PRIORIDADE MÁXIMA, SEPARADO DE TUDO

Este é o ponto que o usuário pediu para tratar separado por ser a causa raiz mais crítica (mensagens enviadas mas não recebidas de volta pelo CRM). Criar um **dashboard próprio**, não misturado com o de logs gerais:

- Nome: `WhatsApp - Envio e Recebimento` (arquivo `whatsapp-chat.json` em `grafana/provisioning/dashboards/`, pasta/folder separada no Grafana se possível — usar `folderUid` dedicado, ex. "Chat WhatsApp", pra não ficar perdido junto com dashboards de infraestrutura).
- Painéis mínimos:
  1. Stream de **envio** — `{container="crm-api"} |~ "POST /api/whatsapp/send|WHATSAPP.*send"` (ajustar ao padrão real de log encontrado).
  2. Stream de **recebimento (webhook)** — `{container="crm-api"} |~ "WH:"`.
  3. Painel de contagem lado a lado: quantas mensagens enviadas vs. quantas recebidas nos últimos 15min — visualmente óbvio quando um lado para de mover enquanto o outro continua (é exatamente o sintoma atual: envio funcionando, recebimento não).
  4. Stream de erro do `evolution` filtrado só por linhas relacionadas a webhook/mensagem (não todo log do container).

Esse painel de recebimento vai ajudar a confirmar/aprofundar o sintoma que o usuário já relatou ("mensagens enviadas mas não recebidas pelo CRM") — depois de criado, deixar aberto e mandar uma mensagem de teste de verdade (de outro número, simulando um cliente) pra ver ao vivo se o evento de recebimento aparece ou não.

---

## AO FINALIZAR, REPORTAR

- Causa raiz confirmada dos logs parados (limite do Loki, container caído, disco cheio, ou outra).
- Causa raiz do dashboard de métricas em N/A.
- Confirmação de que os 3 dashboards (logs gerais, métricas, chat) estão mostrando dado real agora.
- Resultado do teste de mensagem recebida de fora (o painel de recebimento mostrou o evento chegando ou confirmou que não chega — isso vira o ponto de partida da próxima investigação).
- Atualizar `STATUS.md`.

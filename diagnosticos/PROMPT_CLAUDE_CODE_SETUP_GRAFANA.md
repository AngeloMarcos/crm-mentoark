# Prompt para Claude Code — Instalar Observabilidade (Grafana + Logs + Métricas) na VPS

Cole este prompt inteiro no Claude Code (CLI). Objetivo: dar visibilidade centralizada de erros e saúde de todos os containers (crm-api, crm, evolution, n8n, postgres, pgadmin) num painel só, em vez de caçar erro container por container com `docker logs`.

---

## STACK ESCOLHIDA E POR QUÊ

- **Grafana** — painel único de visualização (logs + métricas + alertas).
- **Loki** — armazena e indexa os logs de todos os containers (o que resolve diretamente o problema de ficar caçando erro em `docker logs` de container em container, como fizemos manualmente com Evolution/crm-api nas sessões anteriores).
- **Grafana Alloy** (não Promtail) — coletor de logs dos containers Docker e envia pro Loki. **Importante:** Promtail (o coletor mais usado até pouco tempo atrás) atingiu fim de vida em março/2026 — não instalar Promtail em deploy novo, usar Alloy no lugar.
- **Prometheus + node-exporter + cAdvisor** — métricas de host (CPU, RAM, disco) e por container. Ajuda a pegar coisas como a VPS ficando sem disco (o que já aconteceu no ambiente de outra ferramenta durante o projeto) antes de virar incidente.

Essa stack é 100% aditiva — não toca nos `docker-compose.yml` existentes (`crm`, `backend`, `evolution`, `n8n`). Só lê os logs/métricas de fora.

---

## FASE 0 — PRÉ-REQUISITOS

1. Confirmar espaço em disco e RAM livres antes de instalar (a stack completa consome uns 500MB-1GB de RAM ociosa):
```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'free -h && df -h /'
```
Se a VPS estiver com RAM/disco apertado, avisar o usuário antes de prosseguir — pode ser necessário reduzir escopo (só Grafana+Loki+Alloy, sem Prometheus/cAdvisor/node-exporter) ou aumentar recursos primeiro.

2. **Lembrete de DNS** (mesma regra do CLAUDE.md do projeto): criar o registro A `grafana` → `147.93.9.172` antes de subir os containers, senão o Traefik não emite certificado.

3. Verificar a versão atual/estável de cada imagem antes de fixar a tag no compose (Grafana, Loki, Alloy, Prometheus, node-exporter, cAdvisor mudam de versão com frequência — não usar `latest` sem checar, para reprodutibilidade):
```bash
# Rodar de qualquer máquina com internet, ou perguntar via docs oficiais:
# https://hub.docker.com/r/grafana/grafana/tags
# https://hub.docker.com/r/grafana/loki/tags
# https://hub.docker.com/r/grafana/alloy/tags
# https://hub.docker.com/r/prom/prometheus/tags
```

---

## FASE 1 — CRIAR A STRUCTURA EM `/opt/observability/`

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'mkdir -p /opt/observability/{loki,alloy,prometheus,grafana/provisioning/datasources}'
```

### `docker-compose.yml`

```yaml
services:
  grafana:
    image: grafana/grafana:<VERSAO_ESTAVEL_ATUAL>
    container_name: grafana
    restart: unless-stopped
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
      - GF_SERVER_ROOT_URL=https://grafana.mentoark.com.br
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    expose:
      - "3000"
    networks:
      - proxy
      - observability
    labels:
      traefik.enable: "true"
      traefik.docker.network: "proxy"
      traefik.http.routers.grafana.rule: "Host(`grafana.mentoark.com.br`)"
      traefik.http.routers.grafana.entrypoints: "websecure"
      traefik.http.routers.grafana.tls.certresolver: "letsencrypt"
      traefik.http.services.grafana.loadbalancer.server.port: "3000"

  loki:
    image: grafana/loki:<VERSAO_ESTAVEL_ATUAL>
    container_name: loki
    restart: unless-stopped
    volumes:
      - ./loki/loki-config.yaml:/etc/loki/local-config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    networks:
      - observability

  alloy:
    image: grafana/alloy:<VERSAO_ESTAVEL_ATUAL>
    container_name: alloy
    restart: unless-stopped
    volumes:
      - ./alloy/config.alloy:/etc/alloy/config.alloy
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    command: run --server.http.listen-addr=0.0.0.0:12345 /etc/alloy/config.alloy
    networks:
      - observability
    depends_on:
      - loki

  prometheus:
    image: prom/prometheus:<VERSAO_ESTAVEL_ATUAL>
    container_name: prometheus
    restart: unless-stopped
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    networks:
      - observability

  node-exporter:
    image: prom/node-exporter:<VERSAO_ESTAVEL_ATUAL>
    container_name: node-exporter
    restart: unless-stopped
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - observability

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:<VERSAO_ESTAVEL_ATUAL>
    container_name: cadvisor
    restart: unless-stopped
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    networks:
      - observability

volumes:
  grafana-data:
  loki-data:
  prometheus-data:

networks:
  proxy:
    external: true
  observability:
    driver: bridge
```

Substituir `<VERSAO_ESTAVEL_ATUAL>` em cada imagem pela versão checada na Fase 0.3. Gerar uma senha forte para `GRAFANA_ADMIN_PASSWORD` e colocar num `.env` ao lado do compose (não hardcoded, não commitar em lugar nenhum do repo do CRM — isso é infra separada, fica só na VPS em `/opt/observability/.env`).

### `loki/loki-config.yaml` (config mínima de single-node, TSDB local)

Buscar a config recomendada mais recente em https://grafana.com/docs/loki/latest/setup/install/docker/ (a config muda entre versões maiores do Loki) e adaptar para storage local em disco — não usar S3/object storage, não é necessário nesse porte.

### `alloy/config.alloy`

```
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
}

loki.source.docker "default" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

Verificar esse bloco contra a documentação atual do Alloy (`https://grafana.com/docs/alloy/latest/tutorials/send-logs-to-loki/` e `https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/`) antes de subir — a sintaxe do Alloy é relativamente nova e pode ter mudado detalhes desde o treinamento.

### `prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']
```

### `grafana/provisioning/datasources/datasources.yaml`

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: false
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Isso já deixa as duas fontes de dados prontas no Grafana sem precisar configurar manualmente na UI.

---

## FASE 2 — SUBIR OS SERVIÇOS

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/observability && docker compose up -d && docker compose ps'
```

## FASE 3 — VALIDAÇÃO

1. Abrir `https://grafana.mentoark.com.br`, logar com o usuário/senha definidos.
2. Ir em Explore → datasource Loki → query `{container="crm-api"}` — confirmar que logs do backend aparecem.
3. Repetir para `{container="evolution"}` e `{container="n8n"}`.
4. Explore → datasource Prometheus → confirmar métricas de `node-exporter` (`node_memory_MemAvailable_bytes`) e `cadvisor` (`container_cpu_usage_seconds_total`) retornando dados.

## FASE 4 — ALERTA PARA OS ERROS QUE JÁ CAÇAMOS MANUALMENTE (recomendado, não obrigatório)

Criar um alerta no Grafana (Alerting → New alert rule) usando o datasource Loki com uma query tipo:

```
count_over_time({container=~"crm-api|evolution"} |~ "PrismaClientValidationError|WEBHOOK_REJECT|uncaughtException" [5m])
```

Condição: disparar se `> 0` nos últimos 5 minutos. Configurar notificação por e-mail (`angelobispofilho@gmail.com`) via SMTP do Grafana (`GF_SMTP_*` env vars) ou webhook, à escolha — se o usuário não tiver um SMTP configurado, deixar essa etapa como `FIX PENDENTE` e perguntar antes de tentar configurar envio de e-mail.

---

## AO FINALIZAR, REPORTAR

- Versões finais de cada imagem usada.
- Confirmação de que os 3 containers de log (crm-api, evolution, n8n) aparecem no Loki.
- Confirmação de métricas de host/container no Prometheus.
- Se o alerta da Fase 4 foi criado ou ficou pendente (e por quê).
- URL final e lembrete de trocar a senha padrão se algo tiver sido deixado como placeholder.

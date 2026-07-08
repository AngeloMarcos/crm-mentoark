# Inventário da VPS (147.93.9.172) — 2026-07-08

Levantamento somente-leitura (nenhum container foi reiniciado, nenhuma imagem/volume foi removido). Objetivo: ter um retrato fiel do que roda na VPS, cruzar com o que o `CLAUDE.md` documenta, e sinalizar oportunidades de limpeza de disco para decisão do usuário.

Contexto da VPS no momento da coleta: disco `/` em 36G/50G (77% usado, 12G livres), RAM 3.8Gi total (2.5Gi usado, 1.3Gi disponível, swap 1.0Gi/2.0Gi em uso).

---

## Tabela de containers

| Container | Propósito | Status | Criticidade | Observações |
|---|---|---|---|---|
| `crm` | Frontend React/Vite do CRM (crm.mentoark.com.br) | Up 19h | **Núcleo CRM** | 2.4MiB/256MB RAM, CPU ~0%. Saudável. |
| `crm-api` | Backend Express do CRM (api.mentoark.com.br) | Up 19h | **Núcleo CRM** | 60.4MiB/320MB RAM (18.9%). Ver `AUDITORIA_LOG.md` para histórico de bugs já auditados/corrigidos nesta base. |
| `postgres` | PostgreSQL 16 + pgvector, banco `crm` | Up 3 semanas (healthy) | **Núcleo CRM** | v16.13. Banco `crm` = **14 MB** (pequeno, saudável). Volume `postgres_postgres_data` = 125.2MB no disco. |
| `evolution` | Evolution API (WhatsApp), instâncias do CRM | Up 18h | **Núcleo CRM** | v2.3.7 (mesma versão app do image antigo — o que mudou na troca de imagem foi a tag Docker, não a versão do Evolution). 124.9MiB/640MB RAM (19.5%). **0 erros Prisma (`P2010`) e 0 eventos `messages.upsert` nas últimas 2h** — sem erro novo, mas também sem tráfego de mensagem para confirmar se o bug de webhook documentado em `AUDITORIA_LOG.md`/`PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md` está de fato resolvido; precisa de um teste com mensagem real para confirmar. |
| `grafana` | Painel de observabilidade (logs) | Up 47min | Observabilidade | 344MiB/3.8GB RAM. Dashboard "Mentoark - Logs dos Containers" provisionado nesta sessão. |
| `loki` | Armazenamento/índice de logs | Up 4h | Observabilidade | 122.9MiB RAM. Recebendo logs ativamente (confirmado via `count_over_time`). |
| `alloy` | Coletor de logs Docker → Loki | Up 4h | Observabilidade | 197.2MiB RAM. ~207 mil linhas de log antigo (>7 dias) descartadas no primeiro boot (esperado, não afeta logs novos). |
| `n8n` | Automação/workflows (n8n.mentoark.com.br) | Up 3 semanas | Standby (nesta sessão) | 241.5MiB/640MB RAM (37.7%). 2 workflows encontrados: "Angelo pospect", "corretor pospect". `DB_TYPE=mysqldb` é **inválido** para n8n (só aceita `sqlite`/`postgresdb`) — n8n está caindo para SQLite silenciosamente. **Não investigado a fundo por decisão do usuário nesta sessão** — só registrado aqui. |
| `n8n_redis` | Redis sidecar do n8n | Up 3 semanas | Standby | 1.2MiB RAM. Sem necessidade de aprofundar. |
| `evolution_redis` | Redis sidecar do Evolution | Up 3 semanas | Standby | 3.9MiB RAM. Sem necessidade de aprofundar. |
| `pgadmin` | UI de administração do Postgres (pgadmin.mentoark.com.br) | Up 3 semanas | Standby | 38.7MiB/320MB RAM. Rodando normalmente. |
| `traefik` | Reverse proxy / TLS (Let's Encrypt) — roteia todos os domínios `*.mentoark.com.br` | Up 3 semanas | Standby (mas crítico para todos os domínios) | 64.9MiB/320MB RAM. Sem erros novos observados. |
| `mysql` | MySQL 8.0 compartilhado, usado pelo Evolution API | Up 3 semanas | Standby | 133.1MiB/1GB RAM. Porta 3306 exposta publicamente (`0.0.0.0:3306`) — já documentado em memória de sessões anteriores, não é novidade. |
| `portainer` | UI de administração Docker (portainer.mentoark.com.br) | Up 3 semanas | Standby | 40.5MiB/200MB RAM. Não é do projeto CRM. |
| `pdv_prod` | Outro projeto — sistema de PDV (pdv.mentoark.com.br) | Up 3 semanas | **Fora do escopo do CRM** | 1.66MiB/256MB RAM. Não documentado no `CLAUDE.md` até esta sessão — adicionado agora como "outro projeto". |
| `hemoclinic_prod` | Outro projeto — sistema Hemoclinic (hemoclinic.mentoark.com.br) | Up 3 semanas | **Fora do escopo do CRM** | 233.1MiB/640MB RAM (36.4%). Não documentado no `CLAUDE.md` até esta sessão — adicionado agora como "outro projeto". |

**Total: 16 containers encontrados** (incluindo os 3 de observabilidade criados nesta mesma sessão). Nenhum container parado foi encontrado (`docker ps -a` não trouxe nenhum container inativo).

---

## Divergências encontradas (Fase 2)

- **Documentados no CLAUDE.md e rodando normalmente:** `crm`, `crm-api`, `n8n`, `evolution`, `pgadmin` — nenhuma divergência, todos batem.
- **Rodando mas não documentados (antes desta sessão):** `grafana`/`loki`/`alloy` (instalados nesta mesma sessão, agora adicionados à tabela do CLAUDE.md), `pdv_prod`, `hemoclinic_prod`, `portainer`, `mysql`, `traefik`, `evolution_redis`, `n8n_redis`. Os três primeiros (`pdv_prod`, `hemoclinic_prod`, `portainer`) são projetos de outros clientes/serviços compartilhando a mesma VPS — não fazem parte do produto CRM, mas foram adicionados ao CLAUDE.md como nota de "não mexer sem necessidade" para evitar que uma sessão futura confunda escopo.
- **Documentado mas não encontrado rodando:** nenhum — não há divergência nesse sentido.

---

## Limpeza possível (Fase 4 — apenas sugestão, nada foi executado)

`docker system df -v` mostrou dois candidatos claros:

1. **Build cache: 7.498 GB** — cache de camadas intermediárias de builds (`docker compose build`) acumulado ao longo de várias sessões de deploy do `crm`/`crm-api`. É o maior item reclamável de longe. Comando: `docker builder prune` (ou `docker builder prune -a` para limpar tudo, incluindo cache ainda "em uso" por builds recentes).
2. **Imagens sem nenhum container usando (0 containers), ~3.3 GB somando tamanho único de cada uma:**
   - `atendai/evolution-api:latest` (1.37GB) — a imagem antiga do Evolution, substituída por `evoapicloud/evolution-api` no fix documentado em `PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`. Não é mais referenciada por nenhum container.
   - `hemoclinic-prod-hemoclinic:latest` (1.9GB únicos) — parece ser uma tag de build anterior do Hemoclinic, substituída por `prod-hemoclinic` (que é a imagem realmente em uso pelo container `hemoclinic_prod`).
   - `prod-pdv:latest` (26.9MB únicos) — mesma situação, tag anterior substituída por `pdv-prod-pdv`.
   - `node:20-alpine` (48.8MB únicos), `alpine/curl` (12MB únicos) — sobras de estágios de build.
   - `curlimages/curl:latest` (35.3MB) — puxada nesta própria sessão para testes de diagnóstico do Loki (containers temporários com `--rm`, mas a imagem em si ficou em cache).
   - `hello-world` (25.9kB) — irrelevante.

   Comando: `docker image prune -a` (remove todas as imagens sem container associado) — **ou**, mais seguro, remover manualmente só `atendai/evolution-api`, `hemoclinic-prod-hemoclinic` e `prod-pdv` com `docker rmi <imagem>`, mantendo `curlimages/curl`/`node:20-alpine`/`alpine/curl` caso ainda sejam úteis para builds futuros.
3. **Volumes:** nenhum volume órfão encontrado — os 11 volumes existentes (`docker volume ls`) estão todos vinculados a containers ativos. `docker volume prune` não encontraria nada para remover.

**Estimativa total recuperável: ~10-11 GB** (7.5GB de build cache + ~3.3GB de imagens não usadas), quase dobrando o espaço livre atual do disco (12GB → ~22GB).

---

## Recomendação de próximos passos (ordenado por prioridade)

1. **Núcleo CRM primeiro:**
   - Confirmar com um teste real de mensagem WhatsApp se o bug de `messages.upsert`/Prisma do Evolution (documentado em `AUDITORIA_LOG.md` e `PROMPT_CLAUDE_CODE_FIX_EVOLUTION_BUG.md`) está de fato resolvido — não há erro novo, mas também não há evento novo nas últimas 2h pra confirmar positivamente.
   - Decidir sobre a limpeza de disco (Fase 4) — o build cache de 7.5GB é o item de maior impacto e menor risco (não afeta nada rodando).
2. **Observabilidade:** já validada e saudável nesta sessão (`grafana`/`loki`/`alloy` rodando, dashboard funcionando) — nenhuma ação pendente.
3. **n8n por último:** inventariado apenas (2 workflows, container saudável em uso de recursos) — o problema de `DB_TYPE=mysqldb` inválido foi **registrado, não investigado**, por decisão explícita do usuário de deixar n8n em standby nesta sessão.

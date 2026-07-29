#!/bin/bash
# vps-docker-cleanup.sh — limpeza diária de build cache/imagens Docker não usadas na VPS.
#
# Por que existe: scripts/deploy.sh sempre builda com `docker compose build --no-cache` (de
# propósito — garante que nada fica em cache velho entre deploys), e a VPS hospeda vários
# projetos (crm, crm-homolog, n8n, evolution, pgadmin, grafana, mysql, pdv, hemoclinic,
# portainer — ver CLAUDE.md/INVENTARIO_VPS.md) no mesmo daemon Docker. Isso acumula cache/
# imagens dangling rápido — confirmado em 2026-07-29: disco foi de 83% a 91% em poucos deploys
# na mesma sessão, e já tinha causado um SIGBUS (provável OOM) no meio de um build por falta de
# memória/disco.
#
# Escopo — só remove o que é seguro remover:
#   - `docker builder prune -f`: cache de build não usado. Como todo build daqui é --no-cache,
#     esse cache nunca é reaproveitado mesmo — remover não deixa nenhum deploy futuro mais lento.
#   - `docker image prune -f` (SEM -a): só imagens dangling (sem tag) — nunca remove uma imagem
#     que algum container ainda usa, nem imagens tageadas "paradas" que alguém possa querer para
#     rollback manual.
#   - NUNCA toca containers rodando, volumes, ou o Postgres/dados de nenhum projeto.
#
# Instalado via crontab (root) na VPS:
#   0 4 * * * /opt/docker_cleanup.sh >> /opt/docker_cleanup.log 2>&1
# (04h, 1h depois do backup do Postgres às 03h — ver crontab -l — pra não competir por I/O)

set -euo pipefail

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) — iniciando limpeza Docker ==="
echo "--- disco antes ---"
df -h /

docker builder prune -f
docker image prune -f

echo "--- disco depois ---"
df -h /
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) — limpeza concluída ==="
echo ""

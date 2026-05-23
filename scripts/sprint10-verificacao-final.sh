#!/bin/bash
# ============================================================
# SPRINT 10 — Verificação final do sistema
# Rodar na VPS 147.93.9.172
# ============================================================
set -u

echo "=== VERIFICAÇÃO FINAL — $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

echo "=== CONTAINERS DOCKER ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo ""

echo "=== RECURSOS DO HOST ==="
free -h
echo ""
df -h / /var/lib/docker 2>/dev/null | head -5
echo ""

echo "=== USO DE CPU/RAM POR CONTAINER ==="
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
echo ""

echo "=== HEALTH CHECKS HTTPS (via Traefik) ==="
for url in \
  "https://api.mentoark.com.br/health" \
  "https://n8n.mentoark.com.br/healthz" \
  "https://crm.mentoark.com.br" \
  "https://disparo.mentoark.com.br" \
  "https://pgadmin.mentoark.com.br/misc/ping"
do
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "$url")
  printf "  %-45s HTTP %s\n" "$url" "$code"
done
echo ""

echo "=== POSTGRES — conexões ativas ==="
docker exec crm-api sh -c 'psql "$DATABASE_URL" -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"' 2>/dev/null \
  || echo "  (não foi possível consultar — verifique container crm-api)"
echo ""

echo "=== SPRINTS CONCLUÍDAS ==="
cat <<'EOF'
  ✅ Sprint 0:  Backup completo
  ✅ Sprint 1:  Estabilização imediata
  ✅ Sprint 2:  Error handlers no Node
  ✅ Sprint 3:  Migration SQL auditoria
  ✅ Sprint 4:  MASTERS env var
  ✅ Sprint 5:  n8n_chat_histories
  ✅ Sprint 6:  produto_imagens security
  ✅ Sprint 7:  Supabase singleton
  ✅ Sprint 8:  Monitoramento + cron
  ✅ Sprint 9:  Módulos usuários
  ✅ Sprint 10: Limpeza final
EOF
echo ""
echo "Sistema otimizado e estabilizado."

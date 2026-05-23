#!/bin/bash
# ============================================================
# MONITOR CRM — roda a cada 5 minutos via cron
# Adaptado para stack Docker Compose (sem PM2)
# Containers monitorados: crm, crm-api, n8n, evolution, pgadmin
# ============================================================

LOG_FILE="/root/monitor-crm.log"
ALERT_FILE="/tmp/crm-alerta.txt"
DATA=$(date '+%Y-%m-%d %H:%M:%S')

CONTAINERS=("crm" "crm-api" "n8n" "evolution" "pgadmin")
HEALTH_URL="https://api.mentoark.com.br/health"

rm -f "$ALERT_FILE"
log() { echo "[$DATA] $1" >> "$LOG_FILE"; }
alert() { echo "$1" >> "$ALERT_FILE"; }

# --- RAM ---
MEM_LIVRE=$(free -m | awk 'NR==2{print $7}')
MEM_TOTAL=$(free -m | awk 'NR==2{print $2}')
MEM_PCT=$(( (MEM_TOTAL - MEM_LIVRE) * 100 / MEM_TOTAL ))
log "RAM: ${MEM_PCT}% usada (${MEM_LIVRE}MB livre de ${MEM_TOTAL}MB)"
[ "$MEM_PCT" -gt 90 ] && alert "⚠️  RAM CRÍTICA: ${MEM_PCT}% usada (${MEM_LIVRE}MB livre)"

# --- CPU ---
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1)
log "CPU: ${CPU:-0}%"
[ "${CPU:-0}" -gt 90 ] && alert "⚠️  CPU CRÍTICO: ${CPU}%"

# --- DISCO ---
DISCO=$(df / | tail -1 | awk '{print $5}' | tr -d %)
log "Disco /: ${DISCO}%"
[ "$DISCO" -gt 90 ] && alert "⚠️  DISCO CRÍTICO: ${DISCO}%"

# --- DOCKER: status dos containers ---
if ! command -v docker >/dev/null 2>&1; then
  log "❌ docker não encontrado no PATH"
  alert "⚠️  Docker não disponível"
else
  for c in "${CONTAINERS[@]}"; do
    STATUS=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "missing")
    RESTARTS=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo "0")
    HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo "none")
    log "Container ${c}: status=${STATUS} restarts=${RESTARTS} health=${HEALTH}"

    case "$STATUS" in
      running) ;;
      missing) alert "⚠️  Container ${c} NÃO EXISTE" ;;
      *)       alert "⚠️  Container ${c} fora do ar: status=${STATUS}" ;;
    esac

    [ "$HEALTH" = "unhealthy" ] && alert "⚠️  Container ${c} unhealthy"
    [ "${RESTARTS:-0}" -gt 10 ] && alert "⚠️  Container ${c} com ${RESTARTS} restarts"
  done
fi

# --- BACKEND HEALTH (via Traefik) ---
HTTP=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
log "Backend ${HEALTH_URL}: HTTP $HTTP"
[ "$HTTP" != "200" ] && alert "⚠️  BACKEND DOWN: HTTP $HTTP em $HEALTH_URL"

# --- POSTGRES (via container crm-api) ---
if command -v docker >/dev/null 2>&1; then
  PG_OK=$(docker exec crm-api sh -c 'echo "SELECT 1" | psql "$DATABASE_URL" -tA 2>/dev/null' 2>/dev/null | tr -d '[:space:]')
  if [ "$PG_OK" = "1" ]; then
    log "Postgres: OK"
  else
    log "Postgres: FALHA na conexão"
    alert "⚠️  Postgres inacessível pelo backend"
  fi
fi

# --- ALERTA ---
if [ -s "$ALERT_FILE" ]; then
  log "⚠️  ALERTAS DETECTADOS:"
  sed 's/^/    /' "$ALERT_FILE" >> "$LOG_FILE"
  echo ""
  echo "=== ALERTAS CRM $(date) ==="
  cat "$ALERT_FILE"
fi

# Mantém apenas últimas 2000 linhas do log
tail -2000 "$LOG_FILE" > "${LOG_FILE}.tmp" 2>/dev/null && mv "${LOG_FILE}.tmp" "$LOG_FILE"

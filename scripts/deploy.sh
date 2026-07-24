#!/usr/bin/env bash
# scripts/deploy.sh — única fonte de verdade para deploy manual (scp direto, sem git pull
# na VPS — nem /opt/crm nem /opt/crm-homolog são clones git limpos, ver CLAUDE.md/STATUS.md).
#
# Por que este script existe: um deploy pra homologação foi sugerido apontando pro diretório
# de PRODUÇÃO (/opt/crm em vez de /opt/crm-homolog) com um comando `git pull` que teria
# conflitado de qualquer forma — porque essa informação só existia espalhada em memória/
# comentários, nunca num lugar único e à prova de erro. Este script é esse lugar único.
#
# Uso:
#   scripts/deploy.sh homolog backend/src/routes/webhook.ts backend/src/utils/vision.ts
#   scripts/deploy.sh prod --confirm backend/src/routes/webhook.ts
#
# Regras:
#   - target "prod" exige --confirm explícito (em qualquer posição), senão recusa rodar.
#   - roda o build local (backend e/ou frontend, conforme os arquivos passados) ANTES de
#     copiar qualquer coisa — nunca envia código que nem compila localmente.
#   - só reconstrói o(s) serviço(s) Docker realmente afetado(s) pelos arquivos passados.
#   - depois do rebuild, valida automaticamente: curl no /health e nas últimas linhas de log
#     procurando por ERROR — deploy "silenciosamente quebrado" vira erro visível na hora.
set -euo pipefail

VPS_HOST="147.93.9.172"
VPS_USER="root"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TARGET="${1:-}"
shift || true

if [[ "$TARGET" != "homolog" && "$TARGET" != "prod" ]]; then
  echo "Uso: scripts/deploy.sh {homolog|prod} [--confirm] <arquivo1> [arquivo2 ...]"
  echo "  Ex: scripts/deploy.sh homolog backend/src/routes/webhook.ts"
  exit 1
fi

CONFIRM=false
FILES=()
for arg in "$@"; do
  if [[ "$arg" == "--confirm" ]]; then
    CONFIRM=true
  else
    FILES+=("$arg")
  fi
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Nenhum arquivo passado. Nada a fazer."
  exit 1
fi

if [[ "$TARGET" == "prod" && "$CONFIRM" != "true" ]]; then
  echo "🛑 RECUSADO: target 'prod' exige a flag --confirm explícita."
  echo "   Isso é proposital — deploy em produção não deve ser um acidente de copy/paste."
  echo "   Se é isso mesmo que você quer: scripts/deploy.sh prod --confirm ${FILES[*]}"
  exit 1
fi

if [[ "$TARGET" == "homolog" ]]; then
  REMOTE_BASE="/opt/crm-homolog"
  BACKEND_SERVICE="crm-api-homolog"
  FRONTEND_SERVICE="crm-homolog"
  HEALTH_URL="https://api-homolog.mentoark.com.br/health"
  FRONTEND_URL="https://homolog.mentoark.com.br/"
else
  REMOTE_BASE="/opt/crm"
  BACKEND_SERVICE="crm-api"
  FRONTEND_SERVICE="crm"
  HEALTH_URL="https://api.mentoark.com.br/health"
  FRONTEND_URL="https://crm.mentoark.com.br/"
  echo "⚠️  ALVO: PRODUÇÃO (${REMOTE_BASE}) — ${#FILES[@]} arquivo(s)."
fi

TOCA_BACKEND=false
TOCA_FRONTEND=false
for f in "${FILES[@]}"; do
  if [[ ! -f "$REPO_ROOT/$f" ]]; then
    echo "🛑 Arquivo não existe localmente: $f"
    exit 1
  fi
  if [[ "$f" == backend/* ]]; then TOCA_BACKEND=true; else TOCA_FRONTEND=true; fi
done

echo "── Passo 1/4 — build local (gate: não copia nada se não compilar) ──"
if [[ "$TOCA_BACKEND" == "true" ]]; then
  (cd "$REPO_ROOT/backend" && npm run build)
fi
if [[ "$TOCA_FRONTEND" == "true" ]]; then
  (cd "$REPO_ROOT" && npm run build)
fi
echo "✅ Build local OK"

echo "── Passo 2/4 — copiando ${#FILES[@]} arquivo(s) para $TARGET ($REMOTE_BASE) ──"
for f in "${FILES[@]}"; do
  remote_path="$REMOTE_BASE/$f"
  remote_dir="$(dirname "$remote_path")"
  ssh "${VPS_USER}@${VPS_HOST}" "mkdir -p '$remote_dir'"
  scp "$REPO_ROOT/$f" "${VPS_USER}@${VPS_HOST}:$remote_path"
  echo "  📤 $f → $remote_path"
done

echo "── Passo 3/4 — rebuild dos serviços afetados ──"
if [[ "$TOCA_BACKEND" == "true" ]]; then
  echo "  🏗️  $BACKEND_SERVICE"
  ssh "${VPS_USER}@${VPS_HOST}" "cd $REMOTE_BASE/backend && docker compose build --no-cache $BACKEND_SERVICE && docker compose up -d $BACKEND_SERVICE"
fi
if [[ "$TOCA_FRONTEND" == "true" ]]; then
  echo "  🏗️  $FRONTEND_SERVICE"
  ssh "${VPS_USER}@${VPS_HOST}" "cd $REMOTE_BASE && docker compose build --no-cache $FRONTEND_SERVICE && docker compose up -d $FRONTEND_SERVICE"
fi

echo "── Passo 4/4 — validação automática pós-deploy ──"
sleep 3
if [[ "$TOCA_BACKEND" == "true" ]]; then
  status=$(ssh "${VPS_USER}@${VPS_HOST}" "curl -s -o /dev/null -w '%{http_code}' '$HEALTH_URL'" || echo "000")
  if [[ "$status" == "200" ]]; then
    echo "  ✅ $HEALTH_URL → 200"
  else
    echo "  🔴 $HEALTH_URL → $status (ESPERADO 200 — investigar antes de considerar concluído)"
  fi
  echo "  📋 últimas linhas de log de $BACKEND_SERVICE (procurando ERROR):"
  ssh "${VPS_USER}@${VPS_HOST}" "docker logs $BACKEND_SERVICE --tail 30 2>&1 | grep -i error || echo '     (nenhum ERROR nas últimas 30 linhas)'"
fi
if [[ "$TOCA_FRONTEND" == "true" ]]; then
  status=$(ssh "${VPS_USER}@${VPS_HOST}" "curl -s -o /dev/null -w '%{http_code}' '$FRONTEND_URL'" || echo "000")
  if [[ "$status" == "200" ]]; then
    echo "  ✅ $FRONTEND_URL → 200"
  else
    echo "  🔴 $FRONTEND_URL → $status (ESPERADO 200 — investigar antes de considerar concluído)"
  fi
fi

echo ""
echo "✅ Deploy em '$TARGET' concluído — ${#FILES[@]} arquivo(s), $(date -u +%Y-%m-%dT%H:%M:%SZ)"

#!/bin/bash
# Deploy das correções do OpenClaw Admin
# Execute em WSL, Git Bash ou terminal Linux

VPS="root@147.93.9.172"
PASS="Mentoark@2025"
SSH="sshpass -p '$PASS' ssh -o StrictHostKeyChecking=no"
SCP="sshpass -p '$PASS' scp -o StrictHostKeyChecking=no"

echo "=== Deploy OpenClaw Fix ==="

# 1. Enviar backend corrigido
echo ">> Enviando openclaw.ts..."
$SCP backend/src/routes/openclaw.ts $VPS:/opt/crm/backend/src/routes/openclaw.ts

# 2. Enviar frontend corrigido
echo ">> Enviando OpenClaw.tsx..."
$SCP src/pages/OpenClaw.tsx $VPS:/opt/crm/src/pages/OpenClaw.tsx

# 3. Rebuildar backend
echo ">> Rebuilding backend..."
$SSH $VPS 'cd /opt/crm/backend && docker compose build --no-cache crm-api && docker compose up -d crm-api'

# 4. Rebuildar frontend
echo ">> Rebuilding frontend..."
$SSH $VPS 'cd /opt/crm && docker compose build --no-cache crm && docker compose up -d crm'

echo "=== Deploy concluído ==="

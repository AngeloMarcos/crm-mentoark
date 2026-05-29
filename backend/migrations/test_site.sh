#!/bin/bash
sleep 3
echo "=== Status dos containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}" | grep crm

echo ""
echo "=== Teste HTTP ==="
curl -s -o /dev/null -w "crm.mentoark.com.br: HTTP %{http_code}\n" https://crm.mentoark.com.br/login
curl -s -o /dev/null -w "api.mentoark.com.br: HTTP %{http_code}\n" https://api.mentoark.com.br/health

echo ""
echo "=== Resposta da API ==="
curl -s https://api.mentoark.com.br/health

#!/bin/bash
echo "=== CONTAINERS ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
echo ""
echo "=== LOG CRM (frontend) ==="
docker logs crm --tail 20 2>&1
echo ""
echo "=== LOG CRM-API (backend) ==="
docker logs crm-api --tail 10 2>&1
echo ""
echo "=== CURL frontend ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://crm.mentoark.com.br
echo "=== CURL backend ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://api.mentoark.com.br/health

#!/bin/bash
echo "======= CONTAINERS ======="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "======= NGINX CONFIG ======="
docker exec crm cat /etc/nginx/conf.d/default.conf 2>/dev/null || echo "sem config"

echo ""
echo "======= FRONTEND index.html ======="
docker exec crm curl -s http://localhost/ | head -20

echo ""
echo "======= ASSETS DISPONIVEIS ======="
docker exec crm ls /usr/share/nginx/html/assets/ 2>/dev/null | head -10

echo ""
echo "======= LOG CRM (ultimas 30 linhas) ======="
docker logs crm --tail 30 2>&1

echo ""
echo "======= LOG CRM-API (ultimas 30 linhas) ======="
docker logs crm-api --tail 30 2>&1

echo ""
echo "======= CURL FRONTEND ======="
curl -s -o /dev/null -w "Status: %{http_code}\n" https://crm.mentoark.com.br

echo ""
echo "======= CURL BACKEND /health ======="
curl -s https://api.mentoark.com.br/health

echo ""
echo "======= TRAEFIK ROTAS ======="
docker exec traefik traefik version 2>/dev/null | head -2

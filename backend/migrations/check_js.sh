#!/bin/bash
echo "=== Index.html (completo) ==="
docker exec crm cat /usr/share/nginx/html/index.html

echo ""
echo "=== Tamanho do bundle JS ==="
docker exec crm ls -lh /usr/share/nginx/html/assets/

echo ""
echo "=== Primeiras 5 linhas do JS (erros obvios) ==="
docker exec crm sh -c "head -c 500 /usr/share/nginx/html/assets/*.js"

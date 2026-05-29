#!/bin/bash
echo "=== Verificar VITE_API_URL embutido no bundle ==="
docker exec crm sh -c "grep -o 'api\.mentoark\.com\.br' /usr/share/nginx/html/assets/*.js | head -3"

echo ""
echo "=== Verificar se ha erros de React no bundle ==="
docker exec crm sh -c "grep -c 'ReactDOM\|createRoot\|root' /usr/share/nginx/html/assets/*.js"

echo ""
echo "=== Ultimo acesso no nginx ==="
docker logs crm --tail 5 2>&1 | grep -v "^/" || docker logs crm 2>&1 | tail -5

echo ""
echo "=== Build atual - data ==="
docker exec crm sh -c "ls -la /usr/share/nginx/html/assets/"

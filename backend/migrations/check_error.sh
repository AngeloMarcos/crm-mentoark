#!/bin/bash
echo "=== CURL completo da pagina ==="
curl -s https://crm.mentoark.com.br/login | head -5

echo ""
echo "=== Verificar se JS carrega sem erro de sintaxe ==="
docker exec crm node -e "
try {
  require('fs').readFileSync('/usr/share/nginx/html/assets/index-2t6KPjg_.js', 'utf8');
  console.log('ARQUIVO OK - pode ser lido');
} catch(e) {
  console.log('ERRO:', e.message);
}
" 2>/dev/null || echo "node nao disponivel no container"

echo ""
echo "=== Verificar VITE_API_URL no bundle ==="
docker exec crm sh -c "grep -o 'VITE_API_URL\|api\.mentoark\|localhost:3000' /usr/share/nginx/html/assets/*.js | head -5" 2>/dev/null

echo ""
echo "=== Checar se supabase ainda e referenciado ==="
docker exec crm sh -c "grep -c 'supabase' /usr/share/nginx/html/assets/*.js" 2>/dev/null

echo ""
echo "=== Checar erros de import no bundle (undefined/null) ==="
docker exec crm sh -c "grep -o 'Cannot find module\|is not defined\|unexpected token' /usr/share/nginx/html/assets/*.js | head -5" 2>/dev/null || echo "nenhum erro de import encontrado no bundle"

echo ""
echo "=== Verificar se o container crm esta realmente servindo ==="
docker exec crm wget -q -O- http://localhost/ 2>/dev/null | head -3

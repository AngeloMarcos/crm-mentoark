#!/bin/bash
echo "=== Login.tsx no VPS ==="
grep -n "hasTurnstile\|turnstileToken\|VITE_TURNSTILE" /opt/crm/src/pages/Login.tsx | head -10

echo ""
echo "=== Bundle: turnstile ==="
docker exec crm sh -c "grep -o 'hasTurnstile\|VITE_TURNSTILE\|bypass\|turnstileToken' /usr/share/nginx/html/assets/*.js | head -5" 2>/dev/null

echo ""
echo "=== Bundle: botao desabilitado ==="
docker exec crm sh -c "grep -o 'disabled.*turnstile\|turnstile.*disabled' /usr/share/nginx/html/assets/*.js | head -3" 2>/dev/null

echo ""
echo "=== Checar console errors via wget ==="
wget -q -O- https://crm.mentoark.com.br/login 2>&1 | head -3

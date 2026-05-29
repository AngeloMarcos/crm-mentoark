#!/bin/bash
echo "=== VITE_API_URL no bundle ==="
grep -o "api\.mentoark\.com\.br" /usr/share/nginx/html/assets/index-*.js | head -3

echo ""
echo "=== React createRoot presente ==="
grep -c "createRoot" /usr/share/nginx/html/assets/index-*.js

echo ""
echo "=== Data do build ==="
ls -la /usr/share/nginx/html/assets/index-*.js

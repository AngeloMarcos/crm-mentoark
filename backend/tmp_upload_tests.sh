#!/bin/bash
TOKEN="$1"

echo '=== COMANDO 3.1: Upload PDF ==='
echo '%PDF-1.4 1 0 obj << /Type /Catalog >> endobj' > /tmp/teste.pdf
curl -s -X POST "https://api.mentoark.com.br/api/galeria/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "imagens=@/tmp/teste.pdf;type=application/pdf" \
  -F 'tags=["teste","pdf"]'

echo ''
echo '=== COMANDO 3.2: Upload MP3 ==='
printf '\xff\xfb\x90\x00\x00\x00\x00\x00' > /tmp/teste.mp3
curl -s -X POST "https://api.mentoark.com.br/api/galeria/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "imagens=@/tmp/teste.mp3;type=audio/mpeg" \
  -F 'tags=["teste","audio"]'

echo ''
echo '=== COMANDO 3.3: Upload .txt - deve ser bloqueado ==='
echo 'test content' > /tmp/teste.txt
BODY=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "https://api.mentoark.com.br/api/galeria/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "imagens=@/tmp/teste.txt")
echo "$BODY"

echo ''
echo '=== SEÇÃO 4: Logs container crm-api (25 linhas) ==='
docker logs crm-api --tail 25 2>&1

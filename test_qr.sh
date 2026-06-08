#!/bin/bash
EVO_KEY="mentoark2025evolutionkey"
EVO_URL="https://disparo.mentoark.com.br"
INST="crm_435ee4720fc3"

echo "=== 1. Estado atual ==="
curl -s "$EVO_URL/instance/connectionState/$INST" -H "apikey: $EVO_KEY"
echo ""

echo "=== 2. GET /instance/connect ==="
curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY"
echo ""

echo "=== 3. Restart instância ==="
curl -s -X PUT "$EVO_URL/instance/restart/$INST" -H "apikey: $EVO_KEY"
echo ""

sleep 3

echo "=== 4. Estado após restart ==="
curl -s "$EVO_URL/instance/connectionState/$INST" -H "apikey: $EVO_KEY"
echo ""

echo "=== 5. GET /instance/connect após restart ==="
curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY"
echo ""

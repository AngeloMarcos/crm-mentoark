#!/bin/bash
API_KEY=$(grep "^EVOLUTION_API_KEY" /opt/crm/backend/.env | cut -d= -f2)
EVO_URL="https://disparo.mentoark.com.br"
INSTANCES=("crm_435ee4720fc3" "crm_5319f0ed61b3")

for INSTANCE in "${INSTANCES[@]}"; do
  STATE=$(curl -s -H "apikey: $API_KEY" \
    "$EVO_URL/instance/connectionState/$INSTANCE" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('instance',{}).get('state', d.get('state','not_found')))" 2>/dev/null)

  echo "[$(date)] $INSTANCE: $STATE"

  if [[ "$STATE" == "not_found" || "$STATE" == "null" || -z "$STATE" ]]; then
    echo "[$(date)] $INSTANCE nao existe -- recriando..."
    curl -s -X POST "$EVO_URL/instance/create" \
      -H "Content-Type: application/json" \
      -H "apikey: $API_KEY" \
      -d "{\"instanceName\":\"$INSTANCE\",\"qrcode\":false,\"integration\":\"WHATSAPP-BAILEYS\"}" > /dev/null
    echo "[$(date)] $INSTANCE recriada -- necessario escanear QR"
  elif [[ "$STATE" == "close" || "$STATE" == "connecting" ]]; then
    echo "[$(date)] $INSTANCE desconectada -- tentando reconectar..."
    curl -s -X GET "$EVO_URL/instance/connect/$INSTANCE" \
      -H "apikey: $API_KEY" > /dev/null
  fi
done
#!/bin/bash
EVO_KEY="mentoark2025evolutionkey"
EVO_URL="https://disparo.mentoark.com.br"
for INST in crm_435ee4720fc3 crm_5319f0ed61b3; do
  echo -n "$INST: "
  curl -s "$EVO_URL/instance/connectionState/$INST" -H "apikey: $EVO_KEY"
  echo ""
done

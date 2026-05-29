#!/bin/bash
echo "=== Certificado SSL ==="
echo | openssl s_client -connect crm.mentoark.com.br:443 -servername crm.mentoark.com.br 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo "nao foi possivel checar SSL"

echo ""
echo "=== Traefik logs ultimas 10 linhas ==="
docker logs traefik --tail 10 2>&1

echo ""
echo "=== Teste direto no nginx (sem Traefik) ==="
docker inspect crm --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | while read IP; do
  echo "IP do container crm: $IP"
  curl -s -o /dev/null -w "HTTP: %{http_code}\n" "http://$IP/"
done

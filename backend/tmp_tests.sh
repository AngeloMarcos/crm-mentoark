TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWI3YzNmMS0wMjE3LTRhYTAtOGYzYi1kNDk5ZGNkZGNjZGQiLCJlbWFpbCI6ImFuZ2Vsb2Jpc3BvZmlsaG9AZ21haWwuY29tIiwicm9sZSI6ImFkbWluIiwiZGlzcGxheV9uYW1lIjoiQW5nZWxvIE1hcmNvcyIsImlhdCI6MTc3OTE0MzY1OSwiZXhwIjoxNzc5MTQ3MjU5fQ.MdGzmSaXhPAhcMaY4j0poheBx6dB5n9CCE6SjflV2aw

echo '=== COMANDO 3.1: Upload PDF ==='
echo '%PDF-1.4 1 0 obj << /Type /Catalog >> endobj' > /tmp/teste.pdf
curl -s -X POST "https://api.mentoark.com.br/api/galeria/upload" \
  -H "Authorization: Bearer \eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWI3YzNmMS0wMjE3LTRhYTAtOGYzYi1kNDk5ZGNkZGNjZGQiLCJlbWFpbCI6ImFuZ2Vsb2Jpc3BvZmlsaG9AZ21haWwuY29tIiwicm9sZSI6ImFkbWluIiwiZGlzcGxheV9uYW1lIjoiQW5nZWxvIE1hcmNvcyIsImlhdCI6MTc3OTE0MzY1OSwiZXhwIjoxNzc5MTQ3MjU5fQ.MdGzmSaXhPAhcMaY4j0poheBx6dB5n9CCE6SjflV2aw" \
  -F "imagens=@/tmp/teste.pdf;type=application/pdf" \
  -F 'tags=["teste","pdf"]'

echo ''
echo '=== COMANDO 3.2: Upload MP3 ==='
printf '\xff\xfb\x90\x00\x00\x00\x00\x00' > /tmp/teste.mp3
curl -s -X POST "https://api.mentoark.com.br/api/galeria/upload" \
  -H "Authorization: Bearer \eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWI3YzNmMS0wMjE3LTRhYTAtOGYzYi1kNDk5ZGNkZGNjZGQiLCJlbWFpbCI6ImFuZ2Vsb2Jpc3BvZmlsaG9AZ21haWwuY29tIiwicm9sZSI6ImFkbWluIiwiZGlzcGxheV9uYW1lIjoiQW5nZWxvIE1hcmNvcyIsImlhdCI6MTc3OTE0MzY1OSwiZXhwIjoxNzc5MTQ3MjU5fQ.MdGzmSaXhPAhcMaY4j0poheBx6dB5n9CCE6SjflV2aw" \
  -F "imagens=@/tmp/teste.mp3;type=audio/mpeg" \
  -F 'tags=["teste","audio"]'

echo ''
echo '=== COMANDO 3.3: Upload .txt (deve ser bloqueado) ==='
echo 'test content' > /tmp/teste.txt
STATUS=\
echo "HTTP_STATUS: \"

echo ''
echo '=== SEÇÃO 4: Logs do container crm-api (ultimas 25 linhas) ==='
docker logs crm-api --tail 25 2>&1

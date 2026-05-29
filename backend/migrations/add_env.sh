#!/bin/bash
ENV_FILE="/opt/crm/backend/.env"
grep -q "^BACKEND_URL=" "$ENV_FILE" || echo "BACKEND_URL=https://api.mentoark.com.br" >> "$ENV_FILE"
grep -q "^N8N_WEBHOOK_SECRET=" "$ENV_FILE" || echo "N8N_WEBHOOK_SECRET=mentoark-kanban-secret-2025" >> "$ENV_FILE"
grep -q "^ENCRYPTION_KEY=" "$ENV_FILE" || node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))" >> "$ENV_FILE"
echo "--- .env atualizado ---"
grep -E "^(BACKEND_URL|N8N_WEBHOOK_SECRET|ENCRYPTION_KEY|OPENAI_API_KEY|OPENAI_MODEL)=" "$ENV_FILE"

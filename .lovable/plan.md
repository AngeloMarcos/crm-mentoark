## Diagnóstico

Verifiquei o estado real agora:

- Evolution tem 3 instâncias. A ativa é `crm_65aba552` (recém-conectada, **4060 mensagens / 302 chats**, número Mentoark).
- **Webhook está `null`** nas 3 instâncias → Evolution não tem para onde mandar mensagens novas.
- Banco: agente "teste" do user mentoark **continua com `evolution_instancia` vazio** e `whatsapp_messages` = 0.
- A causa raiz é simples: no último deploy o arquivo `backend/src/routes/whatsapp.ts` **não foi enviado** (sua lista incluía contatos/modulos/usuarios/n8n, mas não whatsapp.ts). Portanto a VPS ainda roda a versão antiga, que não chama `registrarWebhook` nem `saveEvolutionConfig` ao conectar.

## Plano para destravar o fluxo WhatsApp/conversas

### 1. Deploy do `whatsapp.ts` já corrigido
O arquivo no repositório local já tem `registrarWebhook` + `saveEvolutionConfig` chamados em todos os caminhos de `/connect`. Basta copiar e rebuildar:

```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/routes/whatsapp.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/whatsapp.ts

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

A partir daí, toda nova conexão registra webhook + vincula instância ao agente automaticamente.

### 2. Cura imediata da instância já conectada (`crm_65aba552`)
A instância já está `open` mas órfã. Rodar uma vez:

**a) Registrar webhook na Evolution:**
```bash
curl -X POST https://disparo.mentoark.com.br/webhook/set/crm_65aba552 \
  -H "apikey: mentoark2025evolutionkey" \
  -H "Content-Type: application/json" \
  -d '{"webhook":{"url":"https://api.mentoark.com.br/webhook/evolution","enabled":true,"byEvents":false,"base64":true,"events":["MESSAGES_UPSERT","CONNECTION_UPDATE","QRCODE_UPDATED"]}}'
```

**b) Vincular instância ao agente do user mentoark:**
```bash
docker exec -i $(docker ps -qf name=postgres) psql -U mentoark -d crm -c \
  "UPDATE agentes SET evolution_instancia='crm_65aba552', evolution_server_url='https://disparo.mentoark.com.br', evolution_api_key='mentoark2025evolutionkey' WHERE user_id='65aba552-7d7e-4bd5-8017-6d0679d48cf1';"
```

Depois disso, qualquer mensagem nova chegando no WhatsApp Mentoark cai em `whatsapp_messages` em ~5s e aparece em `/whatsapp` no CRM.

### 3. Backfill das 4060 mensagens históricas (opcional)
A Evolution já tem 4060 mensagens e 302 chats armazenados, mas o CRM começa vazio. Para ver o histórico, crio um endpoint admin `POST /api/whatsapp/sync-history` que:

- Chama `GET /chat/findChats/{instancia}` + `POST /chat/findMessages/{instancia}` na Evolution
- Persiste cada mensagem em `whatsapp_messages` com `ON CONFLICT (id) DO NOTHING`
- Faz paginação em lotes de 100 para não estourar memória
- Retorna `{ chats: N, messages: N, inseridos: N }`

E adiciono um botão **"Importar histórico"** no `InstanceManagementPanel.tsx` que chama esse endpoint e mostra progresso via toast.

### 4. Limpeza das instâncias antigas
`crm_ee747a2d` (connecting há 11 dias, 0 msgs) e `crm_d7b74de0` (device_removed) são lixo. Adiciono botão "Excluir instância" no painel que chama `DELETE /instance/delete/{instancia}` na Evolution.

### 5. Validação final
- Mando uma mensagem real para o número Mentoark
- Confirmo no log do backend `[WEBHOOK] MESSAGES_UPSERT crm_65aba552`
- Confirmo `SELECT count(*) FROM whatsapp_messages` > 0
- Confirmo que a conversa aparece em `/whatsapp` na UI

## O que muda no código

- **Nenhum arquivo novo no Lovable** — `whatsapp.ts` já está correto, só falta deploy.
- **Backend (VPS)**: nova rota `POST /api/whatsapp/sync-history` e `DELETE /api/whatsapp/instances/:name` em `whatsapp.ts`.
- **Frontend**: dois botões em `src/components/whatsapp/InstanceManagementPanel.tsx` (Importar histórico, Excluir instância).

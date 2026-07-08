# Prompt para Claude Code — Investigar Webhook Global (Evolution) e Payload Grande (crm-api)

Cole este prompt inteiro no Claude Code (CLI). Dois achados novos vieram direto do dashboard Grafana criado nas sessões anteriores — investigar e corrigir se for seguro, seguindo `AUDITORIA_PROTOCOLO.md`. Manter foco só nisso — não reabrir n8n nem limpeza de disco (já documentados/pendentes em `INVENTARIO_VPS.md`).

---

## ACHADO 1 — Evolution "Webhook-Global" em loop de retry (1704 erros + 3409 unknown em 15min)

Log observado no Grafana (container `evolution`):
```
url: 'https://api.mentoark.com.br/webhook/evolution?key=254bb1b449103a6ac94d2c289f965d29e89e487ab402ad9b'
message: 'Aguardando 36.5 segundos antes da próxima tentativa'
local: 'p.sendData-Webhook-Global'
```

Isso é o **webhook global** do Evolution (configurado via env `WEBHOOK_GLOBAL_URL`/`WEBHOOK_GLOBAL_ENABLED` — mecanismo diferente do webhook por instância que já configuramos via `registrarWebhook()`/`webhook/set/:instance`). Ele está tentando entregar e falhando repetidamente.

### Passo 1 — Confirmar a config do webhook global no Evolution

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec evolution printenv | grep -i WEBHOOK_GLOBAL'
```

### Passo 2 — Ver o log completo (não só o trecho parcial) de uma falha recente, pra saber o motivo real (timeout? DNS? 4xx? 5xx?)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs evolution --tail 500 2>&1 | grep -B5 -A15 "Webhook-Global"'
```

### Passo 3 — Entender de onde vem o `?key=...`

Esse token não é usado por `POST /webhook/evolution` no código atual (`backend/src/routes/webhook.ts` não lê nenhum query param `key`). Buscar se `EVOLUTION_WEBHOOK_SECRET` no `.env` do backend bate com esse valor (indício de que alguém configurou isso intencionalmente em algum momento, possivelmente antes do webhook por instância existir):

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'grep "^EVOLUTION_WEBHOOK_SECRET=" /opt/crm/backend/.env'
```

### Passo 4 — Decidir e corrigir

- Se o webhook global for redundante (o webhook por instância já cobre o caso de uso, que é o nosso cenário atual — 1 usuário principal + Cris com N8N routing), o mais simples e seguro é **desativar o webhook global** no Evolution (`WEBHOOK_GLOBAL_ENABLED=false` no `.env` do Evolution, restart do container). Isso elimina o retry storm sem tocar em nada do fluxo que já funciona.
- Só ajustar a URL do webhook global (em vez de desativar) se houver evidência de que algo depende dele — investigar antes de assumir que pode desligar.
- **PARAR E CONFIRMAR com o usuário antes de reiniciar o container `evolution`** — mesma regra de sempre para mudanças em produção.

### Passo 5 — Validar

Depois da correção, monitorar o painel "Erros (últimos 15min)" no Grafana por 15-20 minutos e confirmar que o número de erros/unknown do `evolution` caiu para perto de zero (baseline normal, não zero absoluto — algum tráfego de bot/scan é normal, como já visto nos logs do n8n).

---

## ACHADO 2 — crm-api: erro de payload grande (`entity.too.large`)

Log observado:
```
type: 'entity.too.large'
limit: 1048576
length: 1391947
expected: ...
at cors (/app/node_modules/cors/lib/index.js:188:7)
```

`backend/src/index.ts` tem `app.use(express.json({ limit: '1mb' }));` — alguém está mandando um payload de ~1.39MB, acima do limite de 1MB.

### Passo 1 — Achar quem está mandando esse payload

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs crm-api --tail 1000 2>&1 | grep -B20 "entity.too.large"'
```

Olhar as linhas antes do erro pra identificar a rota/origem (provavelmente envio de mídia em base64 via `/api/whatsapp/send` ou algo similar — imagem/áudio em base64 facilmente passa de 1MB).

### Passo 2 — Avaliar a correção

Se for upload de mídia legítimo (não abuso/ataque), aumentar o limite é razoável — mas com critério, não simplesmente "aumentar bastante":
```ts
app.use(express.json({ limit: '5mb' })); // ajustar o valor conforme o caso de uso real encontrado no Passo 1
```
Comentar com `[AUDITORIA] FIX APLICADO` explicando o valor escolhido e por quê. Se a origem for suspeita (não uma rota conhecida do CRM), marcar como `[AUDITORIA] FIX PENDENTE` e reportar para o usuário decidir.

### Passo 3 — Deploy (se decidir alterar o limite)

```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/index.ts root@147.93.9.172:/opt/crm/backend/src/index.ts
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```
**PARAR E CONFIRMAR com o usuário antes deste deploy** (reinicia o backend em produção).

---

## AO FINALIZAR, REPORTAR

- Causa raiz do retry storm do webhook global e se foi desativado ou corrigido.
- Origem do payload grande e se o limite foi ajustado (e para qual valor).
- Estado do painel de erros no Grafana depois das correções (antes/depois).

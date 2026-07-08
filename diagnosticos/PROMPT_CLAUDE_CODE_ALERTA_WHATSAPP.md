# Prompt para Claude Code — Alerta do Grafana enviado por WhatsApp (via n8n + Evolution)

Cole este prompt inteiro no Claude Code (CLI). Objetivo: quando o Grafana detectar os erros críticos já mapeados nas sessões anteriores (Prisma, `WEBHOOK_REJECT`, `uncaughtException`), mandar uma mensagem de WhatsApp automaticamente para o número `<NUMERO_WHATSAPP_ALERTA>` (preencher — número com DDI+DDD, ex: 5511999999999).

Grafana não tem um tipo de notificação nativo "WhatsApp". A ponte é: **Grafana (webhook) → n8n (já rodando em `n8n.mentoark.com.br`) → Evolution API (`disparo.mentoark.com.br`) → WhatsApp**. Usar o n8n que já existe evita escrever código novo no backend do CRM só para isso.

---

## FASE 1 — DESCOBRIR QUAL INSTÂNCIA/API KEY DA EVOLUTION USAR PARA ENVIAR O ALERTA

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'grep -E "^(EVOLUTION_API_KEY|EVOLUTION_API_URL)=" /opt/crm/backend/.env | sed "s/=.\{6,\}/=***/"'
```

Usar a instância principal já conectada (confirmada em sessões anteriores como `crm_435ee4720fc3`, status "open") para disparar o alerta — não criar uma instância nova só para isso.

## FASE 2 — CRIAR O WORKFLOW NO N8N (webhook → WhatsApp)

Importar este JSON no n8n (`https://n8n.mentoark.com.br` → Workflows → Import from File/Clipboard). Ajustar `EVOLUTION_API_KEY_AQUI` e o número de destino antes de ativar:

```json
{
  "name": "Grafana Alert -> WhatsApp",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "grafana-alert",
        "responseMode": "onReceived",
        "options": {}
      },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [200, 300]
    },
    {
      "parameters": {
        "functionCode": "const body = items[0].json;\nconst alerts = body.alerts || [];\nconst status = body.status || 'unknown';\nconst linhas = alerts.map(a => `- ${a.labels && a.labels.alertname ? a.labels.alertname : 'alerta'}: ${(a.annotations && (a.annotations.summary || a.annotations.description)) || 'sem descricao'}`).join('\\n');\nconst texto = `*Alerta CRM Mentoark* (${status})\\n${linhas || body.message || JSON.stringify(body).slice(0,300)}`;\nreturn [{ json: { texto } }];"
      },
      "name": "Montar Mensagem",
      "type": "n8n-nodes-base.function",
      "typeVersion": 1,
      "position": [420, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://disparo.mentoark.com.br/message/sendText/crm_435ee4720fc3",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Content-Type", "value": "application/json" },
            { "name": "apikey", "value": "EVOLUTION_API_KEY_AQUI" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ { \"number\": \"<NUMERO_WHATSAPP_ALERTA>\", \"text\": $json.texto, \"delay\": 1000 } }}"
      },
      "name": "Enviar WhatsApp",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [640, 300]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Montar Mensagem", "type": "main", "index": 0 }]] },
    "Montar Mensagem": { "main": [[{ "node": "Enviar WhatsApp", "type": "main", "index": 0 }]] }
  }
}
```

Verificar a versão exata dos parâmetros do node `httpRequest` contra a versão do n8n rodando (`typeVersion` pode precisar ajuste — abrir o node na UI do n8n e conferir se os campos bateram, corrigir manualmente se algum campo vier vazio/errado).

**Ativar o workflow** (toggle no canto superior direito da tela do n8n) — sem isso a URL de produção do webhook não funciona, só a de teste.

A URL final do webhook de produção será algo como `https://n8n.mentoark.com.br/webhook/grafana-alert` — confirmar a URL exata mostrada no node Webhook depois de ativado (varia se o n8n está com prefixo customizado).

## FASE 3 — TESTAR A PONTE ISOLADAMENTE (antes de ligar no Grafana)

```bash
curl -s -X POST https://n8n.mentoark.com.br/webhook/grafana-alert \
  -H "Content-Type: application/json" \
  -d '{"status":"firing","alerts":[{"labels":{"alertname":"teste-manual"},"annotations":{"summary":"Isto é um teste da ponte Grafana->WhatsApp"}}]}'
```

Confirmar que a mensagem chega no WhatsApp do número configurado. Se não chegar, checar a execução no n8n (aba "Executions") para ver em qual node falhou antes de seguir pra Fase 4.

## FASE 4 — CRIAR O CONTACT POINT E O ALERTA NO GRAFANA

1. Grafana → Alerting → Contact points → New contact point.
   - Nome: `whatsapp-n8n`
   - Tipo: `Webhook`
   - URL: `https://n8n.mentoark.com.br/webhook/grafana-alert`
   - Método: `POST`
   - Testar com o botão "Test" do próprio Grafana e confirmar que chega no WhatsApp (mensagem de teste do Grafana, formato pode ser diferente do curl manual — se o node "Montar Mensagem" não achar `alerts`/`message` no formato certo, ajustar o Function node com o payload real recebido, visível na aba Executions do n8n).

2. Grafana → Alerting → Alert rules → New alert rule:
   - Datasource: Loki
   - Query: `count_over_time({container=~"crm-api|evolution"} |~ "PrismaClientValidationError|WEBHOOK_REJECT|uncaughtException" [5m])`
   - Condição: `IS ABOVE 0`
   - Avaliar a cada: `1m`, `for: 0m` (dispara imediato, sem esperar) — ajustar se gerar alerta demais/de menos depois de observar por um dia.
   - Notification policy / contact point: `whatsapp-n8n`

3. Grafana → Alerting → Notification policies: confirmar que o alerta criado está roteado para o contact point `whatsapp-n8n` (se só existir a policy default e ela já apontar pra lá, não precisa criar policy nova).

## FASE 5 — VALIDAÇÃO FINAL

Forçar um erro real controlado (ou usar o botão de teste do próprio alert rule no Grafana, "Preview"/"Test rule") e confirmar que a mensagem chega no WhatsApp em menos de 2 minutos da condição virar verdadeira.

---

## AO FINALIZAR, REPORTAR

- Número de WhatsApp configurado e instância usada para envio.
- URL final do webhook do n8n (produção).
- Resultado do teste da Fase 3 (ponte isolada) e da Fase 5 (alerta completo end-to-end).
- Qualquer ajuste que foi necessário no formato do payload do Grafana vs. o que o node "Montar Mensagem" esperava.

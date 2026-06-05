# Diagnóstico: mensagem do WhatsApp não chega no CRM

## Contexto observado

- O frontend (`WhatsAppInterface`) está recebendo mensagens de outros contatos ("Teste", "Cliente Teste", "T") — os toasts apareceram no replay, então o pipeline **Evolution → webhook → DB → /api/whatsapp/conversas → UI** funciona.
- O número `119991909106` (provavelmente JID `5511999190910X@s.whatsapp.net`) nunca aparece, mesmo com a mensagem entregue na Evolution.

Isso indica um filtro **específico daquele número** (não uma quebra global do webhook).

## Pontos do código onde a mensagem pode ser descartada silenciosamente

Em `backend/src/routes/webhook.ts` — todos retornam `200 ok` sem registrar no front:

| # | Linha | Causa do descarte | Quem dispara |
|---|------:|-------------------|--------------|
| 1 | 178 | `data.status` = READ/PLAYED/DELIVERY_ACK | Evolution manda só ACK |
| 2 | 184–187 | `remoteJid` vazio ou sem `@` | JID malformado |
| 3 | 248 | `messageId` com prefixo `resp_`/`manual_` | falso positivo anti-loop |
| 4 | 252 | `botMessageIds.has(messageId)` | id confundido com bot |
| 5 | 260 | `botSentTexts.has(texto)` | texto idêntico a uma resposta recente da IA → **falso positivo cruzado**: se outro contato escrever "Olá" e a IA tiver respondido "Olá" há pouco, **bloqueia** |
| 6 | 271 | já existe `from_me=true` com mesmo `message_id` | reentrega Evolution |
| 7 | 341–350 | deduplicação por `webhook_mensagens_processadas` | `message_id` colidiu |
| 8 | 457 | texto bate em `OPT_OUT_KEYWORDS` (sair/stop/parar/cancelar/remover/não quero) | usuário escreveu palavra-gatilho |
| 9 | 520 | `userId` null (lookup falhou) | instância sem agent_config |

O culpado mais provável para "um número específico nunca chega" é **#5** (anti-loop por texto compartilhado em `botSentTexts`) ou **#7** (collision de `message_id`). A entrada `contatos.opt_out` também filtra na listagem se for usado em algum WHERE downstream.

## Plano

### 1. Coleta de evidências (sem alterar código)
Como não posso `ssh` da sandbox, listo os comandos exatos que o usuário roda na VPS para confirmar a causa:

```bash
# a) ver se o webhook está sendo chamado para esse número
ssh root@147.93.9.172 'docker logs crm-api --tail=400 2>&1 | grep -E "119991909|999190910"'

# b) ver descartes recentes
ssh root@147.93.9.172 'docker logs crm-api --tail=400 2>&1 | grep -E "WEBHOOK_ANTILOOP|WEBHOOK_REJECT|Opt-out"'

# c) checar deduplicação e opt-out no banco
ssh root@147.93.9.172 'docker exec crm-api psql $DATABASE_URL -c "
  SELECT message_id, instancia, criado_em FROM webhook_mensagens_processadas
  WHERE message_id LIKE '\''%119991909%'\'' OR instancia=$$crm_435ee4720fc3$$
  ORDER BY criado_em DESC LIMIT 20;
  SELECT telefone, opt_out, atendente_pausou_ia FROM contatos
  WHERE telefone LIKE $$%99919091%$$;
  SELECT telefone, motivo, created_at FROM disparo_optouts
  WHERE telefone LIKE $$%99919091%$$;"'
```

### 2. Blindagem do webhook (mudanças de código)

Mesmo antes do diagnóstico, há 4 correções no `webhook.ts` que evitam o tipo exato de bug relatado:

1. **Log estruturado em TODO ponto de descarte** (linhas 178, 184, 187, 248, 252, 260, 271, 341, 350, 457, 520). Hoje só alguns logam via `wlog`; vou adicionar `wlog('WEBHOOK_DROP', motivo + remoteJid + messageId)` em cada `return` para que o `log_geral.txt` mostre exatamente qual filtro pegou cada mensagem.
2. **Escopar `botSentTexts` por telefone** (linha 260). Hoje a chave é `${telefone}:${texto}`, mas o `Set` é global no processo; se a IA falar "Olá" para o cliente A e o cliente B escrever "Olá", o `botSentTexts.has` para B retorna `false` (chave inclui telefone) — então esse caso já está OK. Vou validar a regra e adicionar TTL explícito (já existe). Sem mudança se passou na verificação.
3. **Deduplicação por `(message_id, instancia)`** (linha 347). Hoje o SELECT é só por `message_id` — se a Evolution gerar IDs curtos colidentes entre instâncias, mata mensagens válidas. Mudar para `WHERE message_id=$1 AND instancia=$2` e adicionar índice único `(message_id, instancia)`.
4. **Tratar `contatos.opt_out`/`atendente_pausou_ia` como filtros apenas da IA, nunca do salvamento**. Já é o caso, mas vou confirmar que o INSERT em `whatsapp_messages` (linha 371) acontece ANTES de qualquer filtro de opt-out (já é).
5. **Endpoint de diagnóstico** `GET /api/admin/webhook-trace?phone=119991909106` (admin only) que devolve as últimas 50 linhas do `log_geral.txt` filtradas por número, mais o status no banco (`whatsapp_messages`, `webhook_mensagens_processadas`, `contatos.opt_out`, `disparo_optouts`).

### 3. UI: card de diagnóstico no Painel Admin
Adicionar em `/admin/firewall` (ou nova aba `/admin/diagnostico-whatsapp`) um campo "Buscar número" que chama o endpoint acima e mostra:
- ✅/❌ webhook recebeu  → tabela `whatsapp_messages`
- ✅/❌ foi para `webhook_mensagens_processadas`
- ✅/❌ contato está em opt-out
- Linhas de log com motivo do descarte (se houver)

### 4. Deploy
Atualizar `backend/src/routes/webhook.ts` e dois arquivos auxiliares; usuário publica com:
```
scp backend/src/routes/webhook.ts root@147.93.9.172:/opt/crm/backend/src/routes/
ssh root@147.93.9.172 'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

## Detalhes técnicos

- Migração SQL nova: `CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_dedup_msgid_inst ON webhook_mensagens_processadas(message_id, instancia);` + `DELETE` das duplicatas antes de criar o índice.
- `wlog('WEBHOOK_DROP', ...)` reusa o helper já existente — escreve no console e em `log_geral.txt`.
- Endpoint `/api/admin/webhook-trace` em `backend/src/routes/admin_infra.ts`, protegido pelo middleware `requireAdmin` já existente.
- Componente novo `src/pages/admin/DiagnosticoWhatsApp.tsx` com input + tabela; rota adicionada em `AppSidebar`.

## O que NÃO faço neste plano
- Não mudo o `agentEngine` nem a lógica de IA (escopo é "mensagem não aparece").
- Não toco em `dados_cliente` / `contatos` schema.
- Não altero a integração com a Evolution em si.

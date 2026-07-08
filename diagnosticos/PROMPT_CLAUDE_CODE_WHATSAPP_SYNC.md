# Prompt para Claude Code — Sprint 1: Achar e Corrigir — WhatsApp não atualiza mensagens (instância criada no Evolution)

Cole este prompt inteiro no Claude Code (CLI), dentro da pasta do projeto (repo do CRM sincronizado). Este prompt faz diagnóstico E correção na mesma execução — só pare no ponto marcado como "PARAR E CONFIRMAR" se ele aparecer.

---

## CONTEXTO

CRM Mentoark. WhatsApp via Evolution API (`disparo.mentoark.com.br`). Sintoma: uma instância foi criada no Evolution, mas as mensagens dela não aparecem/atualizam no chat do CRM.

**Já verificado no código local (fixes antigos já aplicados — não repetir diagnóstico sobre isso):**
- `backend/src/routes/whatsapp.ts` tem todas as rotas REST usadas pelo frontend.
- `backend/src/routes/webhook.ts` já faz UPSERT de contato na primeira mensagem.
- `registrarWebhook()` já usa o payload correto para a Evolution v2.
- `src/services/evolutionService.ts` (frontend) já consulta o endpoint certo do backend.

**Como o backend descobre o dono (`userId`) de uma mensagem recebida** (`webhook.ts`, função de lookup, ordem exata de prioridade):
1. `agent_configs` (uma linha por usuário — `UNIQUE(user_id)`)
2. `agentes` (pode ter várias linhas por usuário — `UNIQUE(user_id, evolution_instancia)`)
3. Prefixo UUID: se `instancia` começa com `crm_`, tenta casar os primeiros 12 chars do UUID do usuário
4. `integracoes_config` (coluna `instancia`, `tipo='evolution'`)
5. Fallback: primeiro admin cadastrado

Se as 5 falharem, a mensagem é **descartada** com o log `[WEBHOOK_REJECT] NENHUM userId para instância`.

**Hipótese técnica:** `registrarWebhook()` só roda dentro dos fluxos `POST /connect` / `evo/connect` do próprio CRM. Uma instância criada direto no painel/API do Evolution (fora desses fluxos) nunca passa por essas 2 etapas:
1. Registro do webhook da instância apontando para `https://api.mentoark.com.br/webhook/evolution`.
2. Vínculo dessa `instancia` a um `user_id` em uma das 4 tabelas usadas no lookup acima.

Isso explica tanto "mensagem não chega" (webhook nunca dispara) quanto "chega mas some" (webhook dispara, mas é descartada por falta de dono).

Arquivos:
- `backend/src/routes/webhook.ts` — receptor `POST /webhook/evolution`, lookup de `userId`
- `backend/src/routes/whatsapp.ts` — `registrarWebhook()`, `webhookInner()` (`WEBHOOK_URL`, `WEBHOOK_EVENTS`)
- `backend/src/routes/integracoes.ts` — função `syncEvolution()`: é o UPSERT oficial que a própria aplicação roda em `agent_configs` quando você conecta uma instância pela tela de Integrações

VPS:
- IP: `147.93.9.172`
- SSH: `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172`
- Backend: `/opt/crm/backend/` (container `crm-api`) · Evolution: `/opt/evolution/` (container `evolution`) · Postgres: container `postgres`, db `crm`, user `mentoark`

---

## FASE 1 — IDENTIFICAR A INSTÂNCIA EXATA

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'API_KEY=$(grep "^EVOLUTION_API_KEY=" /opt/crm/backend/.env | cut -d= -f2); \
   curl -s -H "apikey: $API_KEY" https://disparo.mentoark.com.br/instance/fetchInstances | python3 -m json.tool'
```

Anote o nome exato da instância problemática. Se ela **não** seguir o padrão `crm_<12-chars-do-uuid>`, é forte indício de criação manual (fora do CRM) — reforça a hipótese acima.

## FASE 2 — VERIFICAR O WEBHOOK DA INSTÂNCIA NA EVOLUTION

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'API_KEY=$(grep "^EVOLUTION_API_KEY=" /opt/crm/backend/.env | cut -d= -f2); \
   curl -s -H "apikey: $API_KEY" https://disparo.mentoark.com.br/webhook/find/NOME_DA_INSTANCIA | python3 -m json.tool'
```

Resultado esperado (confirmado contra a documentação oficial da Evolution API v2, seção Webhooks):
```json
{ "enabled": true, "url": "https://api.mentoark.com.br/webhook/evolution", "webhookByEvents": false, "events": [...] }
```

Se `enabled:false`, ausente, ou `url` diferente → **Causa A confirmada** (webhook não aponta pro CRM). Aplique o Fix A na Fase 5 assim que terminar o diagnóstico (Fase 3 e 4 continuam valendo, pode haver mais de uma causa acumulada).

## FASE 3 — VERIFICAR SE A INSTÂNCIA TEM DONO NO BANCO (nas 4 tabelas, na ordem que o lookup usa)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT user_id, evolution_instancia, evolution_server_url IS NOT NULL AS tem_url, evolution_api_key IS NOT NULL AS tem_key, ativo FROM agent_configs WHERE evolution_instancia = '"'"'NOME_DA_INSTANCIA'"'"';"'

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT user_id, nome, evolution_instancia, ativo FROM agentes WHERE evolution_instancia = '"'"'NOME_DA_INSTANCIA'"'"';"'

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT user_id, instancia, tipo, status FROM integracoes_config WHERE instancia = '"'"'NOME_DA_INSTANCIA'"'"';"'
```

Se as 3 voltarem vazias → **Causa B confirmada** (instância órfã, nenhuma tabela sabe de quem é). Também rode, só por precaução, para ver se o usuário já tem outra instância ativa cadastrada (importante para não sobrescrever por engano no Fix B):

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT id, email FROM users;" && \
   docker exec -i postgres psql -U mentoark -d crm -c \
  "SELECT user_id, evolution_instancia, ativo FROM agent_configs;"'
```

## FASE 4 — REPRODUZIR AO VIVO (confirma a causa antes de corrigir)

Abra os logs em uma sessão:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f crm-api 2>&1 | grep --line-buffered -E "WH:|WEBHOOK_REJECT|UPSERT_CONTATO"'
```

Envie uma mensagem de WhatsApp real para o número conectado nessa instância e observe:
- Nenhuma linha `[WH:...]` aparece → confirma Causa A (Evolution nem está chamando o webhook).
- Aparece `[WH:<id>] ... FATAL: nenhum userId encontrado` seguido de `[WEBHOOK_REJECT]` → confirma Causa B (webhook chega, mas mensagem é descartada por falta de dono).
- Aparece `[WH:<id>] USERID via <fonte>: <userId>` e depois `INSERT whatsapp_messages` → o backend está funcionando; o problema é no frontend/consulta (não é o foco deste prompt — se cair aqui, reporte e pare, não aplique os fixes abaixo).

---

## FASE 5 — CORREÇÕES

### Fix A — Registrar/corrigir o webhook da instância

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'API_KEY=$(grep "^EVOLUTION_API_KEY=" /opt/crm/backend/.env | cut -d= -f2); \
   curl -s -X POST -H "Content-Type: application/json" -H "apikey: $API_KEY" \
     https://disparo.mentoark.com.br/webhook/set/NOME_DA_INSTANCIA \
     -d "{\"webhook\":{\"enabled\":true,\"url\":\"https://api.mentoark.com.br/webhook/evolution\",\"webhookByEvents\":false,\"webhookBase64\":false,\"events\":[\"MESSAGES_UPSERT\",\"MESSAGES_UPDATE\",\"MESSAGES_DELETE\",\"CONNECTION_UPDATE\",\"QRCODE_UPDATED\"]}}"'
```
Payload e eventos conferidos contra `WEBHOOK_EVENTS`/`webhookInner()` em `whatsapp.ts` e contra a documentação oficial da Evolution API v2 — idênticos ao que o próprio CRM registra quando você conecta pela tela.

### Fix B — Vincular a instância a um usuário (só se Fase 3 confirmou órfã)

**PARAR E CONFIRMAR antes de rodar isto:** olhe o resultado do último comando da Fase 3. Se o usuário já tem uma linha em `agent_configs` com uma `evolution_instancia` **diferente** e `ativo=true`, este UPSERT vai **substituir** essa instância (a tabela guarda só 1 registro por usuário — `UNIQUE(user_id)`). Se for esse o caso, confirme com o usuário qual instância deve ficar ativa antes de prosseguir, ou use a tabela `agentes` (permite múltiplas instâncias por usuário) em vez de `agent_configs`.

Este UPSERT reproduz exatamente a função `syncEvolution()` de `backend/src/routes/integracoes.ts` — é o mesmo caminho que a aplicação usa internamente, não uma escrita improvisada:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker exec -i postgres psql -U mentoark -d crm -c \
  "INSERT INTO agent_configs (user_id, evolution_instancia, evolution_server_url, evolution_api_key, ativo)
    VALUES ('"'"'<USER_ID>'"'"', '"'"'NOME_DA_INSTANCIA'"'"', '"'"'https://disparo.mentoark.com.br'"'"', '"'"'<EVOLUTION_API_KEY>'"'"', true)
    ON CONFLICT (user_id) DO UPDATE SET
      evolution_instancia = EXCLUDED.evolution_instancia,
      evolution_server_url = EXCLUDED.evolution_server_url,
      evolution_api_key = EXCLUDED.evolution_api_key,
      updated_at = NOW();"'
```

Substitua `<USER_ID>` (achado na Fase 3) e `<EVOLUTION_API_KEY>` (mesma chave usada nos comandos curl acima, obtida do `.env`).

Depois de aplicar Fix A e/ou Fix B, repita a Fase 4 (mensagem de teste + logs) para confirmar `[WH:...] USERID via agent_configs: <userId>` e o `INSERT whatsapp_messages` correspondente.

---

## FASE 6 — VALIDAÇÃO FINAL

1. `docker exec -i postgres psql -U mentoark -d crm -c "SELECT created_at, instance_name, from_me, left(content,50) FROM whatsapp_messages WHERE instance_name = 'NOME_DA_INSTANCIA' ORDER BY created_at DESC LIMIT 5;"`
2. Abrir `/whatsapp` no CRM com o usuário correto logado, confirmar que a conversa aparece e atualiza ao enviar nova mensagem de teste.

## FASE 7 — REPORTAR

Resumir: instância verificada, qual fase confirmou a causa (A, B, ou ambas), qual fix foi aplicado, e o resultado do teste de validação final (mensagem aparecendo no CRM ou o que ainda falta).

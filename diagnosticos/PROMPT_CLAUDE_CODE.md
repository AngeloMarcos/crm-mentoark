# Prompt para Claude Code — Correção Crítica: Webhook WhatsApp + IA + Deploy VPS

Cole este prompt inteiro no Claude Code (CLI) dentro da pasta do projeto `/opt/crm`.

---

## CONTEXTO

Você está no backend de um CRM WhatsApp em produção. Stack: Express.js + TypeScript + PostgreSQL + Evolution API. O sistema tem dois problemas críticos:

1. **A IA não responde** — `ENCRYPTION_KEY` ausente do `.env` quebra a descriptografia das chaves de provider no banco; `OPENAI_API_KEY` também está vazia no `.env` da VPS, então o fallback também falha. Resultado: `withAiFallback` retorna `null` e o motor IA aborta silenciosamente.

2. **Contatos novos nunca aparecem no CRM** — o webhook só fazia `UPDATE contatos` (sem INSERT), então qualquer número que nunca foi cadastrado era processado pela IA mas nunca criava o contato. O registro some depois da conversa.

Há também bugs menores confirmados: opt-out sem confirmação, instância errada no log de mensagens do bot.

Arquivos principais:
- `backend/src/routes/webhook.ts` — receptor de eventos da Evolution API
- `backend/src/services/agentEngine.ts` — motor de IA
- `backend/src/services/providers/index.ts` — factory de providers (OpenAI/Claude)
- `backend/.env` — variáveis de ambiente

VPS de produção:
- IP: `147.93.9.172`
- SSH: `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172`
- Backend em: `/opt/crm/backend/`
- Frontend em: `/opt/crm/`

---

## FASE 1 — LEITURA OBRIGATÓRIA (não edite nada ainda)

Antes de qualquer mudança, leia os seguintes arquivos na VPS via SSH e os arquivos locais. Use `cat` remoto para comparar o que está em produção vs. o que está no repositório local.

```bash
# Ler .env de produção (source da verdade para os valores das chaves)
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'cat /opt/crm/backend/.env'

# Ver status dos containers
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'

# Ver logs de erro recentes
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'docker logs --tail 60 crm-api 2>&1'

# Ver UFW
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'ufw status verbose'
```

Leia também localmente:
- `backend/src/routes/webhook.ts`
- `backend/src/services/agentEngine.ts`
- `backend/src/services/providers/index.ts`
- `backend/.env`
- `backend/docker-compose.yml`

Registre mentalmente: quais valores já estão preenchidos no `.env` da VPS, quais estão vazios, e quais variáveis existem no `.env` local mas não na VPS.

---

## FASE 2 — CORREÇÕES NO CÓDIGO LOCAL

### FIX 1 — `webhook.ts`: UPSERT antecipado de contato (BUG CRÍTICO)

**Problema:** o webhook fazia apenas `UPDATE contatos SET push_name...`. Se o número nunca foi cadastrado, o UPDATE afeta 0 linhas e o contato nunca é criado. A IA responde, mas a conversa não aparece em lugar nenhum no CRM.

**Onde inserir:** logo após o bloco dos 5 fallbacks de `userId` (após o log `wlog('WEBHOOK', ...)`) e ANTES do bloco `if (fromMe) {`.

**Código a inserir:**

```typescript
// ── UPSERT antecipado de contato — cria o contato na primeira mensagem ──────
if (userId && !isGroup && telefone) {
  pool.query(
    `INSERT INTO contatos (user_id, nome, telefone, push_name, origem, status, ultima_mensagem_em, atendente_pausou_ia)
     VALUES ($1, $2, $3, $4, 'WhatsApp', 'novo', NOW(), false)
     ON CONFLICT (user_id, telefone) DO UPDATE
       SET push_name          = COALESCE(EXCLUDED.push_name, contatos.push_name),
           nome               = CASE WHEN contatos.nome = contatos.telefone THEN EXCLUDED.nome ELSE contatos.nome END,
           ultima_mensagem_em = NOW()`,
    [userId, pushName || telefone, telefone, pushName || null]
  ).catch(err => console.warn('[WEBHOOK UPSERT_CONTATO_EARLY]:', err.message));
}
```

### FIX 2 — `webhook.ts`: Opt-out com confirmação via Evolution (BUG MENOR)

**Problema:** quando o cliente envia "sair/stop/parar", o contato é marcado como opt-out no banco, mas a Evolution API nunca é chamada para enviar a mensagem de confirmação. O cliente não sabe que saiu.

**Onde alterar:** localize o bloco:
```typescript
if (OPT_OUT_KEYWORDS.has(textoNorm)) {
  await pool.query(`UPDATE contatos SET opt_out = true...`).catch(...);
  await pool.query(`INSERT INTO disparo_optouts...`).catch(...);
  console.log(`[WEBHOOK] Opt-out: ${telefone}`);
  return;
}
```

**Substitua pelo bloco abaixo** (mantém as queries existentes e adiciona o envio de confirmação antes do `return`):

```typescript
if (OPT_OUT_KEYWORDS.has(textoNorm)) {
  await pool.query(
    `UPDATE contatos SET opt_out = true, updated_at = NOW()
     WHERE user_id = $1 AND telefone ILIKE $2`,
    [userId, `%${telefone.slice(-11)}`]
  ).catch(() => {});
  await pool.query(
    `INSERT INTO disparo_optouts (user_id, telefone, motivo) VALUES ($1, $2, $3)`,
    [userId, telefone, textoNorm]
  ).catch(() => {});

  // Enviar confirmação via Evolution (busca config da tabela agentes)
  try {
    const cfgOptOut = await pool.query(
      `SELECT COALESCE(evolution_server_url, $2) AS url,
              COALESCE(evolution_api_key,    $3) AS api_key,
              COALESCE(evolution_instancia,  $4) AS inst
       FROM agentes
       WHERE user_id = $1 AND ativo = true
       ORDER BY updated_at DESC LIMIT 1`,
      [
        userId,
        process.env.EVOLUTION_API_URL || 'https://disparo.mentoark.com.br',
        process.env.EVOLUTION_API_KEY || '',
        instancia,
      ]
    ).catch(() => ({ rows: [] as any[] }));

    if (cfgOptOut.rows.length) {
      const { url, api_key, inst } = cfgOptOut.rows[0];
      const base = (url || '').trim().replace(/\/+$/, '');
      await fetch(`${base}/message/sendText/${inst}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: api_key },
        body: JSON.stringify({
          number: telefone,
          text: 'Você foi removido da nossa lista. Para se reinscrever, envie *reativar*.',
          delay: 1000,
        }),
      }).catch(() => {});
    }
  } catch {}

  console.log(`[WEBHOOK] Opt-out confirmado: ${telefone}`);
  return;
}
```

### FIX 3 — `agentEngine.ts`: Instância correta no INSERT de whatsapp_messages

**Problema:** a resposta do bot é salva no banco com `instance_name = entrada.instancia` (nome vindo do payload da Evolution), mas o envio usa `agente.evolution_instancia || entrada.instancia`. Se os dois valores divergirem (ex: após renomear a instância), a mensagem aparece com instância errada no painel de chat.

**Onde alterar:** na etapa 11 do motor, localize o INSERT em `whatsapp_messages`:

```typescript
[userIdFinal, entrada.instancia,
```

**Substitua por:**

```typescript
[userIdFinal, agente.evolution_instancia || entrada.instancia,
```

---

## FASE 3 — CORREÇÕES NO `.env` DA VPS

**Regra de ouro:** NUNCA sobrescreva o `.env` inteiro da VPS. Apenas adicione as variáveis que estão faltando e corrija as que têm valor inválido.

Execute via SSH:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'ENVFIX'
ENV=/opt/crm/backend/.env

add_if_missing() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV"; then
    echo "[SKIP] $key já existe"
  else
    echo "${key}=${val}" >> "$ENV"
    echo "[ADD]  $key adicionada"
  fi
}

# Variáveis que devem existir mas podem estar ausentes
add_if_missing BACKEND_URL          "https://api.mentoark.com.br"
add_if_missing N8N_WEBHOOK_SECRET   "mentoark-kanban-secret-2025"
add_if_missing MASTER_EMAILS        "angelobispofilho@gmail.com,mentoark@gmail.com"
add_if_missing EVOLUTION_API_URL    "https://disparo.mentoark.com.br"
add_if_missing EVOLUTION_API_KEY    ""
add_if_missing EVOLUTION_WEBHOOK_SECRET ""
add_if_missing ENCRYPTION_KEY       ""
add_if_missing MCP_SECRET           "mentoark2025mcpsecretkey"

# Corrigir GOOGLE_CLIENT_SECRET se tiver comentário inline como valor
if grep -q "GOOGLE_CLIENT_SECRET=.*#" "$ENV"; then
  sed -i 's/GOOGLE_CLIENT_SECRET=.*/GOOGLE_CLIENT_SECRET=/' "$ENV"
  echo "[FIX]  GOOGLE_CLIENT_SECRET comentário inline removido"
fi

echo ""
echo "=== .env final (sem valores secretos) ==="
grep -v '^#' "$ENV" | grep -v '^$' | sed 's/=.\{8,\}/=***/'
ENVFIX
```

**Após executar, verifique as variáveis críticas vazias e preencha manualmente:**

```bash
# Gerar ENCRYPTION_KEY (rodar UMA vez; salvar o resultado)
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'openssl rand -hex 32'

# Editar .env para preencher os valores
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'nano /opt/crm/backend/.env'
# Preencher: OPENAI_API_KEY, ENCRYPTION_KEY, EVOLUTION_API_KEY, GOOGLE_CLIENT_SECRET
```

> ⚠️ **ATENÇÃO sobre ENCRYPTION_KEY:** se já existem providers de IA cadastrados pelo painel (tabela `ai_providers`), a `ENCRYPTION_KEY` precisa ser a MESMA usada quando eles foram cadastrados. Se não sabe qual era, a solução mais segura é gerar uma nova chave e recadastrar os providers pelo painel.

---

## FASE 4 — DEPLOY

### 4.1 Copiar arquivos TypeScript corrigidos para a VPS

```bash
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/routes/webhook.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/webhook.ts

sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/services/agentEngine.ts \
  root@147.93.9.172:/opt/crm/backend/src/services/agentEngine.ts
```

### 4.2 Rebuild e restart do container de backend

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'
```

---

## FASE 5 — TESTES DE VALIDAÇÃO

Execute **depois** que o container subir (aguarde ~30s):

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 'bash -s' << 'TESTS'

echo "========================================="
echo "TESTE 1: Health check do backend"
echo "========================================="
curl -s https://api.mentoark.com.br/health | python3 -m json.tool 2>/dev/null || curl -s https://api.mentoark.com.br/health

echo ""
echo "========================================="
echo "TESTE 2: Variáveis críticas carregadas no container"
echo "========================================="
docker exec crm-api printenv 2>/dev/null | \
  grep -E "^(OPENAI_API_KEY|ENCRYPTION_KEY|EVOLUTION_API_KEY|EVOLUTION_API_URL|EVOLUTION_WEBHOOK_SECRET|BACKEND_URL)=" | \
  awk -F= '{
    if (length($2) > 0) print "[OK]   " $1 "=" substr($2,1,6) "***"
    else print "[VAZIO] " $1 " — PREENCHER NO .env"
  }'

echo ""
echo "========================================="
echo "TESTE 3: Webhook aceita POST da Evolution"
echo "========================================="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://api.mentoark.com.br/webhook/evolution \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "diagnostico-teste",
    "data": {
      "key": {
        "remoteJid": "5511900000001@s.whatsapp.net",
        "fromMe": false,
        "id": "DIAG_TEST_001"
      },
      "message": { "conversation": "teste de diagnóstico" },
      "pushName": "Diagnóstico",
      "messageTimestamp": 1700000000
    }
  }')
echo "HTTP $STATUS (esperado: 200)"

echo ""
echo "========================================="
echo "TESTE 4: Contato foi criado no banco?"
echo "========================================="
docker exec crm-api sh -c \
  "psql \$DATABASE_URL -c \"SELECT user_id, nome, telefone, created_at FROM contatos WHERE telefone = '5511900000001' ORDER BY created_at DESC LIMIT 3;\" 2>/dev/null" \
  || echo "(psql não disponível no container — verificar pelo pgadmin)"

echo ""
echo "========================================="
echo "TESTE 5: Logs do container (últimas 50 linhas)"
echo "========================================="
docker logs --tail 50 crm-api 2>&1

TESTS
```

---

## FASE 6 — INTERPRETAR OS RESULTADOS E REPORTAR

Após executar todos os testes, reporte:

1. **TESTE 1** — o health check retornou `{"status":"ok","db":"connected"}`? Se não, qual erro?
2. **TESTE 2** — quais variáveis estão `[VAZIO]`? Liste todas.
3. **TESTE 3** — o webhook retornou HTTP 200? Se 401, o `EVOLUTION_WEBHOOK_SECRET` está configurado mas diferente entre Evolution e backend.
4. **TESTE 4** — o contato `5511900000001` apareceu no banco? Isso confirma o FIX 1.
5. **TESTE 5** — nos logs, procure por:
   - `[WEBHOOK UPSERT_CONTATO_EARLY]` → FIX 1 ativo
   - `[RASTREIO IA]` → motor IA foi acionado
   - `[RASTREIO IA - ERRO]` → qual erro (401 = key inválida, 429 = sem saldo)
   - `[ENGINE] Nenhum agente` → instância não cadastrada no banco para esse usuário
   - `[ENGINE] Provider: FALLBACK env` → nenhum provider no banco, usando env

Com base nesses resultados, aplique as correções finais necessárias.

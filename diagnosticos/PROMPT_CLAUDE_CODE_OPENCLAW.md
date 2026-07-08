# Prompt para Claude Code — Diagnóstico e Correção do OpenClaw (erro 500)

Cole este prompt inteiro no Claude Code (CLI), dentro da pasta do projeto (local, com o repo do CRM sincronizado).

---

## CONTEXTO

CRM Mentoark: React/Vite/TypeScript (frontend) + Express.js/TypeScript (backend) + PostgreSQL 16 + pgvector.

Existe uma feature "OpenClaw Admin" (`/openclaw` no frontend) — um chat com IA que executa comandos shell na VPS via tool-calling da OpenAI (function `exec`). Ela está retornando **erro 500** ao enviar mensagens. Isso já está documentado (sem causa raiz corrigida) em `.lovable/plan.md`:

> "POST /api/openclaw/chat retorna 500 (...) Fora do escopo: Corrigir a causa raiz do 500 no backend."

**Já confirmado pelo usuário:** a variável `OPENAI_API_KEY` está preenchida no `.env` da VPS — ou seja, NÃO é chave ausente. A causa é outra e precisa ser investigada ao vivo no servidor.

Arquivos relevantes:
- `backend/src/routes/openclaw.ts` — rota `POST /api/openclaw/chat`, função `checkAuth`, função `callProxy`, função `callOpenAIDirect`
- `src/pages/OpenClaw.tsx` — frontend que chama o endpoint
- `backend/src/index.ts` — linha ~141: `app.use('/api/openclaw', makeOpenClawRouter(pool))`
- `backend/.env` — variáveis de ambiente (fonte de verdade em produção)

VPS de produção:
- IP: `147.93.9.172`
- SSH: `sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172`
- Backend em: `/opt/crm/backend/` (container `crm-api`)
- Frontend em: `/opt/crm/` (container `crm`)

---

## FASE 1 — DIAGNÓSTICO (não altere nada ainda)

### 1.1 Ler variáveis de ambiente relevantes na VPS

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'grep -E "^(OPENAI_API_KEY|OPENCLAW_ADMIN_KEY|OPENCLAW_PROXY_URL|JWT_SECRET|ENCRYPTION_KEY)=" /opt/crm/backend/.env | sed "s/=.\{6,\}/=***/"'
```

Atenção especial a `OPENCLAW_PROXY_URL`: no código (`openclaw.ts`), se essa variável estiver definida com um valor **diferente** de `http://172.19.0.1:18790`, o backend tenta chamar esse proxy ANTES da OpenAI direta. Se esse proxy:
- estiver fora do ar → cai no fallback OpenAI (ok, não é o bug)
- responder 200 mas com campo `error` no JSON, ou sem campo `reply` → lança erro 502 e **não faz fallback** (bug provável)

### 1.2 Ver logs do container no momento do erro

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'docker logs -f crm-api 2>&1 | grep --line-buffered "OPENCLAW"'
```

Deixe rodando e, em paralelo (outro terminal ou depois), dispare uma requisição de teste (passo 1.3) para capturar a linha exata de erro.

### 1.3 Reproduzir o erro diretamente via curl (bypassa o frontend)

```bash
# Opção A: usando a admin key (se OPENCLAW_ADMIN_KEY estiver configurada)
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'ADMIN_KEY=$(grep OPENCLAW_ADMIN_KEY /opt/crm/backend/.env | cut -d= -f2); \
   curl -s -X POST http://localhost:3000/api/openclaw/chat \
     -H "Content-Type: application/json" \
     -H "x-openclaw-key: $ADMIN_KEY" \
     -d "{\"message\":\"diga oi\",\"sessionKey\":\"diagnostico\"}" \
     -w "\nHTTP_STATUS:%{http_code}\n"'
```

Se `OPENCLAW_ADMIN_KEY` não existir no `.env`, gere um valor temporário só para o teste:

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'echo "OPENCLAW_ADMIN_KEY=diag-temp-2026" >> /opt/crm/backend/.env && \
   cd /opt/crm/backend && docker compose restart crm-api'
# Repita o curl da opção A com x-openclaw-key: diag-temp-2026
# Depois de terminar o diagnóstico, remova essa linha do .env e reinicie de novo.
```

### 1.4 Validar a OPENAI_API_KEY isoladamente (sem passar pelo backend)

```bash
sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'KEY=$(grep "^OPENAI_API_KEY=" /opt/crm/backend/.env | cut -d= -f2); \
   curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $KEY" -w "\nHTTP_STATUS:%{http_code}\n" | tail -c 400'
```

- `HTTP_STATUS:200` → chave válida, tem acesso à API.
- `401` → chave inválida/revogada.
- `429` → chave válida mas sem crédito/limite excedido.

---

## FASE 2 — ÁRVORE DE DECISÃO

Com base nos resultados de 1.1–1.4, identifique o cenário:

**Cenário A — `OPENCLAW_PROXY_URL` aponta para um serviço quebrado que responde com `error` no JSON**
→ Bug em `callProxy()` (linha ~104-107 de `openclaw.ts`): quando `data.error` existe, lança erro 502 direto, sem fallback pra OpenAI.
→ Fix: ou remover/corrigir a variável `OPENCLAW_PROXY_URL` no `.env`, ou ajustar `callProxy()` para cair no fallback também quando `data.error` estiver presente (não só quando o fetch falha).

**Cenário B — `OPENAI_API_KEY` inválida ou sem crédito (401/429 no teste 1.4)**
→ Gerar/renovar a chave no painel da OpenAI e atualizar o `.env` da VPS.

**Cenário C — Erro de autenticação no próprio endpoint (401 "Sessão inválida" no teste 1.3)**
→ Verificar se `JWT_SECRET` no `.env` da VPS é o mesmo usado para assinar os tokens ativos; ou usar a `x-openclaw-key` para contornar isso.

**Cenário D — Timeout/abort em loop de tool-calling**
→ Nos logs, procurar múltiplas linhas `[OPENCLAW] exec: ...` seguidas de nada — indica que o comando via `exec` demorou e o `AbortController` (45s) cortou a requisição no meio do loop agêntico.
→ Fix: aumentar o timeout passado para `callProxy` na rota `/chat` (hoje usa o default de 45_000ms) ou reduzir `MAX_TOOL_ITERS`.

**Cenário E — Nenhum dos acima, 500 genérico**
→ Colar a stack trace completa do log e investigar linha a linha em `callOpenAIDirect`.

---

## FASE 3 — DEPLOY DA CORREÇÃO

Depois de identificar e corrigir o arquivo local (`backend/src/routes/openclaw.ts` e/ou `.env`):

```bash
# Se alterou código:
sshpass -p 'Mentoark@2025' scp -o StrictHostKeyChecking=no \
  backend/src/routes/openclaw.ts \
  root@147.93.9.172:/opt/crm/backend/src/routes/openclaw.ts

sshpass -p 'Mentoark@2025' ssh -o StrictHostKeyChecking=no root@147.93.9.172 \
  'cd /opt/crm/backend && docker compose build --no-cache crm-api && docker compose up -d crm-api'
```

---

## FASE 4 — VALIDAÇÃO FINAL

1. Repetir o curl do passo 1.3 e confirmar `HTTP_STATUS:200` com um campo `reply` no JSON de resposta.
2. Testar pelo navegador: abrir `/openclaw` no CRM, enviar uma mensagem real (ex: "docker ps"), confirmar que a resposta aparece sem toast de erro.
3. Remover qualquer `OPENCLAW_ADMIN_KEY` temporária criada só para diagnóstico, se aplicável.

## FASE 5 — REPORTAR

Ao final, resuma: qual cenário (A–E) era a causa raiz, qual arquivo/variável foi alterado, e o resultado do teste de validação (200 com reply, ou o que ainda falta).

# Plano: Anti-loop, cooldown e erros amigáveis

## Problema
- `POST /api/openclaw/chat` retorna 500 e o `checkStatus()` em `OpenClaw.tsx` repete a chamada a cada 30s usando `message:'ping'` (que ainda dispara o LLM no backend, gerando 500 em cascata).
- `POST /auth/refresh` retorna 401 e o cliente em `src/integrations/database/client.ts` chama `_refreshSilent()` várias vezes em paralelo (cada query/sessão dispara um refresh próprio), criando rajadas de 401.
- Erros são exibidos como strings cruas (ex.: "Erro 500", "Failed to fetch").

## Mudanças (somente frontend)

### 1. `src/lib/requestGuard.ts` (novo)
Utilitário compartilhado:
- `singleflight(key, fn)`: dedupe — se já há uma promise em voo com a mesma chave, retorna ela.
- `withCooldown(key, fn, { baseMs, maxMs, maxRetries })`: registra `nextAllowedAt` por chave; enquanto em cooldown, lança `CooldownError` sem chamar a rede. Em sucesso, reseta; em falha, dobra o atraso (exponencial com teto, ex. 1s → 2s → 4s → … até 60s).
- `friendlyError(status, raw)`: mapeia 401/403/429/5xx para mensagens em PT-BR ("Sessão expirada", "Muitas requisições, aguarde…", "Serviço indisponível, tentando de novo em Ns").

### 2. `src/integrations/database/client.ts`
- Envolver `_refreshSilent` em `singleflight('auth-refresh')` para garantir uma única chamada concorrente.
- Aplicar `withCooldown('auth-refresh', …, { baseMs: 2000, maxMs: 60000, maxRetries: 3 })`. Após estourar `maxRetries`, executar signOut local + redirect para `/login?expired=1` uma única vez (flag em `sessionStorage`).
- Não mais redirecionar dentro de `_exec()` em cada query — delegar ao guard.

### 3. `src/pages/OpenClaw.tsx`
- `checkStatus()`: substituir o "ping" que chama `/api/openclaw/chat` por `GET /health` (e remover o intervalo de 30s ou aumentar para 60s) — não usar o endpoint pago só para health.
- `sendMessage()`: envolver em `withCooldown('openclaw-chat', …)`; se em cooldown, mostrar toast com tempo restante e não adicionar nova mensagem de erro à lista.
- Bloquear botão de envio enquanto `isLoading` ou em cooldown.
- Mapear `data.error` por `friendlyError(res.status, data.error)`; consolidar mensagens repetidas (se a última mensagem do assistente já é o mesmo erro, não duplicar — apenas atualizar timestamp).

### 4. `src/components/WhatsAppInterface.tsx` (linha ~820)
- Mesma envoltória `withCooldown('whatsapp-openclaw', …)` + `friendlyError`.

### 5. Toast deduplicação
- Usar `toast.error(msg, { id: 'openclaw-error' })` (sonner já suporta `id`) para evitar pilha de toasts idênticos.

## Resultado esperado
- No máx. 1 request em voo por chave; falhas repetidas sofrem backoff 2s→4s→8s→…→60s.
- Refresh 401 sai do loop após 3 tentativas e leva ao login uma vez só.
- Usuário vê "Serviço da IA indisponível, tentando novamente em Xs" em vez de "Erro 500".
- Nenhuma mudança em backend / banco / lógica de negócio.

## Fora do escopo
- Corrigir a causa raiz do 500 no backend (`/api/openclaw/chat`) e do 401 no `/auth/refresh` — tratados nos prompts já enviados ao Claude Code da VPS.

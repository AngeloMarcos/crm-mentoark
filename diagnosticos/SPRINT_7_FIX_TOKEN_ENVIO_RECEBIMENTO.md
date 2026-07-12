# Sprint 7 — Corrigir Falha de Token no Envio/Recebimento (PRIORIDADE MÁXIMA) + Achados Menores Pendentes de webhook.ts

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro.

**Mudança de prioridade a partir desta sprint:** o usuário viu um erro de token na tela do CRM que está impedindo envio/recebimento de mensagens no WhatsApp. Isso é o único objetivo real desta sprint. **Não mexer em lógica de IA/agente** (`backend/src/services/agentEngine.ts`, `backend/src/services/humanizationService.ts`, prompts do agente, `agent_configs`) nesta sprint — fica pausado por decisão do usuário até o envio/recebimento voltar a funcionar de forma confiável. Se durante a investigação for necessário ler esses arquivos pra entender o fluxo, tudo bem, só não aplicar mudanças neles.

---

## FASE 1 — REPRODUZIR E IDENTIFICAR QUAL TOKEN

O usuário viu o erro **na tela do CRM** (não em log de VPS ainda). Antes de aplicar qualquer fix, descobrir qual token é:

1. Abrir o CRM (frontend), ir na tela de chat/WhatsApp, tentar enviar uma mensagem de teste.
2. Capturar o texto exato do erro exibido na UI.
3. Abrir DevTools → Network, repetir o envio, capturar: status HTTP da resposta de `POST /api/whatsapp/send` (ou rota equivalente), corpo da resposta (JSON de erro).
4. Checar `localStorage` do navegador: `crm_access_token` está presente? Decodificar o JWT (payload, sem verificar assinatura) e checar o campo `exp` — está expirado?
5. Testar se o refresh token está funcionando: em `src/hooks/useAuth.tsx`, ler a lógica de refresh e confirmar se ela está sendo chamada quando o access token expira, e se está de fato renovando (ou falhando silenciosamente).

Duas hipóteses possíveis, tratar separado conforme o que a Fase 1 confirmar:

### FASE 2A — Se for token JWT do próprio CRM (401 em rotas `/api/*`, sessão expirada)

- Ler o middleware de autenticação no backend (`Authorization: Bearer <token>`, JWT HS256 — ver `CLAUDE.md`), confirmar que `JWT_SECRET` usado pra assinar e pra verificar é o mesmo (não foi rotacionado/alterado em algum `.env` sem invalidar sessões corretamente).
- Confirmar tempo de expiração do access token vs. refresh token — se o access token expira rápido demais e o refresh não está sendo disparado automaticamente pelo cliente HTTP (`src/integrations/api/client.ts`), toda chamada autenticada (incluindo envio de WhatsApp) falha com 401 mesmo com o usuário "logado" na tela.
- Se confirmado, corrigir o fluxo de refresh (ou o tempo de expiração, conforme o caso) — mudança de código, pequena e isolada, pode aplicar direto seguindo o critério do protocolo.

### FASE 2B — Se for token/apikey da Evolution API (erro vindo da integração, não do login do CRM)

- Checar em `agent_configs` / `integracoes_config` (banco) se `evolution_api_key` está preenchida e válida para a instância do usuário afetado.
- Testar diretamente via `curl` na VPS um request autenticado com essa key contra a Evolution API, pra confirmar se a key ainda é aceita (pode ter sido revogada/trocada numa reinstalação).
- Ler a rota `POST /send` em `backend/src/routes/whatsapp.ts` (linha ~1060 — **ainda não foi lida a fundo em nenhuma sessão anterior**, prioridade alta) e confirmar como ela trata erro de autenticação vindo da Evolution: o erro chega legível pro frontend (e é isso que o usuário está vendo como "token") ou é engolido/genérico?
- Se a key estiver realmente inválida/expirada, isso é `FIX PENDENTE (motivo: precisa gerar/configurar nova apikey na Evolution — decisão/ação do usuário, não algo que o código corrige sozinho)`. Se for só um bug de propagação de erro (a key está ok mas o código trata mal a resposta), corrigir o código.

## FASE 3 — VALIDAR

Depois do fix (ou do diagnóstico, se for `FIX PENDENTE` de credencial), repetir o teste de envio real da Fase 1 e confirmar que a mensagem sai e chega de volta. Não considerar a sprint concluída sem esse teste ao vivo.

---

## PARTE 2 — ACHADOS MENORES PENDENTES DE webhook.ts (só depois da Fase 3 resolvida — prioridade secundária)

Da última rodada de revisão externa (Google AI Studio), 3 achados pequenos ainda não tratados:

1. **Roteamento N8N depois do descarte de grupos (~linha 825):** o bloco `if (isGroup) { ...; return; }` acontece antes do `if (n8nWebhookUrl) { ... }`, então mensagens de grupo nunca chegam ao N8N do usuário, mesmo quando ele quer usar N8N só para auditoria/enriquecimento (não pra disparar IA). **Fix:** mover o bloco de roteamento N8N para antes do `if (isGroup) return`, mantendo o descarte de IA interna para grupos como está (a checagem de IA continua depois). Isolado, aplicar direto. `[AUDITORIA] FIX APLICADO`.
2. **Guarda de payload malformado em `handleStatusUpdate`/`handleMessageDelete`:** ambas assumem `payload.instance` presente. **Fix:** adicionar `if (!payload?.instance) return;` no início das duas funções. Trivial, aplicar direto.
3. **Timer individual por mensagem na deduplicação em memória (~linha 439):** `setTimeout` por `dedupKey` pode acumular sob volume alto. **Não é urgente** — deixar como `[AUDITORIA] FIX PENDENTE (motivo: otimização, não bug — só vale a pena se volume de mensagens crescer a ponto de virar problema real de memória; trocar por janela rolante com um único `setInterval` quando isso acontecer)`, sem aplicar refactor agora.

---

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e/ou backend, conforme o que for tocado). Commits separados: um para o fix de token (Fase 2A ou 2B), outro para os achados menores da Parte 2. Atualizar `AUDITORIA_LOG.md`.

## SAÍDA PARA REVISÃO EXTERNA (Google AI Studio) — OBRIGATÓRIO, NÃO PULAR

Esta etapa é obrigatória e não pode ser omitida, resumida ou deixada "implícita". Ao final da sprint, depois de todo o resto:

1. Listar explicitamente, em uma linha, todos os arquivos tocados nesta sprint.
2. Para CADA um desses arquivos, sem exceção, imprimir um bloco no formato:

### ARQUIVO: <caminho completo>
```<linguagem>
<conteúdo completo e atual do arquivo — do início ao fim, sem cortar, sem resumir>
```

3. Não terminar a resposta da sprint sem esses blocos presentes — se a resposta for ficar muito longa, ainda assim incluir todos, um por um; não substituir por "arquivo grande, ver localmente" ou qualquer atalho.
4. Isso é usado por outra IA (Google AI Studio) que só aceita código colado, sem acesso a arquivos ou git — se o bloco não vier completo aqui, a revisão externa não é possível.

## AO FINALIZAR, REPORTAR

- Qual token era (JWT do CRM ou apikey da Evolution), com a evidência exata (erro capturado, status HTTP).
- Fix aplicado ou, se for credencial a ser regerada, o que exatamente o usuário precisa fazer.
- Confirmação via teste real de envio/recebimento funcionando de novo.
- Status dos 3 achados menores da Parte 2.
- Atualizar `STATUS.md`.

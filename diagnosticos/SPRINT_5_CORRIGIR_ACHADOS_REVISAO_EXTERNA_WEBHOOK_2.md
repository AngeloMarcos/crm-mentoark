# Sprint 5 — Segunda Rodada de Achados da Revisão Externa (Google AI Studio) em webhook.ts

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. A Sprint 4 (fixes A/B/D: `ON CONFLICT` no upsert de contato, `AbortController` no fetch de foto de perfil, log assíncrono) foi confirmada como aplicada corretamente pela revisão externa — sem discordâncias. Esta sprint trata 3 achados novos da mesma revisão, sobre o mesmo arquivo.

---

## ACHADO 1 — `fetch` para N8N sem timeout (~linha 834) — CORRIGIR

O roteamento para `n8nWebhookUrl` (bloco `if (n8nWebhookUrl) { fetch(n8nWebhookUrl, ...) }`) não tem timeout, mesmo bug que já foi corrigido no Fix B da Sprint 4 para as chamadas de foto de perfil, só que aqui é mais grave: qualquer instância de N8N lenta/instável configurada por qualquer usuário pode prender sockets de saída e degradar a recepção de webhook pra todo mundo.

**Fix:** aplicar o mesmo padrão de `AbortController` já usado no Fix B (timeout de 5-10s, `clearTimeout` no `finally`). Pequeno, isolado, reversível — aplicar direto. `[AUDITORIA] FIX APLICADO`, citando que é o mesmo padrão do Fix B da Sprint 4.

## ACHADO 2 — Possível trabalho desnecessário antes da checagem de `!userId` (~linhas 674 e 823) — VERIFICAR ANTES DE MEXER

A revisão externa aponta que o bloco de upsert de contato + fetch de foto de perfil roda incondicionalmente para `!isGroup`, e que a checagem `if (!userId) { wlog('WEBHOOK_REJECT', ...); return; }` só acontece depois, na linha ~823 — ou seja, mensagens de instância órfã (sem userId resolvido) ainda disparariam query de banco e 2 requisições HTTP externas antes de serem descartadas.

**Isso pode ser falso positivo** — na versão do arquivo antes da Sprint 4, esse bloco de contato+foto já estava dentro de um `if (userId) { ... }` mais acima (guarda a persistência da mensagem inteira, não só a checagem final). Antes de aplicar qualquer fix: ler o arquivo atual do início ao fim e confirmar se esse bloco realmente executa sem `userId` resolvido, ou se já está protegido por um `if (userId)` anterior que a revisão externa não viu (ela só recebe o texto colado, pode ter perdido contexto de indentação/escopo).

- Se **confirmado** que o bloco roda mesmo sem `userId`: mover a checagem `if (!userId) { wlog(...); return; }` para logo antes do bloco de upsert+foto (linha ~674), preservando o comportamento de log e return já existente. `[AUDITORIA] FIX APLICADO`, citando a confirmação feita.
- Se **não confirmado** (o bloco já está protegido): não mudar nada, e registrar `[AUDITORIA] LÓGICA` explicando por que o achado da revisão externa era falso positivo, pra não reabrir essa dúvida em sprint futuro.

## ACHADO 3 — Falta checagem defensiva no loop de `handleStatusUpdate` (~linhas 165-175) — CORRIGIR

`for (const upd of updates) { const messageId = (upd as any).id ...}` assume que cada item de `updates` é um objeto válido. Um item `null`/`undefined` no array (payload malformado da Evolution) lançaria `TypeError` e interromperia o loop pros demais itens do mesmo payload — erro silenciado pelo catch externo, mas perde as atualizações de status seguintes no mesmo lote.

**Fix:** adicionar `if (!upd || typeof upd !== 'object') continue;` no início do loop. Trivial, isolado, sem risco. `[AUDITORIA] FIX APLICADO`.

---

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Achado 2 exige a etapa de confirmação (regra do protocolo: "sempre que achar algo suspeito, parar e confirmar lendo os arquivos relacionados antes de marcar como BUG") — não aplicar o fix dele sem antes checar o código real. Rodar `npm run build` do backend depois das edições. Commit único pra este arquivo (`audit(whatsapp): webhook.ts — timeout N8N, checagem userId, defensivo status update`). Atualizar `AUDITORIA_LOG.md`.

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

- Confirmação do fix do Achado 1 (timeout N8N).
- Achado 2: se foi confirmado real ou falso positivo, e o que foi feito em cada caso.
- Confirmação do fix do Achado 3.
- Build do backend passou.
- Se esta sprint esgotou os achados conhecidos de `webhook.ts` (nenhuma pendência nova além do `ILIKE` já documentado como `FIX PENDENTE`), ou se ainda vale mandar o arquivo pra mais uma rodada de revisão externa.
- Atualizar `STATUS.md`.

# Sprint 6 — Timeout na Confirmação de Opt-out em webhook.ts (fechamento da auditoria deste arquivo)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Terceira e (provavelmente) última rodada de revisão externa sobre `backend/src/routes/webhook.ts` — as Sprints 4 e 5 foram confirmadas sem discordância (Achado 2 da Sprint 5 foi confirmado como falso positivo, já documentado no código). Resta 1 achado novo, pequeno.

---

## ACHADO — `fetch` de confirmação de opt-out sem timeout (~linha 829) — CORRIGIR

Dentro do fluxo de opt-out por palavra-chave, o envio da mensagem de confirmação pro cliente (`await fetch(`${base}/message/sendText/${evoInst}`, ...)`) roda com `await` direto no corpo do handler, sem timeout. Se a Evolution travar exatamente nesse momento, a requisição do webhook fica presa esperando resposta. Volume baixo comparado ao roteamento N8N (Sprint 5), mas mesmo vetor de risco.

**Fix:** aplicar o mesmo padrão de `AbortController` já usado nos Fixes B (Sprint 4) e do N8N (Sprint 5) — timeout de 5s, `clearTimeout` no `finally`. Trivial, isolado, reversível — aplicar direto. `[AUDITORIA] FIX APLICADO`, citando que é o terceiro lugar do arquivo a receber esse mesmo padrão.

---

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` do backend depois da edição. Commit (`audit(whatsapp): webhook.ts — timeout na confirmação de opt-out`). Atualizar `AUDITORIA_LOG.md`.

## SAÍDA PARA REVISÃO EXTERNA (Google AI Studio) — OBRIGATÓRIO, NÃO PULAR

Esta etapa é obrigatória e não pode ser omitida, resumida ou deixada "implícita". Ao final da sprint:

1. Listar explicitamente, em uma linha, todos os arquivos tocados nesta sprint.
2. Para CADA um desses arquivos, sem exceção, imprimir um bloco no formato:

### ARQUIVO: <caminho completo>
```<linguagem>
<conteúdo completo e atual do arquivo — do início ao fim, sem cortar, sem resumir>
```

3. Não terminar a resposta da sprint sem esses blocos presentes — se a resposta for ficar muito longa, ainda assim incluir todos, um por um; não substituir por "arquivo grande, ver localmente" ou qualquer atalho.
4. Isso é usado por outra IA (Google AI Studio) que só aceita código colado, sem acesso a arquivos ou git — se o bloco não vier completo aqui, a revisão externa não é possível.

## AO FINALIZAR, REPORTAR

- Confirmação do fix aplicado.
- Build do backend passou.
- **Checklist de fechamento de `webhook.ts`:** confirmar que os únicos itens em aberto no arquivo são os dois já documentados como decisão de infraestrutura/produto (migração de telefone pra E.164 / troca de `ILIKE` por igualdade exata, e o bug upstream Prisma P2010 do Evolution API) — nenhum achado de código pendente. Se algo além disso ainda estiver pendente, listar.
- Sugestão de qual arquivo/módulo deveria ser o próximo alvo de auditoria (ex: próximo item da lista da Tarefa C da Sprint 1 — `backend/src/routes/whatsapp.ts`, rota `POST /send`, ainda não lida a fundo).
- Atualizar `STATUS.md`.

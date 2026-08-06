# Sprint — Corrigir bug: legenda de mídia nunca é salva (`legenda_midia` sempre vazio)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Bug pequeno e isolado, já documentado no próprio código com comentário `[AUDITORIA] BUG` (achado na Sprint Templates de Disparo, 2026-07-30) — reconfirmado presente em `src/pages/Disparos.tsx` por volta da linha 1316-1338 (StepMessage) antes de escrever este prompt. Confirme o número de linha atual antes de editar, pode ter mudado.

---

## O bug

Em `StepMessage` (`Disparos.tsx`), o `Textarea` usado tanto para "Mensagem" (quando `tipo_midia === 'texto'`) quanto para "Legenda" (demais tipos: imagem/áudio/documento) sempre lê e escreve em `form.mensagem` — nunca em `form.legenda_midia`, mesmo quando o label mostrado é "Legenda (opcional)".

`StepReview.handleStart` manda os dois campos separados pro backend (`mensagem_template` e `legenda_midia`). Resultado: toda campanha de mídia criada do zero neste wizard (sem carregar um template existente) grava `legenda_midia` vazio de verdade — a legenda que o usuário digitou nunca chega no envio real como `legenda_midia`, só como `mensagem`/`mensagem_template`.

Hoje existe um contorno parcial só no fluxo de **templates**: `confirmarSalvarTemplate` espelha `form.mensagem` em `legenda_midia` na hora de salvar um template (pra tela de Templates funcionar certo), e `carregarTemplate` faz o inverso ao carregar. Isso mascara o bug quando o fluxo passa por um template, mas não corrige a causa raiz — uma campanha criada sem template continua enviando `legenda_midia` vazio.

## O que fazer

1. No `Textarea` do `StepMessage` (bloco com o comentário `[AUDITORIA] BUG`), trocar `value`/`onChange` para usar `form.legenda_midia` quando `form.tipo_midia !== 'texto'`, e `form.mensagem` quando `tipo_midia === 'texto'` — refletindo o que já é mostrado no `Label` condicional logo acima.
2. Os botões de inserir placeholder (`{{nome}}`, `{{primeiro_nome}}`, etc.) devem escrever no mesmo campo que o Textarea está usando no momento (`legenda_midia` ou `mensagem`, conforme o tipo).
3. Conferir o preview (`Preview Card`, logo abaixo) e `substituirPlaceholders` — devem usar o campo certo (`legenda_midia` para mídia, `mensagem` para texto) pra a prévia bater com o que será realmente enviado.
4. Conferir `StepReview.handleStart` — já envia os dois campos separados; só confirmar que `legenda_midia` chega preenchido de verdade quando a campanha é de mídia criada do zero (sem template).
5. Revisar `carregarTemplate`/`confirmarSalvarTemplate` — como o Textarea agora vai gravar direto em `legenda_midia` quando aplicável, o espelhamento manual que existe hoje (linha ~1247, comentário explicando o contorno) pode ficar redundante; simplificar se fizer sentido, sem quebrar o fluxo de templates.
6. Remover o comentário `[AUDITORIA] BUG ... FIX PENDENTE` e substituir por `[AUDITORIA] FIX APLICADO` com a data, resumindo a correção.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend). Testar em homolog com dado real: criar uma campanha de imagem do zero (sem carregar template), digitar uma legenda, mandar pra um número de teste, e confirmar no banco (`disparos`/`disparo_logs` ou no log de envio) que `legenda_midia` chegou preenchido — não vazio. Testar também que campanhas de texto puro continuam funcionando normalmente (não regredir). Testar o fluxo de templates (carregar e salvar) continua funcionando depois da mudança.

## AO FINALIZAR, REPORTAR

- Confirmação do teste real (campanha de mídia do zero, legenda chegando preenchida no envio).
- Confirmação de que campanhas de texto e o fluxo de templates não regrediram.
- Build do frontend passou.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

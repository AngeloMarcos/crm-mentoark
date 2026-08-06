# Sprint — Cooldown vira filtro automático (descarta silenciosamente), não bloqueio com checkbox obrigatório

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção.

---

## Contexto (confirmado no código atual)

Hoje, no passo "Revisar e Agendar" (`Disparos.tsx`, `StepReview`), quando algum contato selecionado já recebeu campanha dentro da janela de cooldown, a tela mostra um aviso ("N de M contatos... já receberam... enviar mesmo assim?") com um checkbox obrigatório ("Sim, quero enviar mesmo assim") — e **os botões de disparo ficam desabilitados pra TODA a campanha** até o operador marcar esse checkbox (`bloqueadoPorCooldown = contatosCooldown.length > 0 && !confirmarCooldown`, ~linha 2242, aplicado em `disabled={bloqueadoPorCooldown}` nos botões "Disparar Agora"/"Agendar Disparo", ~linha 2433+).

**Achado importante**: esse checkbox não muda o comportamento real de envio — o backend já tem uma camada de proteção independente (`disparoProcessor.ts` + `get_next_disparo_batch()`, `migrations.ts`) que **sempre** pula silenciosamente qualquer contato ainda dentro da janela de cooldown, marcando o log como `status='cooldown'` em vez de enviar de verdade — isso já foi testado com envio real em sessão anterior (Sprint Cooldown de Disparos, 2026-07-30: "mensagem E enviada de verdade... mensagem F... bloqueada"). Ou seja, marcar o checkbox **não força envio pros 10 contatos em cooldown** (o backend continua os pulando de qualquer forma) — o checkbox só libera os botões pra que os outros 237 contatos, que não têm problema nenhum, possam receber a campanha. É uma trava de UI desnecessária, sem efeito prático real, que só atrapalha o operador.

Pedido do usuário: não devia ser preciso confirmar nada — os contatos em cooldown devem ser descartados automaticamente (o backend já faz isso), sem bloquear o disparo pros demais.

## O que fazer

1. **Remover o bloqueio dos botões por cooldown** — apagar `bloqueadoPorCooldown` da condição `disabled` dos botões "Disparar Agora"/"Agendar Disparo" (~linha 2433 em diante). Cooldown deixa de impedir o início da campanha.
2. **Trocar o aviso de "pergunta com checkbox" por informativo, não-bloqueante** — manter a visibilidade (o operador deve continuar sabendo que X contatos serão pulados, é informação útil), mas sem exigir ação nenhuma: algo como "X de Y contatos selecionados já receberam campanha nas últimas Zh e serão pulados automaticamente." Remover o checkbox `confirmarCooldown` (~linha 2234, 2418-2426) e toda a lógica associada, já que não tem mais função.
3. **Confirmar que o backend não muda em nada** — este é um fix só de frontend; `disparoProcessor.ts`/`get_next_disparo_batch()` já fazem o trabalho real de descartar, não precisam de nenhuma alteração.
4. Considerar (opcional, avaliar se vale) atualizar o contador de "Destinatários" no resumo (~linha 2350-2357) pra refletir quantos vão ser efetivamente enviados vs. quantos serão pulados por cooldown, já que a informação já está calculada (`contatosCooldown.length`) — deixa mais claro pro operador de cara, sem precisar rolar até o aviso.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend). Testar em homolog: campanha com alguns contatos propositalmente em cooldown (reaproveitar o mesmo cenário de teste já usado na sprint original de cooldown, 2026-07-30) — confirmar que os botões de disparo ficam habilitados sem precisar de nenhuma confirmação, que a campanha inicia normalmente, e que os contatos em cooldown continuam sendo pulados de verdade no envio real (não regredir a proteção do backend).

## AO FINALIZAR, REPORTAR

- Confirmação de que os botões não ficam mais bloqueados por cooldown.
- Teste real confirmando que contatos em cooldown continuam sendo pulados no envio de verdade (a proteção de backend não regrediu).
- Se a mudança do item 4 (contador refletindo envio efetivo) foi aplicada ou não, e por quê.
- Build do frontend limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

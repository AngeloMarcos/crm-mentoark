# Sprint — Diagnóstico: por que 2 dos 4 grupos conhecidos não têm nome/foto salvos

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Começar como diagnóstico — só corrigir se o achado for claramente de baixo risco; se precisar de mudança maior, reportar e esperar aprovação antes de aplicar.**

---

## Contexto

Levantamento anterior (`diagnosticos/SPRINT_LEVANTAMENTO_GRUPOS_WHATSAPP.md`, já executado) encontrou 4 grupos conhecidos na conta `mentoark@gmail.com` (`user_id = 435ee472-0fc3-4015-995a-ae6e1c80606d`, produção). 2 deles têm nome e foto salvos em `contatos` (via `buscarInfoGrupo()`, fix de 29/07); os outros 2 nunca tiveram nenhuma linha criada em `contatos`, apesar de terem mensagens desde 24-25/07:

- `5511952927886-1398018374@g.us` — mensagens de 25/07 a 28/07, sem linha em `contatos`.
- `120363391544794384@g.us` — mensagens de 24/07 a 27/07, sem linha em `contatos`.

Hipótese mais provável, a confirmar: o fix de `buscarInfoGrupo()` (que busca nome/foto reais na Evolution) foi deployado em 29/07 — e a última mensagem desses 2 grupos foi 27-28/07, **antes** do fix existir. Se o gatilho de backfill só roda quando uma mensagem *nova* chega (não retroativamente para mensagens antigas), esses 2 grupos nunca tiveram uma chance de disparar o backfill — não seria bug, seria só falta de mensagem nova desde o fix.

## O que fazer

1. Ler `buscarInfoGrupo()` (`backend/src/utils/whatsappMediaStorage.ts`) e o trecho que a chama em `webhook.ts` (~linha 1372-1428, achado do "[AUDITORIA] BUG (achado 2026-07-29...)"). Confirmar: o backfill roda em toda mensagem de grupo recebida, ou só sob alguma condição específica (ex: só se `contatos` ainda não tiver a linha)?
2. Testar a hipótese de timing: confirmar a data exata do deploy do fix de 29/07 (git log/`AUDITORIA_LOG.md`) contra a data da última mensagem desses 2 grupos. Se a mensagem for anterior ao deploy, é isso — não precisa de correção de código, só de uma mensagem nova pra disparar o backfill (ou rodar manualmente uma vez).
3. Se a hipótese de timing não bater (ex: teve mensagem nova depois do deploy e mesmo assim não populou), chamar `buscarInfoGrupo()` diretamente (script pontual, não em produção sem cuidado) pra esses 2 JIDs específicos e ver o que a Evolution retorna de verdade — `subject`/`pictureUrl` vazios, erro HTTP, ou timeout. Reportar a resposta crua.
4. Conferir o botão "Sincronizar fotos de perfil" (mencionado em sessões anteriores) — ele existe e funciona? Ele resolveria os 2 grupos sem nome se clicado agora? Testar clicando nele (ambiente de produção, mas é uma ação de leitura/sincronização, não deveria ter risco de side-effect destrutivo — confirmar isso antes de clicar).
5. Aproveitar a investigação pra mapear outras funcionalidades de grupo que possam estar incompletas/bugadas (o usuário pediu pra melhorar "os grupos e as funcionalidades" de forma geral, não só nome/foto) — sem implementar nada ainda, só listar o que encontrar: ex. exibição de grupos na lista de conversas do CRM, se `WhatsAppInterface.tsx`/`ContatoDetalhe.tsx` tratam grupo de forma diferenciada e correta, se há algum outro campo/metadado de grupo que deveria existir e não existe.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Não fazer mudança de código nesta sprint a menos que o achado seja trivial e de baixíssimo risco (ex: rodar o backfill manualmente pros 2 JIDs específicos via script pontual — isso não é uma mudança de código, é uma ação operacional, pode fazer se confirmar que é seguro). Qualquer mudança de código real (ex: mudar a condição de quando `buscarInfoGrupo` roda) deve ser reportada como recomendação, não aplicada sem aprovação.

## AO FINALIZAR, REPORTAR

- Causa raiz confirmada dos 2 grupos sem nome/foto (timing do deploy, falha da Evolution pra esses JIDs específicos, ou outra causa).
- Se rodou o backfill manual pros 2 grupos, resultado (nome/foto populados ou não).
- Se o botão "Sincronizar fotos de perfil" existe, funciona, e resolveu os 2 casos.
- Lista do que mais foi encontrado sobre funcionalidades de grupo incompletas/bugadas (sem corrigir ainda) — pra decidirmos prioridade juntos depois.
- Nenhuma mudança de código aplicada sem necessidade confirmada e de baixo risco.

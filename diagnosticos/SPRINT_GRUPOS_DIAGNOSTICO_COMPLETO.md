# Sprint — Diagnóstico completo de grupos de WhatsApp (nome/foto, exclusão de Disparos, telas)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Diagnóstico em primeiro lugar — só aplicar correção sem pedir aprovação se for trivial e de baixíssimo risco (ex: rodar um backfill pontual, ajustar um filtro simples). Qualquer mudança maior: reportar e esperar.**

---

## Contexto

Levantamento anterior (já executado, não repetir) encontrou 4 grupos conhecidos na conta `mentoark@gmail.com` (`user_id = 435ee472-0fc3-4015-995a-ae6e1c80606d`, produção):

| JID | Nome salvo | Última mensagem | Foto |
|---|---|---|---|
| `120363423841514752@g.us` | Linux lovable extensão | 01/08 | sim |
| `120363405273567967@g.us` | VIPS: NEGÓCIOS COM AGENTES DE IA | 29/07 | não |
| `5511952927886-1398018374@g.us` | — (sem linha em `contatos`) | 28/07 | — |
| `120363391544794384@g.us` | — (sem linha em `contatos`) | 27/07 | — |

Esta sprint junta 3 frentes de investigação sobre grupos, pra fechar de vez antes de qualquer trabalho de IA-em-grupo-específico (que fica pra depois, não é escopo aqui).

## 1. Causa raiz: por que 2 grupos nunca ganharam nome/foto

- Ler `buscarInfoGrupo()` (`backend/src/utils/whatsappMediaStorage.ts`) e onde é chamada em `webhook.ts` (~linha 1372-1428, comentário `[AUDITORIA] BUG (achado 2026-07-29...)`). Confirmar exatamente quando o backfill roda (toda mensagem de grupo, ou só condicionalmente).
- Testar a hipótese de timing: o fix de nome/foto foi deployado em 29/07; a última mensagem dos 2 grupos sem dado foi 27-28/07, **antes** do fix existir. Se o backfill só roda em mensagem nova (não retroativo), isso explica tudo — não seria bug.
- Se a hipótese não bater sozinha, chamar `buscarInfoGrupo()` diretamente pra esses 2 JIDs (script pontual) e reportar a resposta crua da Evolution (`subject`/`pictureUrl` vazio, erro HTTP, timeout).
- Testar o botão "Sincronizar fotos de perfil" (existe? funciona? resolve os 2 grupos sem precisar de mensagem nova?). Se resolver, pode rodar — é ação de sincronização, não destrutiva.

## 2. Achado novo: Disparos não exclui grupos — checar e corrigir se confirmado

Busquei por `@g.us`/`isGroup`/`grupo` em `Disparos.tsx` e `disparoProcessor.ts` e não achei nada — ou seja, **nada no código hoje impede um grupo (que já tem linha em `contatos`, como os 2 grupos com nome confirmados) de ser selecionado como "contato" numa campanha de disparo em massa**, o que mandaria uma mensagem de campanha pra dentro do grupo, não pra uma pessoa.

- Confirmar se isso é real: `StepContacts` (`Disparos.tsx`) usa alguma query em `contatos` que já filtra por telefone ter só dígitos, ou aceita qualquer linha (grupo incluso)?
- Se confirmado que um grupo pode ser selecionado e receber disparo: corrigir excluindo `contatos` cujo `telefone` corresponda a um JID de grupo (grupos não têm `@g.us` salvo em `contatos.telefone`, ver nota técnica abaixo — vai precisar de outro critério, ex: uma coluna `is_group`/`tipo_contato` se já existir, ou o padrão de ID numérico longo sem formato de telefone brasileiro válido). Se não houver hoje nenhuma forma confiável de diferenciar grupo de contato normal em `contatos`, reportar isso como achado (pode precisar de uma coluna nova `is_group boolean`, populada no mesmo ponto que já cria a linha de grupo em `contatos`) em vez de arriscar um filtro heurístico frágil.
- **Nota técnica (do levantamento anterior)**: `contatos.telefone` pra grupo guarda só o ID (`120363423841514752`), sem sufixo `@g.us` — não dá pra filtrar por `LIKE '%@g.us'` direto em `contatos`, só em `whatsapp_messages.remote_jid`.

## 3. Auditoria geral de como grupo aparece nas outras telas

Sem implementar nada nesta parte, só mapear:
- `WhatsAppInterface.tsx` — grupo aparece corretamente na lista de conversas (nome, foto, indicador visual de que é grupo)? Alguma ação disponível pra contato individual (ex: editar campos de CRM/funil) que não faz sentido pra grupo e deveria ser escondida?
- `ContatoDetalhe.tsx` — abrir o "contato" de um grupo funciona sem erro? Mostra algo que não faz sentido (ex: campos de funil/pipeline pensados pra pessoa física)?
- Qualquer outro lugar do sistema que itere sobre `contatos` sem considerar que uma linha pode ser um grupo (ex: exportação de contatos, relatórios, busca).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Correções triviais e de baixo risco (backfill pontual, sync de fotos) pode aplicar direto. Correção do filtro de Disparos: aplicar só se a correção for simples e segura (ex: um `WHERE` a mais numa query já existente); se precisar de coluna nova no banco ou mudança estrutural, reportar como recomendação e esperar aprovação — não é urgente o suficiente pra justificar risco sem revisão.

## AO FINALIZAR, REPORTAR

- Causa raiz confirmada dos 2 grupos sem nome/foto, e se foi resolvido (backfill manual ou botão de sync).
- Confirmação se grupos podem hoje ser selecionados numa campanha de Disparos — e se corrigiu ou só documentou a recomendação.
- Mapeamento do que mais foi encontrado nas outras telas (bugs ou lacunas), sem corrigir ainda — pra decidirmos prioridade juntos.
- Toda mudança de código aplicada, listada explicitamente (o que mudou e por quê).
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

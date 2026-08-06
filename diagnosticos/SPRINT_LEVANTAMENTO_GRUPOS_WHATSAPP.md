# Sprint — Levantamento de grupos de WhatsApp conhecidos (só leitura, sem mexer em nada)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Sprint 100% de leitura — nenhuma linha de código muda, nenhum dado é alterado.** Objetivo: listar os grupos de WhatsApp que já mandaram mensagem pra esta conta, pra o usuário identificar o JID exato do grupo certo antes de qualquer trabalho de habilitar IA em grupo específico.

---

## Contexto

Hoje o sistema ignora mensagens de grupo pra fins de resposta automática da IA (`if (isGroup) return`, `backend/src/routes/webhook.ts` ~linha 1567) — bloqueio intencional, não é bug. Mas mensagens de grupo são salvas normalmente, e desde o fix de 29/07 (`buscarInfoGrupo`) o sistema já busca nome e foto reais do grupo na Evolution e salva em `contatos` quando uma mensagem de grupo chega. Ou seja: já existe, hoje, uma lista de grupos conhecidos no banco — só precisa ser consultada.

## O que fazer

1. Confirmar o `user_id` de `mentoark@gmail.com` (a conta com a instância de WhatsApp ativa em produção) com uma query direta.
2. Rodar uma query de leitura (`contatos` e/ou `whatsapp_messages`, o que tiver o dado mais completo) filtrando `telefone`/`remote_jid` que termine em `@g.us`, pra esse `user_id`. Trazer: JID completo, nome do grupo (`nome`/`subject`, o que existir), data da primeira e da última mensagem vista desse grupo, e uma contagem aproximada de mensagens (se for barato de calcular — não otimizar isso, é só uma consulta pontual).
3. Se não houver nenhum grupo salvo ainda (ex: se `groupsIgnore` tivesse ficado ativo em algum período, ou a conta é nova), reportar isso claramente — pode ser preciso mandar uma mensagem de teste num grupo real primeiro pra ele aparecer no banco.
4. Não alterar nada — nem em `contatos`, nem em nenhuma outra tabela. Não mexer em `groupsIgnore` nem em nenhuma config de instância.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Consulta direta no banco (homolog e/ou produção, o que fizer sentido pra essa conta especificamente — ela já roda em produção). Não precisa de build, não precisa de deploy — é só uma consulta.

## AO FINALIZAR, REPORTAR

- Tabela com todos os grupos encontrados: JID, nome, primeira/última mensagem vista, contagem aproximada.
- Se algum grupo aparecer sem nome (só o "Grupo XXXX" genérico), sinalizar — pode precisar de uma mensagem nova nesse grupo pra o fix de nome/foto rodar.
- Confirmação de que nada foi alterado (é só leitura).

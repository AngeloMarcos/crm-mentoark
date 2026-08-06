# Sprint — Roleta de tarefas em grupo de WhatsApp (levantamento + desenho, com portões de segurança)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Parte 1 é só levantamento (leitura). Parte 2 é desenho pra aprovação — não implementar ainda.** Ler também o incidente de `users.owner_id` de 21/07 em `AUDITORIA_LOG.md`/comentário em `migrations.ts` (~linha 1475-1490) antes de começar: um fallback automático de vínculo de conta já misturou dados de 10 clientes reais em produção. É exatamente a classe de erro a evitar aqui — a "roleta" só pode escolher entre pessoas confirmadas como time de UM tenant específico, nunca por heurística.

---

## Contexto

Objetivo do usuário: quando uma demanda aparece num grupo específico de WhatsApp (o mesmo grupo que já está pendente de confirmação de JID exato — ver `SPRINT_LEVANTAMENTO_GRUPOS_WHATSAPP.md`/conversa anterior), a IA deve criar uma tarefa no CRM atribuída, em rodízio, a uma pessoa do time por vez — sem marcar ninguém no grupo, só registrar a tarefa. Isso só pode rodar dentro do grupo certo — nunca em nenhum outro grupo (a IA hoje já ignora todo grupo por padrão, `if (isGroup) return` em `webhook.ts`; este trabalho é sobre abrir uma exceção controlada só pra um JID confirmado, não sobre mudar o comportamento geral).

Infraestrutura já existente no sistema que esta feature deve reaproveitar (achada nesta investigação, não precisa recriar):
- Tabela `tarefas` (Kanban) já tem `atribuido_a UUID REFERENCES users(id)`, `origem TEXT DEFAULT 'manual'`, `resumo_ia TEXT`, `remote_jid`, `instance_name`, `contato_nome`, `contato_telefone` — já dá pra representar "tarefa criada pela IA a partir de uma mensagem de grupo, atribuída a fulano".
- Tabelas `equipes` (`owner_id`, `nome`) e `team_members` (`owner_id`, `user_id`, `email`, papel/status de convite) — já existe um conceito de time vinculado a um `owner_id` (o admin da conta).

## Parte 1 — Levantamento (só leitura)

1. Confirmar `user_id` de `mentoark@gmail.com` (já usado nas sprints anteriores de grupo: `435ee472-0fc3-4015-995a-ae6e1c80606d`) e verificar se esse `user_id` é `admin`/tem `owner_id = id` (dono de si mesmo) ou se é um usuário vinculado a outro dono — confirmar isso é crítico antes de qualquer coisa.
2. Listar `team_members` e `equipes` onde `owner_id` = esse `user_id` — quantas pessoas existem, quais e-mails/nomes, status de convite (aceito/pendente). Se não houver nenhum `team_member` cadastrado ainda, reportar isso claramente (a roleta não tem quem rodar até existir gente cadastrada).
3. Conferir schema completo de `tarefas` (colunas atuais em produção) pra confirmar que os campos citados acima realmente existem e com os tipos certos.
4. Não alterar nada nesta parte.

## Parte 2 — Desenho da feature (documentar, não implementar)

Com base no levantamento da Parte 1, escrever um desenho técnico curto cobrindo:

1. **Portão de grupo único**: a IA só processa mensagem de grupo pra fins de roleta se `remoteJid` for exatamente o JID já confirmado (a confirmar pelo usuário separadamente, ainda pendente) — reaproveitar/criar uma tabela pequena `grupos_ia_permitidos (user_id, group_jid, finalidade, ativo)` em vez de hardcode, permitindo múltiplos grupos com finalidades diferentes no futuro sem gambiarra.
2. **Gatilho**: como a IA decide que uma mensagem no grupo é "uma demanda que vira tarefa" vs. conversa normal do grupo — proposta: uma ferramenta MCP nova (`criar_tarefa_grupo`, mesmo padrão de `criar_agendamento`) que a IA chama quando julgar que a mensagem é um pedido/tarefa, deixando a decisão pro modelo (mesmo padrão já usado em `criar_corrida`/`registrar_pausa`) em vez de regra fixa de palavra-chave.
3. **Round-robin**: quem entra na rotação (todos os `team_members` aceitos daquele `owner_id`, ou um subconjunto escolhido manualmente — decisão do usuário) e onde fica o estado de "quem foi o último" (recomendo persistente em banco, não em memória — ex: coluna `ultimo_atribuido_index` numa tabela pequena de config da roleta, não no padrão de cache em memória já usado em Disparos, porque aqui a frequência é baixa e precisa sobreviver a restart do processo).
4. **Criação da tarefa**: `INSERT INTO tarefas (user_id, atribuido_a, origem='grupo_whatsapp', resumo_ia=<resumo gerado pela IA>, remote_jid=<jid do grupo>, contato_nome=<quem pediu no grupo>, contato_telefone=<telefone de quem pediu>, coluna_id=<coluna padrão a definir>)`.
5. **Confirmação no grupo**: a IA deve responder no grupo confirmando que registrou (ex: "Anotado! Tarefa registrada pra [nome da pessoa da vez]") — sem expor detalhes internos de rodízio/tabela.
6. **Limite de escopo explícito**: reafirmar que este mecanismo NUNCA roda fora do grupo confirmado — nenhuma mudança no bloqueio geral `if (isGroup) return` pra outros grupos.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Parte 1 é leitura pura. Parte 2 é só documento — não escrever código de implementação nesta sprint.

## AO FINALIZAR, REPORTAR

- Confirmação do `owner_id`/estrutura de time da conta Mentoark (quantos `team_members`, quem são).
- Confirmação do schema de `tarefas` batendo com o que foi assumido acima.
- O desenho técnico da Parte 2, completo, pronto pra eu revisar com o usuário antes de virar sprint de implementação.
- Nenhuma mudança de código nesta sprint.

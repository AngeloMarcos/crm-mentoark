# Sprint — Implementar roleta de tarefas em grupo de WhatsApp (estrutura pronta, ativação manual depois)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Continuação direta da sprint de desenho já feita (`SPRINT_ROLETA_TAREFAS_GRUPO_WHATSAPP.md`, achados completos em `AUDITORIA_LOG.md` — não repetir o levantamento). **Implementar a estrutura completa agora. Não inserir nenhuma linha em `grupos_ia_permitidos` com `ativo=true` em produção sem confirmação explícita do usuário do JID exato — a conta ainda não tem ninguém em `team_members`, então mesmo ativado o rodízio não teria efeito prático até o usuário cadastrar gente manualmente depois.**

---

## Decisões já tomadas (não reabrir)

- `participantes_ids` como snapshot (array), não JOIN dinâmico com `team_members`.
- Cooldown simples: no máximo 1 tarefa criada a cada 2 minutos por grupo (evita a IA registrar demanda repetida numa conversa movimentada).
- Cadastro de `group_jid` em `grupos_ia_permitidos` é manual via SQL por enquanto — sem tela nova nesta sprint.
- Cadastro de pessoas em `team_members` é responsabilidade do usuário, feito manualmente depois, fora desta sprint — a feature deve ficar pronta e "inofensiva" mesmo com `participantes_ids = '{}'` (sem participantes).

## 1. Tabela `grupos_ia_permitidos`

```sql
CREATE TABLE IF NOT EXISTS grupos_ia_permitidos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_jid         TEXT NOT NULL,
  finalidade        TEXT,
  ativo             BOOLEAN NOT NULL DEFAULT true,
  participantes_ids UUID[] NOT NULL DEFAULT '{}',
  proximo_indice    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  ultima_tarefa_em  TIMESTAMPTZ,
  UNIQUE (user_id, group_jid)
)
```
(`ultima_tarefa_em` adicionada agora — necessária pro cooldown de 2 minutos, não estava no desenho original.)

## 2. Gate no webhook

Em `webhook.ts`, antes do `if (isGroup) return;` atual (~linha 1567): se existir linha ativa em `grupos_ia_permitidos` pra esse `user_id`+`remoteJid`, disparar `processarMensagemGrupoAutorizado(...)` (fire-and-forget com `.catch` de log, mesmo padrão já usado no resto do arquivo) antes do `return`. Todo grupo sem linha ativa continua exatamente como hoje — sem nenhuma mudança de comportamento.

## 3. Handler isolado `processarMensagemGrupoAutorizado()`

Função nova (sugestão: `backend/src/services/grupoTarefaEngine.ts`, separado de `agentEngine.ts` — reforça o "menor raio de impacto" do desenho). Reaproveita `provider.complete(mensagens, systemPrompt, tools, opções)` (mesma abstração de `agentEngine.ts` ~linha 715) resolvendo provider/modelo do agente do usuário, mas:

- System prompt minimalista, só pra classificar "é demanda real?" e extrair resumo — nada de persona de vendas, nada de RAG, nada de histórico de conversa anterior.
- `tools`: só `[CRIAR_TAREFA_GRUPO_TOOL]` — nunca `MCP_TOOLS` completo.
- Sem `n8n_chat_histories`, sem debounce, sem humanização — mensagem isolada, decisão isolada, cada mensagem do grupo é avaliada por si só.
- Se a IA chama a tool → confirmação curta fixa no grupo via `sendText` direto (algo como "Anotado, vou encaminhar isso 👍" — sem @menção, sem expor nome de quem foi atribuído nem detalhe de rodízio). Se não chama nenhuma tool → silêncio total, nenhuma resposta no grupo.

## 4. Ferramenta MCP `criar_tarefa_grupo`

```
{
  name: 'criar_tarefa_grupo',
  description: 'Registra uma demanda de trabalho de um grupo de WhatsApp como tarefa no CRM, atribuída por rodízio. Use SOMENTE para demanda real (pedido, problema, solicitação) — NUNCA para bate-papo, elogio, ou mensagem social.',
  input_schema: { type: 'object', properties: { resumo: { type: 'string', description: 'Resumo objetivo da demanda, uma frase.' } }, required: ['resumo'] },
}
```

Dispatch (`executarFerramenta`, novo `case`), dentro de uma transação com `FOR UPDATE` (mesmo padrão de concorrência já usado em `get_next_disparo_batch`):

1. `SELECT id, participantes_ids, proximo_indice, ultima_tarefa_em FROM grupos_ia_permitidos WHERE id=$1 FOR UPDATE`.
2. **Cooldown**: se `ultima_tarefa_em` for menos de 2 minutos atrás, não criar tarefa — retornar pro LLM algo como "já registrei uma demanda recentemente, aguarde" (a IA decide se fala isso no grupo ou fica em silêncio — não é erro, é comportamento esperado).
3. **Sem participantes**: se `array_length(participantes_ids,1)` for `NULL`/0, não criar tarefa — logar aviso claro (`log.warn`) e retornar mensagem indicando que não há ninguém cadastrado na roleta ainda. Não deve quebrar nem lançar exceção — é um estado esperado até o usuário cadastrar gente.
4. Caso normal: `atribuido = participantes_ids[proximo_indice + 1]` (arrays Postgres são 1-indexed — cuidado no cálculo), `UPDATE grupos_ia_permitidos SET proximo_indice = (proximo_indice+1) % array_length(participantes_ids,1), ultima_tarefa_em = NOW() WHERE id=$1`, depois `INSERT INTO tarefas (user_id, atribuido_a, origem, resumo_ia, remote_jid, contato_nome, contato_telefone, titulo, status) VALUES ($1, $2, 'grupo_whatsapp', $3, $4, $5, $6, $7, 'pendente')` — `titulo` derivado das primeiras ~8 palavras do `resumo`.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (backend). Testar em homolog: **usar um grupo de teste real e de baixo risco já conhecido** (ex: um dos grupos já mapeados no levantamento anterior que não seja o alvo de negócio de verdade — confirmar com bom senso qual serve pra teste sem incomodar ninguém), inserindo manualmente uma linha de teste em `grupos_ia_permitidos` com 1-2 `participantes_ids` de teste (pode usar o próprio `user_id` do admin como participante único só pra validar o fluxo), mandar uma mensagem clara de demanda ("preciso que alguém ligue pro fornecedor X amanhã") e confirmar que vira uma linha em `tarefas` com `atribuido_a` preenchido. Mandar uma mensagem de bate-papo comum em seguida e confirmar que NÃO vira tarefa. Mandar 2 demandas em sequência rápida e confirmar que o cooldown bloqueia a segunda. Remover a linha de teste de `grupos_ia_permitidos` ao final (não deixar nenhum grupo real ativado sem necessidade).

**Não ativar `grupos_ia_permitidos` pra nenhum grupo real de produção nesta sprint** — só a estrutura + teste isolado em grupo de baixo risco. Ativação do grupo de negócio de verdade é uma ação separada, deliberada, depois que o usuário confirmar o JID certo e cadastrar o time.

## AO FINALIZAR, REPORTAR

- Resultado do teste (demanda real → virou tarefa; bate-papo → não virou; cooldown bloqueou segunda mensagem em sequência).
- Confirmação de que a linha de teste em `grupos_ia_permitidos` foi removida.
- Confirmação de que nenhum grupo de produção real ficou com `ativo=true` ao final.
- SQL pronto (comentado, não executado) que o usuário pode rodar depois pra ativar o grupo real, uma vez que tenha o JID confirmado e pessoas em `team_members` — algo como: `INSERT INTO grupos_ia_permitidos (user_id, group_jid, finalidade, participantes_ids) VALUES ('435ee472-0fc3-4015-995a-ae6e1c80606d', '<JID_DO_GRUPO>', 'distribuição de tarefas', ARRAY['<uuid1>','<uuid2>']::uuid[]);`
- Build do backend passou.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

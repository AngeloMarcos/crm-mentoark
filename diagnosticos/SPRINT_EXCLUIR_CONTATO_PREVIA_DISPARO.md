# Sprint — Excluir contato direto na tabela "Contatos selecionados" (prévia de Disparos)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção.

---

## Contexto (confirmado no código atual)

A tabela "Contatos selecionados" (`Disparos.tsx`, `StepReview`, tabela com colunas Nome/Telefone/Situação no CRM/Status de envio/Último envio/Última campanha) não tem nenhuma ação de excluir por linha — só visualização. Usuário reportou (print real, opção "Todos os Leads", 571 contatos) registros claramente inválidos/corrompidos na lista (ex: telefone com 18 dígitos, sem nenhum nome real) sem forma de removê-los ali mesmo.

O backend já suporta excluir contato (`DELETE /api/contatos/:id`, tabela genérica via `makeCrud`) e já existe um precedente funcionando em produção: `Leads.tsx` (~linha 258-266, `removerContato`) já faz `api.from("contatos").delete().eq("id", id)` com confirmação nativa (`confirm("Remover este contato?")`). **Confirmado por leitura de `migrations.ts`: não existe nenhuma `FOREIGN KEY ... REFERENCES contatos(id)` no banco** — ou seja, excluir um contato não dispara `CASCADE` em nenhuma outra tabela (`disparo_logs`, `tarefas`, `kanban`, etc. não têm FK formal pra `contatos.id`); tabelas como `disparo_logs` já guardam telefone/nome como cópia própria (denormalizado), então excluir o contato não quebra histórico de campanhas já enviadas, só deixa de existir como registro de "Lead" pra seleção futura.

## O que fazer

1. Reconfirmar a localização exata da tabela em `Disparos.tsx` (pode ter se movido de linha desde esta sprint ser escrita — várias sprints recentes tocaram esse arquivo). Adicionar coluna/ação nova (ícone de lixeira, canto direito de cada linha) reaproveitando o mesmo padrão de `Leads.tsx`: confirmação nativa, `api.from("contatos").delete().eq("id", id)`.
2. **Atualizar o estado local imediatamente após excluir** (não esperar um refetch completo) — remover o contato de `targetContacts` no componente pai assim que a exclusão for confirmada, pra tabela e contador ("X de Y totais") refletirem na hora, sem recarregar a página inteira (a lista pode ter centenas/milhares de linhas, um refetch completo seria lento).
3. Tratar erro de exclusão com toast (mesmo padrão do resto do arquivo), sem quebrar a tela se falhar.
4. Confirmar que excluir um contato durante a revisão de uma campanha **não afeta** nenhuma campanha/log já existente de antes (dado que não há FK/CASCADE, conforme confirmado acima) — só remove o contato da seleção atual e de futuras.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend). Testar em homolog: criar 2-3 contatos de teste (um deles "sujo", tipo telefone inválido), abrir uma campanha de teste incluindo esses contatos, excluir um pela tabela de prévia, confirmar que ele some da tabela/contador na hora e que o contato realmente não existe mais em `contatos` (consulta real). Confirmar que outros contatos e o restante da campanha não são afetados.

## AO FINALIZAR, REPORTAR

- Confirmação de que a exclusão funciona e atualiza a tela na hora, sem refetch completo.
- Confirmação de que não há efeito colateral em campanhas/dados já existentes.
- Build do frontend limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

# Sprint — Gerenciar listas (excluir/renomear) direto no passo "Por Lista" de Disparos

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção.

---

## Contexto (confirmado no código atual)

O passo "Por Lista" (`Disparos.tsx`, `StepContacts`, ~linha 1023-1113) lista todas as `listas` do usuário pra seleção de alvo de campanha, mas não tem nenhuma ação de excluir/renomear — só checkbox de seleção. A capacidade já existe no backend (tabela `listas` usa `makeCrud` genérico, então `DELETE /api/listas/:id` e `PUT /api/listas/:id` já funcionam) e já tem um precedente funcionando em produção: `Leads.tsx` (~linha 193-202, `removerLista`) já exclui lista com `api.from("listas").delete().eq("id", id)`, confirma via `confirm()` nativo, e deixa claro que os contatos ficam sem lista mas não são apagados (`lista_id` vira null, contato preservado).

**Achado real (print do usuário)**: a tela acumulou várias listas de importação com 0 contatos (`Importação ... 06/08/2026 — 0`, repetidas) — sobra de testes/reimportações. Sem exclusão nem em massa nem individual, isso só cresce.

## O que fazer

### 1. Excluir lista individual (mínimo pedido)

Em cada linha de lista (~linha 1078-1105, dentro do `.map(l => ...)`), adicionar um botão de lixeira pequeno (ícone, canto da linha, `stopPropagation` pra não disparar o toggle de seleção do checkbox por engano) que chama o mesmo padrão de `Leads.tsx`: confirmação nativa ("Remover esta lista? Os contatos ficarão sem lista mas não serão apagados."), `api.from("listas").delete().eq("id", id)`, e depois recarrega a lista de listas (mesmo padrão de `carregar()` já usado em `Leads.tsx` — em `Disparos.tsx`, conferir qual função já busca `listas` hoje e reaproveitar). Se a lista excluída estava selecionada em `form.listas_selecionadas`, remover do array também.

### 2. Renomear lista (extra, baixo custo já que o backend já suporta)

Duplo-clique no nome, ou um ícone de lápis ao lado do de lixeira — abre um input inline ou reaproveita um modal simples (mesmo padrão do modal "Nova Lista" de `Leads.tsx`, ~linha 787-816, mas em modo edição) chamando `PUT /api/listas/:id` com o novo nome.

### 3. Excluir listas vazias em lote (resolve o lixo visível na print)

Botão "Limpar listas vazias" (perto do "Selecionar todas" já existente, ~linha 1026-1037) — usa a contagem que a tela já calcula por lista (`listasCounts[l.id]`, já usado no badge de cada linha) pra identificar `listasCounts[l.id] === 0`, mostra quantas seriam removidas antes de confirmar (ex: "Excluir 6 listas vazias?"), e só então exclui em sequência (uma chamada `DELETE` por lista, não existe endpoint de bulk delete por lista de IDs hoje — confirmar se vale a pena criar um, ou se sequencial é aceitável dado que normalmente são poucas dezenas no máximo).

### 4. Considerar (opcional, avaliar se vale o escopo)

Um aviso/contador no topo da aba tipo "X listas, Y vazias" — ajuda o operador a notar o acúmulo antes de precisar rolar a lista toda pra perceber.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend). Testar em homolog: criar 2-3 listas de teste (uma vazia, uma com contatos), excluir a individual, confirmar que contatos da lista com dado não foram apagados (só `lista_id` virou null); renomear uma lista e confirmar que persiste; usar "Limpar listas vazias" e confirmar que só as vazias somem, as com contato ficam intactas.

## AO FINALIZAR, REPORTAR

- Confirmação de que excluir lista não apaga contato, só desvincula (`lista_id` null) — testado com dado real.
- Confirmação de que renomear persiste.
- Quantas listas vazias existem hoje em produção (se der pra checar) — dá uma ideia real do tamanho do lixo acumulado.
- Build do frontend limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

# Sprint URGENTE — Pausar contas com prompt vazio (segurança) + corrigir 500 em agent-config por nome_agente NULL

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Dois achados do relatório de status completo (`SPRINT_RELATORIO_STATUS_COMPLETO.md`), confirmados: um contra o código local (bug do `nome_agente`), outro reportado por você contra o banco (contas com prompt vazio) — reconfirmar este segundo item lendo direto do banco antes de agir, não assumir que ainda procede exatamente como reportado.

---

## Parte 1 — Pausar `fmakonee03@gmail.com` e `stefanocatedral@hotmail.com` (segurança, autorizado explicitamente pelo usuário)

### Contexto

O guard aplicado em 2026-08-04 (`backend/src/routes/agent-config.ts`, POST/PATCH) impede **escritas novas** de `ativo=true` com `prompt_sistema` vazio, mas nunca corrigiu as duas linhas que já estavam nesse estado antes do guard existir. Relatório de status reportou que essas duas contas seguem `ativo=true` com `prompt_sistema` vazio em produção agora — ou seja, a IA pode estar respondendo cliente real de forma vazia/genérica há tempo indeterminado.

### O que fazer

1. **Reconfirmar antes de agir**: `SELECT user_id, nome_agente, ativo, length(prompt_sistema) FROM agent_configs WHERE user_id IN (<ids de fmakonee03 e stefanocatedral>)` em produção — confirmar que o estado ainda é esse (pode ter mudado desde o relatório).
2. Se confirmado, `UPDATE agent_configs SET ativo = false WHERE user_id = $1 AND (prompt_sistema IS NULL OR prompt_sistema = '')` pras duas contas — **só isso**, não mexer em mais nenhum campo, não apagar nada.
3. Confirmar por leitura de volta que `ativo=false` nas duas.
4. **Não reativar essas contas nesta sprint** — a ativação de verdade depende do dono de cada conta preencher um prompt real (fora do escopo desta correção de segurança).

### Reportar

- Estado real encontrado antes da mudança (confirma ou não o relatório anterior).
- Confirmação da atualização nas duas contas.
- Sugestão de como avisar os dois donos de conta (fora do escopo de código — só uma recomendação de processo).

---

## Parte 2 — Corrigir 500 em `POST /api/agent-config` quando `nome_agente` não é enviado

### Contexto

`backend/src/routes/agent-config.ts` (~linha 85): `nome_agente ?? null` — sempre manda `NULL` explícito no INSERT, mesmo quando o campo não veio no body. A coluna é `NOT NULL DEFAULT 'Cris'` — o default só entra em ação quando a coluna é **omitida** do INSERT, nunca quando `NULL` é passado explicitamente. Resultado: qualquer POST sem `nome_agente` quebra com 500 (`null value in column "nome_agente" violates not-null constraint`), mesmo a coluna tendo um default definido pra cobrir exatamente esse caso.

### O que fazer

Trocar `nome_agente ?? null` (e o mesmo padrão em qualquer outro campo `NOT NULL DEFAULT` da mesma tabela, se houver — conferir o schema completo de `agent_configs` em `migrations.ts`) por uma lógica que **omita** o campo do INSERT quando não vier no body, deixando o Postgres aplicar o `DEFAULT` de verdade — ou, alternativa mais simples, resolver o default no próprio código antes do INSERT (`nome_agente ?? 'Cris'`), sem depender do comportamento do banco. Escolher a abordagem mais consistente com o resto do arquivo (`agent-config.ts` já faz `COALESCE` no `ON CONFLICT`, ver ~linha 62 — considerar se o mesmo padrão de fallback explícito no código, não no banco, é mais previsível aqui).

### PROCESSO (vale pras duas partes)

Seguir `AUDITORIA_PROTOCOLO.md`. Parte 1 é escrita direta em produção (dado real, contas de clientes) — só depois de reconfirmar o estado, sem homolog necessário (não é mudança de código). Parte 2 é mudança de código — testar em homolog: POST sem `nome_agente` deve funcionar (200, não 500) e o valor gravado deve ser sensato (`'Cris'` ou o que for decidido); POST com `nome_agente` explícito continua funcionando sem regressão.

### AO FINALIZAR, REPORTAR

- Resultado da Parte 1 (estado antes/depois, confirmado por leitura direta).
- Abordagem escolhida na Parte 2 e por quê.
- Teste real em homolog confirmando que o 500 não acontece mais.
- Build do backend limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

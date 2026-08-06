# Sprint — Fechar o fix de nome/telefone na saudação (confirmar deploy, rodar backfill, documentar)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Isto **não é uma investigação nova** — é fechamento de uma sprint cujo código já existe no repo local, mas cujo estado de deploy/backfill/documentação está incerto.

---

## Contexto (confirmado por leitura direta do código local, working tree do Cowork — reconfirmar aqui, pode ter mudado)

`diagnosticos/SPRINT_FIX_NOME_TELEFONE_SAUDACAO.md` descreve um bug real já confirmado com prova (campanha "Importação ...cnpj_biz..." enviada com saudação tipo "Oi 5511984849872, tudo tranquilo?"). Lendo `src/pages/Disparos.tsx` hoje, os itens 1 e 2 daquele sprint **parecem aplicados**:

- Fallback de importação (`analisarLinhasImportacao`, comentário `[AUDITORIA] FIX APLICADO` datado 2026-08-05): `nome: nome || empresa || telefone`.
- Proteção em `substituirPlaceholders()` (mesmo arquivo, comentário `[AUDITORIA] FIX APLICADO` datado 2026-08-05): quando `contato.nome === contato.telefone`, o placeholder é removido com `removerPlaceholderVazio()` em vez de expor o telefone cru na mensagem.

O que **não está confirmado**:
- **Item 3 do sprint original** (backfill `UPDATE contatos SET nome = empresa WHERE user_id = $1 AND nome = telefone AND empresa IS NOT NULL AND empresa <> ''`) — nenhum rastro de ter rodado, nem em homolog nem em produção.
- **Deploy** — `STATUS.md` não tem nenhuma entrada de sessão sobre esse fix (procurado por "cnpj_biz", "5511984849872", trecho do bug — nada encontrado). Não dá pra saber, só lendo os arquivos locais, se isso já foi commitado/deployado ou se ainda está só no working tree.
- **Documentação** — nem `STATUS.md` nem `diagnosticos/AUDITORIA_LOG.md` têm entrada sobre isso.
- O arquivo `diagnosticos/SPRINT_DIAGNOSTICO_IMPORTACAO_NOME_ERRADO.md` (investigação genérica que esse sprint substituiu) ainda existe — deveria ter sido apagado junto, pelo protocolo de absorção.

## O que fazer

### 1. Reconfirmar o estado real antes de mexer em qualquer coisa

- `git log`/`git diff` em `src/pages/Disparos.tsx` — o fix já está commitado? Em qual branch? Já foi deployado (comparar contra `/opt/crm/src/pages/Disparos.tsx` e `/opt/crm-homolog/src/pages/Disparos.tsx` na VPS, mesmo padrão de `sha256sum`/`diff` já usado em sessões anteriores)?
- Se **não** estiver commitado: revisar o diff local com calma (mesmo padrão de outras sessões — não commitar sem entender o que está mudando), então decidir com o usuário antes de commitar.
- Se **já** estiver commitado mas não deployado: seguir pro passo 2 normalmente (homolog primeiro).
- Se já estiver deployado em produção: pular pro passo 3 (backfill) direto, sem re-deployar à toa.

### 2. Deploy (se ainda não aconteceu) — homolog primeiro, sempre

Usar `scripts/deploy.sh homolog src/pages/Disparos.tsx`. Testar como descrito no `PROCESSO` do sprint original: reimportar um CSV/XLSX de teste sem coluna de nome de pessoa mas com razão social → contato deve nascer com nome da empresa, não o telefone; contato sintético com `nome === telefone` → mensagem final não deve expor o telefone como saudação, sem espaço duplo/vírgula solta; contato com nome real → sem regressão. Só depois de validado, `scripts/deploy.sh prod --confirm`.

### 3. Backfill (item 3 do sprint original, dado real de produção)

Antes de rodar em produção, rodar primeiro um `SELECT COUNT(*)` com o mesmo filtro pra saber o tamanho do impacto:
```sql
SELECT user_id, COUNT(*) FROM contatos
WHERE nome = telefone AND empresa IS NOT NULL AND empresa <> ''
GROUP BY user_id;
```
Reportar esse número ao usuário antes de rodar o `UPDATE` de verdade (mesmo cuidado já usado em sessões anteriores antes de escrever em produção — nunca assumir, sempre mostrar o tamanho do impacto primeiro). Só depois:
```sql
UPDATE contatos SET nome = empresa
WHERE nome = telefone AND empresa IS NOT NULL AND empresa <> '';
```
Rodar por `user_id` explícito se o usuário preferir revisar conta por conta, em vez de todas de uma vez — decidir com o usuário antes de rodar em todas as contas ao mesmo tempo (mesmo cuidado do incidente `users.owner_id`: nunca uma escrita em massa cruzando contas sem confirmação explícita).

### 4. Absorver e limpar os documentos antigos (regra do protocolo)

Depois de confirmado que o código e o backfill estão de acordo com o que os dois arquivos descreviam:
- Apagar `diagnosticos/SPRINT_FIX_NOME_TELEFONE_SAUDACAO.md` (conteúdo já virou comentário `[AUDITORIA]` no código — confirmar que os comentários realmente cobrem o que o doc pedia antes de apagar).
- Apagar `diagnosticos/SPRINT_DIAGNOSTICO_IMPORTACAO_NOME_ERRADO.md` (investigação genérica, já substituída por este caso concreto).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Não pular a reconfirmação do passo 1 — é o que vai determinar se esta sprint é "só backfill + documentar" ou "backfill + deploy + documentar".

## AO FINALIZAR, REPORTAR

- Estado real encontrado no passo 1 (commitado? deployado em homolog? em produção?) — com evidência (hash de commit, diff contra a VPS, ou confirmação de que já estava tudo deployado).
- Se houve deploy nesta sprint: resultado dos 3 testes reais em homolog antes de produção.
- Número de contatos afetados pelo backfill (por `user_id`, antes de rodar) e quantos foram de fato atualizados, em qual(is) ambiente(s) (homolog/produção).
- Confirmação de que os dois documentos antigos foram apagados (ou por que não, se algo não bateu).
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` com o resumo completo desta sprint (isso é o que estava faltando desde o início).

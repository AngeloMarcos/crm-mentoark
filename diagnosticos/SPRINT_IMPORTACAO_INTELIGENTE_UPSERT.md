# Sprint — Importação de contatos: upsert (não quebrar lote inteiro) + resumo novos/existentes + validação determinística de linha suspeita

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção, sempre — nenhum deploy de produção sem `scripts/deploy.sh prod --confirm`.

---

## Contexto (já confirmado no código atual, não precisa reinvestigar)

Importação de contatos em Disparos (`src/pages/Disparos.tsx`, `confirmarImportacao`) hoje faz um único `POST /api/contatos` com o array inteiro de contatos analisados (`api.from("contatos").insert(novos.map(...))`, ~linha 773-780). Esse POST cai no bulk-insert genérico de `backend/src/crud.ts` (`makeCrud`, rota `POST /`, ~linha 229-252): monta um `INSERT INTO contatos (...) VALUES (...), (...), ... RETURNING *` de uma vez só, **sem `ON CONFLICT`**.

Existe um índice único real em produção protegendo contra duplicata: `idx_contatos_user_tel_unique` em `contatos(user_id, telefone) WHERE telefone IS NOT NULL` (`backend/src/migrations.ts`, ~linha 51-55 — o próprio comentário no código já dizia "habilita ON CONFLICT", mas nenhum caller usa isso hoje). Resultado: se **qualquer uma** das linhas do lote violar esse índice (telefone já existe pra esse `user_id`, ou dois telefones iguais dentro do próprio arquivo), o Postgres rejeita o `INSERT` inteiro com erro `23505` — a query inteira falha, nenhuma linha do lote é gravada, e o operador só vê um toast genérico (`insertError.message`, cru, direto do driver `pg`) sem saber quantos contatos eram novos de verdade nem quais telefones colidiram.

`analisarLinhasImportacao` (mesma arquivo, ~linha 171-267) já faz uma pré-validação de telefone (formato/tamanho) e mostra um resumo antes do clique em "Confirmar Importação" (`preAnalise`, ~linha 736-739) — mas essa pré-validação não consulta o banco, então não sabe dizer quantos desses telefones "válidos" já existem na conta. O bloqueio de reenvio por cooldown (`disparos.cooldown_horas`, `get_next_disparo_batch`) já existe e já funciona — isso é sobre a criação/atualização do **contato**, não sobre disparar mensagem pra ele.

## Decisão do usuário (já resolvida, não reabrir)

1. Trocar o insert por upsert real (`ON CONFLICT ... DO NOTHING`, preservando o contato existente intocado — nome/notas/tags/status de um lead que já está sendo trabalhado não devem ser sobrescritos por uma reimportação de planilha).
2. Mostrar no resumo (antes de confirmar) quantos são novos vs. já existentes na conta.
3. Validação de linha suspeita: **só regra determinística, sem IA** (custo zero por importação — decisão explícita, motivada pelo incidente recente de esgotamento de crédito OpenAI). Sinaliza, não bloqueia — o operador decide se ainda quer importar.

## O que fazer

### 1. Backend — endpoint dedicado de importação em lote (não mexer no `makeCrud` genérico)

Não alterar o `POST /` genérico de `backend/src/crud.ts` — ele é compartilhado por todas as tabelas que usam `makeCrud`, e um `ON CONFLICT` fixo em `(user_id, telefone)` não faz sentido pra outras tabelas. Criar rota nova e específica em `backend/src/routes/contatos.ts` (mesmo arquivo que já tem os overrides de `contatos`, ex: `POST /status-envio`), algo como `POST /contatos/importar-lote`:

- Body: array de contatos já sanitizados pelo frontend (mesmo formato que `confirmarImportacao` monta hoje: `nome, telefone, email, empresa, cargo, notas, origem, status, tags, lista_id`) — reaproveitar a validação de telefone que já existe no frontend, não duplicar em SQL.
- SQL: `INSERT INTO contatos (...) VALUES (...), (...) ON CONFLICT (user_id, telefone) WHERE telefone IS NOT NULL DO NOTHING RETURNING id, telefone`. **Atenção**: o índice de destino é parcial (`WHERE telefone IS NOT NULL`) — o `ON CONFLICT` precisa repetir esse `WHERE` na cláusula de inferência, senão o Postgres não reconhece o índice como alvo válido e o comando falha (`there is no unique or exclusion constraint matching the ON CONFLICT specification`). Testar isso especificamente antes de dar como pronto.
- `user_id` sempre do JWT (`req.userId`), nunca do body — mesmo padrão de segurança já usado no resto do arquivo (não repetir o incidente de config vazando entre contas; aqui o risco é menor por ser só o próprio `user_id` do token, mas mesmo assim nunca aceitar `user_id` vindo do client).
- Resposta: `{ inseridos: number, jaExistiam: number, telefonesJaExistiam: string[] }` — usar o `RETURNING` (que só traz as linhas que **entraram de verdade**, `ON CONFLICT DO NOTHING` não retorna as que colidiram) comparado contra a lista de telefones enviada, pra calcular `jaExistiam` por diferença.
- Envolver em transação (`BEGIN`/`COMMIT`, ou uma única query já é atômica por natureza — confirmar que o driver `pg` não precisa de transação explícita pra um único `INSERT` multi-linha; se decidir por transação mesmo assim, documentar por quê).
- Fazer o `INSERT` em lotes de no máximo ~500 linhas por query (mesmo teto já usado em outros pontos do sistema, ex: paginação de `fetchAllContatos`) se o array de entrada for maior que isso — evita um único `INSERT` gigante com milhares de `VALUES`.

### 2. Frontend — trocar a chamada de import + mostrar resumo real antes de confirmar

`Disparos.tsx`, `confirmarImportacao` (~linha 741-804): trocar `api.from("contatos").insert(...)` pela chamada ao endpoint novo (`POST /contatos/importar-lote`). Ajustar o toast final pra usar os números reais devolvidos pelo backend (`X importado(s) · Y já existia(m) na sua base`), em vez de assumir que tudo que passou na validação de telefone foi de fato inserido.

Pré-validação (`preAnalise`, ~linha 736-739, mostrado ANTES do clique em "Confirmar Importação"): hoje só valida formato de telefone, sem tocar o banco. Pra mostrar "novos vs. já existentes" nesse resumo (pedido explícito do usuário), decidir entre duas abordagens e documentar qual foi escolhida:
- (a) Endpoint leve extra, tipo `POST /contatos/checar-telefones` (recebe array de telefones já sanitizados, devolve quais já existem pra esse `user_id`) — chamado assim que o arquivo é carregado, antes de qualquer clique em confirmar.
- (b) Só mostrar o número real depois de confirmar (o endpoint de importação já devolve os contadores) — mais simples, mas não cumpre literalmente "no resumo de pré-importação".

Recomendação: (a), é pouco código a mais (uma query `SELECT telefone FROM contatos WHERE user_id=$1 AND telefone = ANY($2::text[])`) e entrega o que foi pedido de verdade. Decidir e implementar; se escolher (b), justificar no relatório final por que se desviou do pedido original.

### 3. Validação determinística de linha suspeita (parte 2 da decisão do usuário — sem IA)

Em `analisarLinhasImportacao` (`Disparos.tsx`, ~linha 171-267), adicionar um terceiro balde ao retorno (`AnaliseImportacao`, hoje só tem `novos/totalLinhas/corrigidos/descartados`) — algo como `suspeitos: { linha: number; motivo: string }[]`. **Sinaliza, nunca descarta** — a linha suspeita continua entrando em `novos`, só ganha um aviso visível no resumo de pré-importação. Regras determinísticas sugeridas (implementar as que fizerem sentido, ajustar conforme achar necessário, mas manter tudo sem custo de IA):

- **Nome parece ser telefone**: campo nome, depois de tirar espaços/pontuação, é só dígitos com 8+ caracteres (cobre o caso raiz que já motivou `SPRINT_FIX_NOME_TELEFONE_SAUDACAO.md` — aquela correção já existe como rede de segurança na hora de montar a mensagem, `substituirPlaceholders`, mas o operador continua sem visibilidade NA IMPORTAÇÃO de que a planilha não tinha nome de pessoa pra aquela linha).
- **Telefone com padrão de placeholder/teste**: todos os dígitos iguais (`11111111111`) ou sequência óbvia (`12345678900`, `123456789...`) depois da sanitização — comum em planilha de teste/exemplo que vazou pra um arquivo real.
- **DDD fora da lista de DDDs brasileiros válidos**: conferir contra a lista real de DDDs (11-19, 21-24, 27, 28, 31-38, 41-49, 51, 53-55, 61-69, 71, 73-75, 77, 79, 81-87, 89, 91-95, 96-99) — telefone com DDD que não existe é sinal de coluna errada ou dígito faltando/sobrando que passou pela sanitização por coincidência de tamanho.
- **Telefone duplicado dentro do próprio arquivo** (duas linhas da mesma planilha com o mesmo telefone após sanitização) — hoje isso silenciosamente vira 2 tentativas de insert pro mesmo `(user_id, telefone)`; com o upsert do item 1 isso deixa de quebrar o lote, mas o operador não fica sabendo que a planilha tinha duplicata interna, então vale sinalizar aqui também.

Resumo de pré-importação (UI, `TabsContent value="csv"`, ~linha 1042-1090): mostrar contagem de suspeitos com o motivo mais comum, sem travar o botão "Confirmar Importação".

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Testar em homolog antes de produção, sempre:

1. Reconfirmar contra o código atual (pode ter mudado desde esta sprint ser escrita) — não assumir que os números de linha acima ainda batem exatamente.
2. `npm run build` (frontend) e `npm run build` (backend) limpos antes de qualquer deploy.
3. Teste real em homolog: (a) importar um CSV com 3 telefones que já existem na conta de teste + 2 novos — confirmar que os 2 novos entram, os 3 existentes NÃO são sobrescritos (conferir `updated_at`/`nome` antes e depois) e o resumo final mostra `2 importados · 3 já existiam`; (b) importar um CSV com telefone duplicado dentro do próprio arquivo — confirmar que não quebra mais o lote inteiro; (c) importar um CSV com pelo menos 1 linha de cada categoria suspeita (nome=telefone, DDD inválido, telefone repetitivo/sequencial) — confirmar que aparecem sinalizadas no resumo mas ainda são importadas; (d) importar um CSV totalmente limpo (sem suspeitos, sem duplicata) — confirmar que não regride o fluxo normal.
4. Confirmar que o `ON CONFLICT` com índice parcial funciona de fato (não só compila) — é o ponto mais fácil de dar errado nesta sprint.
5. Só depois de validado em homolog com dado real, pedir confirmação antes de deployar em produção (`scripts/deploy.sh prod --confirm`).

## AO FINALIZAR, REPORTAR

- Qual abordagem foi escolhida pra pré-validação de novos/existentes (item 2, opção a ou b) e por quê.
- Resultado de cada um dos 4 testes reais em homolog (item 3), com números reais (não só "funcionou").
- Confirmação explícita de que um contato já existente NÃO teve nenhum campo sobrescrito pela reimportação (antes/depois do `nome`/`notas`/`tags`/`updated_at`).
- Lista final das regras determinísticas de linha suspeita realmente implementadas (pode divergir da lista sugerida acima, se alguma não fizer sentido na prática).
- Build limpo nos dois lados.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
- Se algo ficar de fora do escopo (ex: revisão assistida por IA opcional, que o usuário decidiu NÃO fazer nesta sprint), registrar como pendência clara pra decisão futura, não implementar de surpresa.

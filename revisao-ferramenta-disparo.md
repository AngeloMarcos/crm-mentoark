# Revisão completa — Ferramenta de Disparo (crm-mentoark)

Data: 2026-07-29

## Como o fluxo funciona hoje

`src/pages/Disparos.tsx` é um wizard de 4 passos: **Lista de Contatos → Mensagem → Proteção Anti-ban → Revisar e Agendar**. Só no último passo (`StepReview`) existe o botão real de início (`Disparar Agora` / `Agendar Disparo`) — ele grava uma linha em `disparos` e uma linha por contato em `disparo_logs` (status `pending`). O envio de fato não acontece nessa hora: um motor separado (`backend/src/services/disparoProcessor.ts`, chamado por um cron) varre `disparo_logs` pendentes e manda cada mensagem pela Evolution API, respeitando janela de horário, delay anti-ban, limite diário e pausa por erros consecutivos.

Achei o código do motor de disparo (`disparoProcessor.ts`) e das rotas (`backend/src/routes/disparos.ts`) num estado bem maduro — cheio de comentários `[AUDITORIA]` de revisões anteriores documentando bugs já corrigidos (round-robin de instâncias, retry com backoff, teto diário, etc.). Não achei problema novo nessa parte do motor de envio em si.

## O bug — por que "salvar a lista" não parece levar a lugar nenhum

Achei a causa raiz, e ela bate exatamente com o que aparece no seu print (lista mostra badge **107**, mas o preview mostra **"100 de 100 totais"**).

### Causa: toda busca de contatos-alvo tem um teto silencioso de 100

`backend/src/crud.ts`, na rota genérica `GET /`, usada por toda tabela (inclusive `contatos`):

```ts
const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
```

Se ninguém pedir um `limit` explícito, o backend devolve **no máximo 100 linhas** — sempre, silenciosamente, sem erro nenhum.

Em `Disparos.tsx`, as três formas de selecionar destinatários (por lista, por tag, por estágio — inclusive a lista recém-criada pela importação de CSV/XLSX) chamam:

```ts
api.from("contatos").select("id, nome, telefone, lista_id, opt_out").in("lista_id", form.listas_selecionadas)
```

sem `.limit(...)` em nenhum lugar. O `QueryBuilder` do frontend (`src/integrations/database/client.ts`) só manda um `limit` pro backend se `.limit()` for chamado explicitamente — não é chamado aqui. Resultado: **`targetContacts` nunca tem mais que 100 registros**, não importa se a lista/tag/estágio filtrado tem 107, 500 ou 5000 contatos.

Isso explica o "100 de 100" do seu print: o preview mostra corretamente 100 de "100 totais" — mas esses "100 totais" já são o resultado truncado, não o tamanho real da lista (107, que é o número certo, mostrado à parte pela contagem `head: true`/`count: exact`, que essa sim não tem LIMIT e reflete o total real).

### Por que isso parece "não iniciar o disparo"

Não é que o botão de iniciar desapareça — é que:

1. O `handleStart` em `StepReview` usa exatamente esse `targetContacts` truncado para criar os `disparo_logs`. Então mesmo clicando em "Disparar Agora", **só as 100 primeiras pessoas da lista entram na fila de envio** — as outras 7 (ou centenas, em listas maiores) são descartadas sem aviso nenhum, sem erro, sem log.
2. Isso é ainda mais grave em listas grandes: uma campanha para 5.000 contatos, pensada pra rodar por horas/dias, na prática dispara para 100 e para — sem status de erro, porque do ponto de vista do sistema "deu tudo certo", só que a fila nunca teve os outros 4.900.

Ou seja: o problema real não é "falta a opção de iniciar" — é que o disparo em massa está **mudo e capado em 100 destinatários**, o que numa ferramenta cujo propósito é "disparo em massa" é essencialmente quebrar a funcionalidade principal pra qualquer lista de leads um pouco maior.

### Achado secundário (UX, não bug de dados)

No passo "Lista de Contatos", o `Próximo` só habilita quando **nome da campanha preenchido E pelo menos 1 contato selecionado** (`stepValid`, linha ~283). No seu print, os 100 contatos já estavam selecionados, mas o campo "Nome da Campanha" estava vazio — daí o aviso "Informe o nome da campanha" ao lado do botão desabilitado. Isso é comportamento intencional do código, mas a forma como aparece (hint pequeno, cinza, ao lado do botão) é fácil de não notar — pode ter contribuído pra sensação de "não dá a opção", mesmo sendo um problema separado do teto de 100.

## Resumo para priorização

| Achado | Severidade | Onde |
|---|---|---|
| Teto de 100 contatos em toda busca de alvo (lista/tag/estágio/importação) sem paginação | **Crítico** — quebra o propósito central da ferramenta pra qualquer lista >100 | `backend/src/crud.ts` (limite default) + `Disparos.tsx` (nenhuma chamada usa `.limit()` nem pagina) |
| Aviso "Informe o nome da campanha" pouco visível quando `Próximo` está desabilitado | Baixa — UX, não perde dados | `Disparos.tsx`, `StepContacts`/stepper do componente pai |

## Recomendação (sem implementar ainda, como pedido)

O teto de 100 precisa de uma correção estrutural, não só de trocar um número: mesmo subindo o `limit` pra 500 (o teto máximo que `crud.ts` aceita hoje), qualquer lista acima disso volta a quebrar do mesmo jeito. As opções realistas são:

1. Criar um endpoint dedicado (ex: `GET /disparos/target-contacts`) que devolve todos os `id`/`telefone` que casam com o filtro sem paginação — só os dois campos que o disparo precisa, então o payload fica leve mesmo para milhares de linhas.
2. Ou fazer o frontend paginar (`limit`/`page`) e concatenar até esgotar os resultados, tanto na contagem ao vivo (`fetchCount`) quanto no `handleStart` — mais simples de implementar, mais chamadas de rede pra listas grandes.

A opção 1 é mais robusta pra esse caso de uso (é literalmente "me dê todos os contatos que batem com esse filtro pra eu enfileirar o disparo"); a 2 reaproveita a infra atual sem mexer no backend genérico.

Quer que eu implemente a correção agora, ou isso vai para o Antigravity/Gemini como os outros achados?

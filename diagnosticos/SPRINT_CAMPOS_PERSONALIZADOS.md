# Sprint Campos Personalizados do Contato

Data: 2026-11-11 · Origem: relatório de lacunas do Cubo (`engenharia_reversa_suite/RELATORIO_LACUNAS_CUBO_2026-11-04.md`),
Prioridade 3 (campos personalizados para pessoa, usados em filtros, na IA e na API).
Status: em desenvolvimento.

## O que muda

1. **Cadastro por conta** (`/contatos/campos`, menu CRM → Campos Personalizados). Campo tem nome, tipo
   (texto, número, moeda, data, lista de uma opção, lista de várias, sim/não), opções (nas listas),
   "IA preenche" com orientação opcional, e ordem. A **chave** (ex.: `orcamento_mensal`) é gerada do nome
   na criação e **não muda** ao renomear — é o nome do campo na API e no filtro. Trocar o tipo depois de
   criado é bloqueado (os valores já gravados seguem o tipo). Excluir = desativar: o valor fica guardado
   no contato e volta se o campo for reativado (`?todos=1` lista os inativos). Limite: 100 campos ativos.

2. **Valor por contato** em `contatos.campos` (jsonb, índice GIN). Entrada tolerante, gravação
   normalizada: moeda/número aceitam "R$ 3.500,00", "5 mil", "2,5k"; data aceita dd/mm/aaaa e
   aaaa-mm-dd (guarda aaaa-mm-dd); seleção casa sem diferenciar maiúsculas e guarda a opção oficial;
   múltipla aceita lista ou "manhã, noite"; sim/não aceita sim/não/true/false. Valor vazio/null apaga
   só aquele campo. Lote com chave desconhecida ou valor fora do tipo é recusado inteiro (nada grava).

3. **Telas que mostram/editam**: painel do contato na conversa (`WhatsAppInterface`, seção "Campos do
   contato", some se a conta não tem campos) e ficha do lead (`Leads.tsx`, aba Dados — salvam à parte,
   com botão próprio). Filtro na lista de Leads (campo + "contém"; vazio = preenchido) e em
   `GET /api/contatos?cf_<chave>=...`.

4. **IA** (`registrar_campo`): o motor injeta no prompt a "FICHA DO CLIENTE" com os campos ativos
   marcados "IA preenche" e o que já está registrado; a ferramenta tem enum dos nomes. O registro é
   imediato (não espera a resposta sair, diferente do funil — não muda nada que o cliente veja), com as
   mesmas validações; valor inválido volta como erro para a IA. Playground: só preview, nada gravado.
   Sem nenhum campo liberado, a IA nem fica sabendo que o recurso existe.

5. **API /v1**: `GET /custom-fields`; `customFields` no contato (leitura) e no corpo de
   `POST/PUT /peoples` (mescla; `null` apaga); filtro `cf_<chave>=valor` em `GET /peoples`
   (texto: contém; demais: igual ao valor normalizado). Erros 422 `unknown_custom_field` /
   `invalid_value`. Documentado no OpenAPI.

## Decisões

- **Escopo = conta** (`users.owner_id`), como motivos/atendimento: membro vê e edita os campos da conta.
- Valores em **jsonb no contato** (não tabela N:N): leitura junto com o contato em todas as telas e na
  /v1 sem join; filtro usa `@>` com o índice GIN. O catálogo (`campos_personalizados`) é a fonte de
  verdade de tipo/opções.
- `cidade`/`estado`/`interesse`/`data_nascimento` (colunas de 2026-09-11) continuam como estão — não
  migram para campos personalizados nesta sprint.

## Arquivos

Backend: `services/camposPersonalizados.ts` (puras + banco), `routes/camposPersonalizados.ts`
(`/api/campos-personalizados`), filtro em `routes/contatos.ts`, `/v1` em `routes/apiPublica.ts` +
`apiPublicaDocs.ts`, motor em `services/agentEngine.ts`, migração em `migrations.ts`
(tabela + `contatos.campos` + GIN). Testes: `tests/campos_personalizados.test.ts` (17).

Frontend: `lib/camposPersonalizados.ts`, `pages/CamposPersonalizados.tsx` (rota `/contatos/campos`),
`components/campos/CamposDoContato.tsx`, seção no `WhatsAppInterface.tsx`, aba Dados + filtro em
`pages/Leads.tsx`, item no `AppSidebar.tsx`.

E2E (homolog e prod): scratchpad `testa_campos.js` — cadastro (6 tipos, 409/400), valores (normalização,
lote atômico, null apaga), filtros `/api` e `/v1`, isolamento entre contas, ferramenta da IA, OpenAPI,
excluir preserva valor.

## Fora desta sprint

Filtros salvos, organizações, campos de produto (`custom_fields` do catálogo, que é outra coisa),
campo personalizado em disparos/variáveis de template, relatório por campo (`funnel.customfield` do Cubo).

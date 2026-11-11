# Cubo × nosso CRM — o que ainda falta (2026-11-04)

Fonte: catálogo das 835 rotas internas do painel do Cubo (`suite_rotas_internas_tuyau.json`, capturado em
2026-10-29), cruzado com `backend/src/routes/*` e `src/pages/*` de hoje. O REA não conectou nesta sessão,
então nenhuma tela nova do Cubo foi aberta: o que está abaixo vem dos nomes das rotas, não do
comportamento exercitado.

Já feito desde 10-29 (não repetir): API /v1 + API Keys, funil que anda sozinho, integrações num lugar só,
agente em página própria, canais (número → agente), bases de conhecimento com indexação, execuções
(`agente_execucoes`), teste da IA com a config da tela.

## Prioridade 1 — Atendimento na conversa (maior lacuna)

O Cubo trata a conversa como um **atendimento com dono e ciclo de vida**. O nosso não tem isso: o próprio
`WhatsAppInterface.tsx` registra que "o modelo não tem atendente responsável por conversa". `InboxPanel.tsx`
e `routes/conversas.ts` (assign/status) são das Sprints A–D, que só existem em `crm_hml` e não estão
roteadas em produção.

| Cubo (`conversations.*`) | Nós |
|---|---|
| `assign` / `unassign` / `transfer` (com **motivo de transferência**) | não existe em prod |
| `resolve` (com **motivo de resolução**) / `reopen` | não existe |
| `pauseBot` por X min / `unpauseBot` / `returnToBot` | só liga/desliga a IA (`/ia-toggle`, `pausa-ia`) |
| `notes` (nota interna na linha do tempo, por mensagem) | uma anotação única no contato (`contatos.notas`) |
| `sendTemplate` no chat | não existe no chat |
| `start` / `startFromContact` (abrir conversa nova) | parcial |
| `contactBlock` | parcial |
| `messageReaction` (reagir) | só exibe reação recebida |
| `pauseReasons` (motivo de pausa do atendente) | não existe |

Por que primeiro: os relatórios de atendimento (P2), o "transferir para humano" da IA e o `sentBy: human`
da API dependem de existir atendente + estado da conversa.

## Prioridade 2 — Relatórios

Cubo: `reports.conversations` (summary, **liveops**, agents, distribution, reopens, timeline) e
`reports.funnel` (summary, state, users, customfield, proposals, **lostreason**, harvest,
**timeToClose**, **velocity**). Nós: `CentralBI.tsx`, `Dashboard.tsx`, `SLA.tsx`, sem tempo de primeira
resposta/resolução por atendente nem velocidade do funil. Os de funil já são possíveis com `funil_eventos`;
os de conversa precisam da P1.

## Prioridade 3 — Negócio no funil

- **Ganhar/perder com motivo cadastrado** (`deals.win/lose` + `lostreasons`). Hoje as etapas Ganho/Perdido
  existem, mas o motivo é texto livre e não há cadastro de motivos.
- **Campos personalizados** (`customfields`) para pessoa/negócio, usados em filtros, na IA (chip
  "campo personalizado") e no relatório `funnel.customfield`. Nós: não existe (só `custom_fields` de produto).
- **Filtros salvos** (`filters.*`). Nós: não existe.
- **Organizações** (empresa do contato). Nós: não existe.

## Prioridade 4 — IA (o que sobrou do plano IA-3..IA-5)

- `agents.executions.rerun`: "reexecutar com a configuração atual" e comparar lado a lado. Temos o log, falta o rerun.
- `agents.handoffTargets`: para quem a IA transfere (usuário/departamento). Depende da P1.
- `agents.followUp`: follow-up por campo perseguido dentro da janela de 24h (IA-5).
- `custom-intents` (+ `test`): intenções cadastradas e testáveis. Nós: não existe.
- Ferramentas como chips no prompt (IA-3).

## Prioridade 5 — Operação e captação

- `activity-trails`: cadências (sequência de atividades). Nós: só tarefas soltas no kanban.
- `activities` com `bulkComplete`, `toggleNoShow` (não compareceu), compartilhar atividade.
- `forms` públicos + `landings` (page builder) + `google_lead_webhook`. Nós: smart links.
- `imports.revertDeals` (desfazer uma importação) e `exports` assíncronos.
- `peoples.reconcile` (achar e mesclar duplicados) e `trash` (lixeira com restaurar).
- `message-queues.pause/resume/reprocessFailed` nos disparos.
- `stickers` (figurinhas salvas da conta).

## O que não vale copiar

- `tenant.*`, `billing`, `modules.recharge`, `impersonation`, `super-admin`: são do white-label/revenda.
- `verdata`, `rd`, `zapi`, `calcom`, `google_ads`: integrações específicas; só se algum cliente pedir.
- "Ocultar identidade de IA": vai contra a política da Meta.

## Sugestão de próxima entrega

**Atendimento v1**: `conversa_atendimentos` (conversa, atendente, departamento, estado
aberta/pendente/resolvida, bot pausado até, timestamps de 1ª resposta e resolução), motivos
(transferência/resolução/pausa) num cadastro só com `tipo`, notas internas na linha do tempo e, na conversa, os
botões atribuir, transferir, resolver, reabrir, pausar a IA por X min e devolver à IA. Antes de começar, decidir
se o InboxPanel e as tabelas das Sprints A–D de homolog são reaproveitados ou descartados.

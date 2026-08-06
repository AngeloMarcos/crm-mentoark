# Sprint — CRÍTICO: campanha agendada nunca é enviada (fica presa em 'rascunho' pra sempre)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Achado confirmado lendo `src/pages/Disparos.tsx`, `backend/src/migrations.ts` e `backend/src/services/disparoProcessor.ts` nesta sessão — não é suposição.

---

## ACHADO — "Agendar Disparo" cria a campanha e as mensagens, mas elas nunca saem

`Disparos.tsx`, `StepReview.handleStart` (linhas ~827-887): ao clicar "Agendar Disparo" (`now = false`), a campanha é criada com:

```js
status: now ? 'em_andamento' : 'rascunho',
agendado_para: now ? null : agendarAt,
```

Ou seja, uma campanha agendada nasce com `status = 'rascunho'`. Os `disparo_logs` (uma linha por contato, `status: 'pending'`) já são criados normalmente nesse mesmo fluxo.

O motor que efetivamente processa e envia mensagens é `processarDisparos()` (`disparoProcessor.ts`, roda a cada 2s via `setInterval` em `backend/src/index.ts` linha ~500), que chama a função SQL `get_next_disparo_batch()` (`migrations.ts` linhas ~572-620). Essa função tem, entre as condições do `WHERE`:

```sql
WHERE l.status = 'pending'
  AND d.status = 'em_andamento'
  AND (d.agendado_para IS NULL OR d.agendado_para <= NOW())
  ...
```

**Confirmado por leitura completa do backend: não existe, em lugar nenhum do sistema, algo que transforme `disparos.status` de `'rascunho'` para `'em_andamento'`** — nem um cron, nem um trigger de banco, nem uma checagem dentro de `processarDisparos()` antes de chamar `get_next_disparo_batch()`. A cláusula `(d.agendado_para IS NULL OR d.agendado_para <= NOW())` está morta na prática: mesmo que o horário agendado já tenha passado, a linha nunca passa pelo filtro `d.status = 'em_andamento'`, que vem antes.

**Resultado real:** o usuário clica "Agendar Disparo", vê o toast de sucesso ("Campanha agendada!"), a campanha e as mensagens ficam no banco — e nunca são enviadas. Nenhum erro aparece em lugar nenhum; do ponto de vista do usuário parece que "sumiu".

---

## FIX

Adicionar, no início de `processarDisparos()` (`disparoProcessor.ts`, antes da chamada a `get_next_disparo_batch`) ou como uma função separada chamada no mesmo `setInterval` de `index.ts`, uma promoção de campanhas agendadas cujo horário já chegou:

```sql
UPDATE disparos
SET status = 'em_andamento', updated_at = NOW()
WHERE status = 'rascunho'
  AND agendado_para IS NOT NULL
  AND agendado_para <= NOW()
```

Pontos de atenção:
1. O filtro `agendado_para IS NOT NULL` é proposital — evita mexer em qualquer outro uso futuro de `'rascunho'` sem data (ex: um "salvar como rascunho" que venha a existir depois, sem agendamento) que porventura não deva ser promovido automaticamente. Se `AUDITORIA_LOG.md`/o schema mostrarem hoje que `'rascunho'` só é usado por este fluxo de agendamento, ok manter o filtro do mesmo jeito (defensivo, não custa nada).
2. Rodar isso no mesmo cron de 2s é aceitável (a query é leve, um `UPDATE` simples com índice em `status`/`agendado_para` se existir — checar se vale criar um índice `(status, agendado_para)` em `disparos`, dado que essa combinação passa a ser consultada a cada 2s).
3. Depois de promovida pra `'em_andamento'`, a campanha segue o fluxo normal (mesmo lote do `get_next_disparo_batch`, sem precisar de nenhuma outra mudança).
4. Cuidado com concorrência: usar `WHERE` simples é suficiente aqui (não precisa de `FOR UPDATE`/lock especial — é só uma transição de status, e mesmo que rode em duplicidade por causa de múltiplas réplicas do backend, um `UPDATE` idempotente não causa dano).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (backend, tsc) depois da mudança. Testar em homolog: criar uma campanha de teste (poucos contatos, ex: 1-2 números de teste) agendada pra ~2-3 minutos no futuro, confirmar que ela realmente muda de `'rascunho'` pra `'em_andamento'` sozinha quando a hora chega (consulta direto no banco: `SELECT status, agendado_para FROM disparos WHERE id = '...'`) e que as mensagens saem de verdade pro WhatsApp de teste.

## AO FINALIZAR, REPORTAR

- Confirmação de que a promoção `rascunho` → `em_andamento` foi implementada e onde (arquivo/linha).
- Teste real em homolog: campanha agendada criada, confirmado que mudou de status sozinha e que a mensagem chegou no WhatsApp de teste dentro da janela esperada.
- Se foi criado índice novo em `disparos`, qual e por quê.
- Build do backend passou.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

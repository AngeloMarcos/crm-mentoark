# Sprint — Separar chave da OpenAI de homolog e produção (crédito compartilhado)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Continuação direta do diagnóstico de consumo de crédito de IA já executado (`SPRINT_DIAGNOSTICO_CONSUMO_TOKEN_IA.md`, achados completos em `AUDITORIA_LOG.md` — não repetir o levantamento).

---

## Contexto

O diagnóstico anterior confirmou que a IA da conta Mentoark (e das outras 3 contas ativas do sistema — `fmakonee03@gmail.com`, `stefanocatedral@gmail.com`, `angelobispofilho@gmail.com`) está **fora do ar desde 28/07**, autopausada 5 vezes por falta de crédito/chave inválida (`ia_pausa_log`). Causa principal identificada: `OPENAI_API_KEY` é uma chave de plataforma única, compartilhada por todas as contas sem provider próprio configurado (`ai_providers` está vazio em produção) — e **essa mesma chave é idêntica entre produção e homologação** (confirmado por hash). Todo teste que já fizemos em homolog nas sprints anteriores desta sessão (Disparos, Stella, grupos) consumiu o mesmo saldo que a Mentoark usa em produção de verdade.

**Escopo desta sprint, por decisão explícita do usuário**: só separar a chave de homolog da de produção. As outras duas frentes do diagnóstico (contas-cliente sem provider próprio dependendo do fallback compartilhado; duplicação de chamada Vision/Whisper) ficam para sprints futuras, não mexer nelas aqui.

## O que fazer

1. **Confirmar o estado atual antes de mexer**: comparar hash/valor de `OPENAI_API_KEY` em `/opt/crm/backend/docker-compose.yml` (produção) e `/opt/crm-homolog/backend/docker-compose.yml` (homolog) — confirmar que batem, documentar o valor mascarado (últimos 4 caracteres) de cada um antes da mudança, pra ter registro do que era "antes".
2. **Obter a chave nova**: o usuário vai gerar uma chave nova na OpenAI (idealmente um Project separado com teto de gasto, se a conta suportar) especificamente para homolog. Se ela ainda não foi passada nesta sessão, **parar e pedir explicitamente** — não seguir com placeholder, não inventar valor, não reaproveitar nenhuma outra chave já existente no sistema (ex: não usar a de outra conta cliente).
3. **Atualizar só homolog**: editar `OPENAI_API_KEY` em `/opt/crm-homolog/backend/docker-compose.yml` para o valor novo. **Não tocar em `/opt/crm/backend/docker-compose.yml` (produção)** — confirmar visualmente, depois da edição, que o diff toca só o arquivo de homolog.
4. **Rebuild + restart isolado**: dentro de `/opt/crm-homolog/backend`, `docker compose build --no-cache crm-api-homolog && docker compose up -d crm-api-homolog`. Não rodar `docker compose` na raiz nem em `/opt/crm` — evitar qualquer risco de afetar produção por engano.
5. **Validar a separação**:
   - `/health` do `crm-api-homolog` → 200.
   - Sem `ERROR` nos logs recentes do container.
   - Uma chamada de IA de teste real em homolog (mensagem de teste simples pra um contato de teste já existente, não um cliente real) completando com sucesso — confirmar isso pelo log da chamada em si (não só o `/health` respondendo), e confirmar que o `ai_uso_diario`/log equivalente registra a chamada usando a chave nova.
   - Confirmar que produção continua respondendo normalmente e usando a chave antiga (um `/health` de produção + checagem rápida de que o container de produção não foi reiniciado por engano).
6. **Registrar o que ficou pendente pra não perder de vista**: deixar explícito no `STATUS.md`/`AUDITORIA_LOG.md` que as outras 2 frentes do diagnóstico de consumo (contas-cliente sem provider próprio dependendo do fallback; duplicação Vision/Whisper) continuam em aberto, não fazem parte desta sprint.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Não mexer em produção nesta sprint — nem no `docker-compose.yml`, nem reiniciando o container, nem em nenhuma tabela do banco de produção além do que já é normal (nenhuma mudança de schema aqui, é só configuração/credencial). Se o usuário não tiver a chave nova em mãos, parar e avisar — não inventar/gerar valor nenhum. Se por qualquer motivo a chave nova falhar na validação (ex: chave inválida, sem crédito), reverter o `docker-compose.yml` de homolog pro valor antigo, reportar o erro exato retornado pela OpenAI, e não deixar o `crm-api-homolog` rodando com uma chave quebrada.

## AO FINALIZAR, REPORTAR

- Confirmação de que a chave de homolog agora é diferente da de produção (valores mascarados, últimos 4 caracteres de cada, antes/depois).
- Confirmação explícita de que produção não foi tocada (arquivo, container, nem reiniciado).
- Resultado do teste de IA em homolog usando a chave nova, com evidência de log.
- Se algo falhou e precisou de rollback, o que exatamente falhou.
- Lista clara do que ainda fica pendente pra sprints futuras (contas sem provider próprio; duplicação Vision/Whisper) — só pra registro, não implementar.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

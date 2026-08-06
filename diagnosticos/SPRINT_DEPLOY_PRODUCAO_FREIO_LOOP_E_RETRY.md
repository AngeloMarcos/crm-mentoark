# Sprint — Deploy em produção: freio anti-loop bot-a-bot + maxRetries:1

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Deploy em produção, autorizado explicitamente pelo usuário nesta sessão.** Já validado em homolog com teste real (loop simulado, isolamento por conta/telefone, falso positivo checado) — ver `SPRINT_FREIO_LOOP_BOT_E_RETRY_OPENAI.md` e `AUDITORIA_LOG.md` pro relatório completo, não repetir os testes de homolog aqui.

---

## Arquivos a deployar

- `backend/src/services/agentEngine.ts` (circuit breaker + `maxRetries: 1`, 2 ocorrências)
- `backend/src/services/providers/index.ts` (`maxRetries: 1`)
- `backend/src/services/index.ts` (`maxRetries: 1` — mesmo sendo aparentemente órfão/sem import real, manter a mudança por completude, já que foi confirmado em homolog; **não excluir nem investigar o achado do arquivo órfão nesta sprint**, é assunto separado)
- `backend/src/routes/suporte.ts` (`maxRetries: 1`)
- `backend/src/routes/suporte_copiloto.ts` (`maxRetries: 1`)
- `backend/src/services/suporte.ts` (`maxRetries: 1`)

Nenhuma migração de banco nova nesta sprint (o circuit breaker reaproveita `dados_cliente.atendimento_ia`/`contatos.atendente_pausou_ia`/`ia_pausa_log`, tabelas já existentes em produção).

## O que fazer

1. Usar `scripts/deploy.sh prod --confirm` com os arquivos acima — não montar comando manual de `scp`/`ssh` na mão.
2. Validação padrão do script (`/health` + grep por `ERROR` nos logs recentes) — conferir que passou limpo.
3. **Validação extra específica desta mudança**, depois do deploy: confirmar que o `crm-api` de produção voltou a responder normalmente pra uma conversa comum (não deve ter nenhuma mudança de comportamento visível pra conversas abaixo do limite de 6 mensagens/3min) — não precisa simular loop de verdade em produção (já foi validado em homolog), só confirmar que uma mensagem de teste isolada gera resposta normal.
4. Confirmar que nenhuma conta com pausa manual pré-existente (`atendente_pausou_ia=true` de antes do deploy, por motivo não relacionado a loop) foi afetada/alterada pelo deploy — é só código novo, não deveria mexer em dado existente, mas vale conferir.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Produção primeiro precisa do `--confirm` explícito (já dado pelo usuário nesta sessão, mas o script continua exigindo o flag). Se `/health` ou os logs mostrarem qualquer `ERROR` novo após o deploy, parar e reportar antes de considerar concluído — não seguir adiante achando que "provavelmente é normal".

## AO FINALIZAR, REPORTAR

- Confirmação do deploy (arquivos, `/health`, logs limpos).
- Resultado da validação extra (conversa normal funcionando, pausas pré-existentes intactas).
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` confirmando que o freio anti-loop e o `maxRetries:1` estão agora em produção, com a data.

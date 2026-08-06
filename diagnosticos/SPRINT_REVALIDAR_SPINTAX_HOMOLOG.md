# Sprint — Revalidar spintax em homolog, com o processo corrigido pós-incidente

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro — em especial a seção nova "Testes que mandam mensagem real via WhatsApp (regra desde 2026-08-06, incidente 'spintax em produção')". Esta sprint existe só pra fechar o ciclo do incidente anterior: o código do spintax já está confirmado funcionando (rodou de verdade, só que sem querer em produção) — falta uma validação de homolog genuína, seguindo a regra nova, pra ficar registrada.

---

## Contexto

O teste anterior da sprint `SPRINT_MOTOR_VARIACAO_MENSAGEM_SEM_IA.md` foi relatado como "homolog" mas rodou em produção de verdade (causa raiz: JWT assinado localmente + URL escrita à mão, ver `SPRINT_URGENTE_TESTE_VAZOU_PARA_PRODUCAO.md` e o incidente já documentado em `STATUS.md`/`AUDITORIA_LOG.md`, 2026-08-06). Resultado prático: o código funcionou (mensagens variaram de verdade, bloco sem pipe ficou literal), mas não existe hoje um teste genuíno de homolog registrado pra essa feature.

## O que fazer

1. **Seguir a regra nova ao pé da letra**: rodar o teste de dentro do container de homolog (`docker exec crm-api-homolog ...` ou equivalente — reaproveitar `DATABASE_URL`/`JWT_SECRET` reais do próprio container, nunca gerar JWT local nem escrever a URL da API à mão).
2. Criar uma campanha de teste em homolog com uma mensagem usando spintax (`{Oi|Olá|E aí}, {{primeiro_nome}}! {Temos uma novidade|Passando pra te contar algo novo} pra você.` — mesmo exemplo de antes, já que sabemos que produz resultado visível) — mandar pra 3+ contatos de teste **cadastrados em homolog** (não reaproveitar o contato de teste "Angelo"/5511979579548 se ele também existir em produção com o mesmo número — usar um contato exclusivo de homolog, ou confirmar antes que o envio realmente vai sair pela instância/Evolution de homolog, `fierceparrot-evolution.cloudfy.live`, não a de produção).
3. **Confirmar por leitura direta no banco de homolog** (`crm_hml`, não `crm`) que as linhas de `whatsapp_messages`/`disparo_logs` caíram lá — não assumir, checar de verdade, mesma exigência da regra nova.
4. Confirmar visualmente (print ou log) que o envio realmente saiu pela instância/Evolution de homolog, não produção.
5. Ao final, apagar os dados de teste criados (contato/campanha/mensagens), mesmo padrão de higiene já usado em sprints anteriores.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`, incluindo a regra nova da seção de testes com mensagem real. Não usar JWT local nem URL escrita à mão em nenhum momento desta sprint.

## AO FINALIZAR, REPORTAR

- Confirmação de que o teste rodou de fato dentro do container de homolog.
- Confirmação (via `SELECT` direto no banco `crm_hml`) de que as mensagens de teste caíram em homolog, não produção.
- Resultado da variação (textos reais recebidos, como no teste anterior).
- Confirmação de que os dados de teste foram limpos ao final.
- Atualizar `STATUS.md` fechando o ciclo: a sprint do motor de variação passa a ter uma validação de homolog genuína registrada.

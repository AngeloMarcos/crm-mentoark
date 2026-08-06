# Sprint URGENTE — Teste de spintax apareceu em produção, não em homolog (relatório anterior pode estar incorreto)

Cole este prompt inteiro no Claude Code (CLI) **antes de qualquer outra sprint, inclusive antes de confiar no deploy de produção que acabou de ser feito na sprint do motor de variação**. Ler `AUDITORIA_PROTOCOLO.md` primeiro. Isto é investigação de um desvio entre o que foi relatado e o que aconteceu de verdade — tratar com a mesma seriedade dos incidentes históricos já documentados (config vazando entre contas — "Cris"; fallback de `users.owner_id` misturando 10 contas).

---

## Contexto (confirmado por print de tela real, produção — `crm.mentoark.com.br`)

O relatório da sprint `SPRINT_MOTOR_VARIACAO_MENSAGEM_SEM_IA.md` afirmou: *"Testado em homolog: 3 mensagens de teste... chegaram diferentes de verdade no WhatsApp de teste: 'Oi, Ana! Temos uma novidade pra voce.' / 'Ola, Bruno! Temos uma novidade pra voce.' / 'Ola, Carla! Passando pra te contar algo novo pra voce.'"* — texto que é literalmente o exemplo de spintax escrito dentro da própria sprint (`{Oi|Olá|E aí}, {{primeiro_nome}}! {Temos uma novidade|Passando pra te contar algo novo} pra você.`).

O usuário confirmou por print de tela que essas exatas 3 mensagens **estão na tela de Conversas de PRODUÇÃO** (`crm.mentoark.com.br`), não homolog — contato "Mentoark" (5511979579548), instância `crm_435ee4720fc3_2` (já documentada em `STATUS.md`, sessão 2026-07-31, como a segunda instância da conta produção `mentoark@gmail.com`, `user_id 435ee472-0fc3-4015-995a-ae6e1c80606d`). Além disso, **cada mensagem de teste foi enviada DUAS VEZES** (mesmo texto, mesmo minuto, 2 balões idênticos consecutivos) — isso não está descrito em nenhum relatório.

**Isto é uma discrepância real entre relatório e realidade — não assumir qual das duas coisas está errada sem investigar.** Hipóteses possíveis, nenhuma delas descartada de antemão:

1. O teste "em homolog" na verdade usou a API/URL/instância de produção por engano (ex: script de teste apontando pra `api.mentoark.com.br` em vez de `api-homolog.mentoark.com.br`, ou `EVOLUTION_API_URL` de produção usado por engano).
2. A instância `crm_435ee4720fc3_2` existe (ou existia, com esse nome) tanto em homolog quanto em produção, e o teste bateu na de produção por coincidência de nome/config compartilhada.
3. O envio duplicado sugere possível reprocessamento/retry — investigar se o mesmo teste rodou 2x sem perceber, ou se há uma duplicação de infraestrutura (ex: dois webhooks, duas instâncias respondendo ao mesmo tempo).
4. O relatório está descrevendo testes que genuinamente rodaram em homolog, mas o print do usuário é de OUTRA coisa (ex: alguém testou manualmente pela tela de Conversas de produção, sem relação com a sprint) — improvável dado que o texto bate exatamente com o exemplo da sprint, mas não descartar sem confirmar.

## O que fazer

1. **Reconstruir exatamente o que a sprint anterior rodou**: qual URL de API foi usada pra mandar as 3 mensagens de teste (`api.mentoark.com.br` ou `api-homolog.mentoark.com.br`)? Qual banco (`crm` produção ou `crm_hml` homolog) tem o registro dessas mensagens (`disparo_logs`/`whatsapp_messages`, buscar pelo texto exato ou pelo horário de hoje)? Qual token JWT foi usado (de qual ambiente)?
2. **Confirmar se `crm_435ee4720fc3_2` é a mesma instância física em homolog e produção, ou duas coisas diferentes com nome parecido** — checar `integracoes_config`/`agent_configs` nos dois bancos.
3. **Explicar o envio em dobro** — checar se o script/comando de teste rodou 2x, se há retry automático em algum ponto do envio de teste, ou outra causa.
4. **Avaliar dano real**: as mensagens foram pro número de teste de sempre ("Angelo", 5511979579548, já usado em múltiplas sessões anteriores para testes reais) — não é um cliente real. Mas confirmar que NENHUMA outra mensagem de teste (desta ou de sprints anteriores no mesmo dia) foi parar em contato real de produção. Checar `whatsapp_messages`/`disparo_logs` de hoje, produção, por qualquer texto que pareça teste sintético (nomes "Ana"/"Bruno"/"Carla", ou similares) fora do número de teste conhecido.
5. **Corrigir a causa raiz** antes de rodar qualquer novo teste — se for URL/config errada, corrigir o script/processo de teste usado pelas sprints (documentar claramente, talvez em `AUDITORIA_PROTOCOLO.md`, uma checagem obrigatória de "confirmar ambiente antes de mandar mensagem real de teste").
6. **Re-validar a sprint do motor de variação**: se o teste realmente vazou pra produção, o teste "em homolog" relatado ali não prova o que deveria provar. Repetir o teste de verdade em homolog (URL/ambiente confirmados desta vez) antes de considerar aquele deploy de produção como validado.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Esta sprint é prioridade máxima — não seguir para nenhuma outra tarefa (inclusive `SPRINT_DISPAROS_VARIACAO_IMAGEM.md` ou `SPRINT_INVESTIGAR_DIVERGENCIA_DISPARO_PROCESSOR.md`) até isso estar esclarecido. Não mandar nenhuma mensagem de teste nova até confirmar com certeza qual ambiente está sendo usado.

## AO FINALIZAR, REPORTAR

- Qual das hipóteses (1-4 acima, ou outra) explica o que aconteceu, com evidência concreta (não suposição).
- Confirmação de que nenhum contato real de produção recebeu mensagem de teste, além do número de teste conhecido.
- Explicação do envio duplicado.
- Correção aplicada no processo de teste para isso não se repetir.
- Se a sprint do motor de variação precisa ser re-validada (e o resultado dessa re-validação, se rodada aqui).
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` com o incidente completo — tratar como incidente registrado, mesmo padrão dos incidentes "Cris"/`users.owner_id` já documentados no projeto.

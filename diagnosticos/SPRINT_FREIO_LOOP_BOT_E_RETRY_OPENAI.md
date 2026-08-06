# Sprint — Freio contra loop bot-a-bot + limitar retry automático do SDK OpenAI

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Continuação direta do diagnóstico de custo de IA já feito (`SPRINT_DIAGNOSTICO_APROFUNDADO_CUSTO_IA.md`, achados em `AUDITORIA_LOG.md`/memória de projeto — não repetir a investigação). Os dois itens desta sprint foram escolhidos como prioridade máxima porque previnem a repetição do incidente real já ocorrido, não são só otimização de custo do dia a dia.

---

## Contexto

O pico de 154 mil tokens de 28/07 (atribuído inicialmente à conta `fmakonee03`) não foi uso real — foi um **loop bot-a-bot**: 67 mensagens em 54 minutos, a cada 10-15s, entre a IA e um número que também recebia respostas automáticas de outra IA (conteúdo confirma: o lado "cliente" sempre começava com `*Stella*\n...`, a própria assinatura que o sistema usa nas respostas que envia — nenhum humano no meio depois da primeira mensagem). O antiloop atual (`botSentTexts`/`botMessageIds`, `messageId.startsWith('resp_'|'manual_')`) protege contra o bot ecoar a própria mensagem dentro da mesma conta, mas não protege contra duas contas diferentes (ou dois números quaisquer) ficando presas respondendo uma à outra indefinidamente — o texto recebido, vindo de outro bot, é indistinguível de uma mensagem humana legítima pra esse mecanismo.

Achado complementar: o SDK oficial `openai` (v4.103.0) tem retry automático embutido nunca desabilitado em nenhum dos 7 pontos onde `new OpenAI({...})` é instanciado — default é 2 tentativas extras (3 no total) em respostas 429/5xx. Durante o esgotamento de crédito (28-31/07), isso amplificou tráfego contra a própria causa do problema.

## Parte 1 — Freio universal contra loop de mensagens (circuit breaker por contato)

**Objetivo**: independente da causa (loop bot-a-bot entre contas, um bug futuro qualquer, ou até um cliente/atendente testando de forma repetitiva), se o bot mandar muitas mensagens seguidas pro mesmo número num intervalo curto, ele deve parar sozinho e sinalizar pra revisão humana — em vez de continuar indefinidamente até alguém notar o crédito acabando.

1. Implementar um contador por `user_id + telefone`, no mesmo espírito dos Maps em memória já usados no arquivo (`botSentTexts`, padrão de TTL) — a cada mensagem que o bot efetivamente ENVIA (não recebe) pra um número, registrar o timestamp. Antes de gerar uma nova resposta pra esse número, checar: quantas mensagens o bot mandou pra esse mesmo número nos últimos N minutos?
2. **Limite inicial sugerido**: mais de 6 mensagens enviadas pro mesmo número em menos de 3 minutos → considerar loop, não conversa humana normal (uma pessoa real dificilmente troca 6+ mensagens com o bot em menos de 3 minutos de forma sustentada). Deixar esses dois números (limite de mensagens, janela de tempo) como constantes nomeadas e fáceis de ajustar depois — não hardcode espalhado, um lugar só.
3. **Ação ao disparar o freio**: pausar automaticamente a IA pra esse contato específico, reaproveitando o mecanismo já existente (`dados_cliente.atendimento_ia = 'pause'` e/ou `contatos.atendente_pausou_ia = true`, mesmo padrão já usado pelo fluxo de pausa manual) — não um mecanismo novo. Logar em nível de alerta (`log.error` ou equivalente que já se destaque nos logs) com contexto suficiente pra investigar depois (`user_id`, `telefone`, quantas mensagens, em quanto tempo). Não precisa (nem deve, nesta sprint) implementar notificação externa (e-mail/push) — só log claro e pausa automática já resolve o problema de custo; notificação fica pra outra sprint se fizer falta.
4. **Escopo por conta**: o contador é sempre `user_id + telefone` — nunca cruzar contas na contagem (uma conta não deve pausar por causa do volume de outra).
5. Reativação: mesma reativação manual já existente (palavra de reativação, ou o atendente desmarcando a pausa na tela) — não precisa de fluxo de "auto-reativar depois de X minutos" nesta sprint.

## Parte 2 — Limitar retry automático do SDK OpenAI

Nos 7 pontos onde `new OpenAI({...})` é instanciado sem `maxRetries` explícito:
- `backend/src/services/agentEngine.ts` (linhas ~30 e ~70, `criarClienteOpenAI`)
- `backend/src/services/index.ts` (~linha 100)
- `backend/src/services/providers/index.ts` (~linha 100)
- `backend/src/routes/suporte_copiloto.ts` (~linha 277)
- `backend/src/routes/suporte.ts` (~linha 411)
- `backend/src/services/suporte.ts` (~linha 411)

Adicionar `maxRetries: 1` (não `0` — zero retry é frágil demais pra falha transitória de rede legítima; 1 já corta a amplificação de 3 tentativas totais pra 2, sem eliminar toda tolerância a falha) em todos os pontos acima. Confirmar que nenhum desses pontos já tinha alguma lógica própria de retry por cima (evitar duplicar proteção desnecessariamente, mas também não é grave se sobrepuser).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (backend). Testar em homolog:
- **Parte 1**: simular um loop real — mandar 7+ mensagens de teste rápidas (menos de 3 minutos) pro mesmo número de teste e confirmar que a IA para de responder automaticamente depois do limite, e que `atendimento_ia`/`atendente_pausou_ia` fica marcado como pausado pra esse contato específico. Confirmar que um número DIFERENTE, usado normalmente ao mesmo tempo, não é afetado (isolamento por telefone). Confirmar que uma conversa normal de poucas mensagens não aciona o freio por engano.
- **Parte 2**: não precisa simular erro 429 de verdade (arriscado gastar crédito de propósito) — só confirmar por leitura de código/teste unitário simples que `maxRetries: 1` está de fato sendo passado nos 7 pontos, e que uma chamada bem-sucedida normal continua funcionando sem mudança de comportamento visível.

## AO FINALIZAR, REPORTAR

- Confirmação do teste de loop simulado: quantas mensagens até acionar o freio, se a pausa automática funcionou, se o log de alerta apareceu com contexto suficiente.
- Confirmação de que contas/telefones diferentes não se afetam entre si.
- Confirmação dos 7 pontos com `maxRetries: 1` aplicado.
- Build do backend passou.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md` — deixar claro que isso é uma correção de segurança/custo motivada por um incidente real já ocorrido (28/07), não uma feature nova.

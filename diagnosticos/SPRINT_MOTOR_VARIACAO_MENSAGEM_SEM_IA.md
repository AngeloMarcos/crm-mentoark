# Sprint — Motor de variação de mensagem sem IA (spintax) + reduzir gasto de token do "Humanizar com IA"

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. Testar em homolog antes de produção, sempre.

---

## Contexto (confirmado no código atual)

Toda campanha de Disparos nasce com `humanizar_ia: true` por padrão (`Disparos.tsx`, ~linha 396, `form` inicial) — o toggle "Humanizar com IA" (`StepAntiBan`, ~linha 1774-1788) já começa **ligado**, o operador precisaria desligar manualmente pra evitar o custo. Quando ligado, `disparoProcessor.ts` (~linha 394-429) chama `humanizarMensagem()` (`backend/src/services/humanizationService.ts`) **uma vez por contato dentro do loop de envio**, sempre com a chave global `OPENAI_API_KEY` (modelo `gpt-4o-mini`), nunca a chave/provider configurado pelo usuário. Existe um cache em memória por texto-base da campanha, mas só reaproveita variação já gerada em 70% das vezes **depois** de já ter acumulado 5 variações reais — ou seja, uma campanha de 1000 contatos gera algo como ~300 chamadas reais à OpenAI, não 1. Este é o "gasto de token" que o usuário reportou, e é comportamento **padrão**, não uma exceção.

Já existe uma pesquisa registrada nesta sessão sobre regras da Meta/WhatsApp que embasa a prioridade certa aqui — resumo:

- A própria política de spam da WhatsApp Business Platform (2026) lista "mensagens idênticas repetidas para listas grandes sem personalização" como uma de cinco categorias centrais de spam, ao lado de frequência excessiva e taxa de bloqueio/denúncia acima de 2-3% ([PostEngage, WhatsApp Spam Policy 2026](https://postengage.ai/blog/whatsapp-spam-policy-2026)).
- Para números não-oficiais (que é o caso deste CRM, via Evolution/Baileys — não há integração com a Cloud API oficial da Meta hoje, confirmado por busca no código), o sinal de risco mais citado é volume alto de **texto byte-idêntico** em pouco tempo pra contatos que não esperam a mensagem — não a ferramenta em si ([WASenderApi, Anti-Ban Guide](https://wasenderapi.com/blog/stop-getting-banned-the-ultimate-whatsapp-anti-ban-strategy-for-unofficial-apis-in-2025); [Wapisimo, Unofficial API Ban Risk](https://wapisimo.dev/blog/en/whatsapp-unofficial-api-ban-risk)).
- Ritmo humano (delay, perfis de velocidade), aquecimento de número novo, e evitar picos de bloqueio/denúncia importam tanto quanto variar o texto.

**Achado que muda a prioridade**: o sistema já reduz boa parte desse risco de forma barata e já implementada — `substituirPlaceholders()` já troca `{{nome}}`/`{{primeiro_nome}}`/`{{telefone}}`/`{{empresa}}` por contato antes de qualquer humanização, então uma campanha que usa `{{primeiro_nome}}` na mensagem **já não manda texto byte-idêntico pra todo mundo**, mesmo sem IA nenhuma. O caso de maior risco real é uma campanha que não usa nenhum placeholder — aí sim é texto idêntico pra centenas/milhares de destinatários, o padrão que as fontes acima citam como sinal mais forte de spam.

## O que fazer

### 1. Motor de variação determinística (spintax) — zero custo de IA

Novo suporte a **spintax** na própria mensagem digitada pelo operador: sintaxe `{opção 1|opção 2|opção 3}` (chave simples + pipe — não confundir com `{{placeholder}}`, que usa chave dupla e nunca tem pipe; o parser precisa ignorar `{{...}}` e só tratar como spintax blocos `{...}` com pelo menos um `|` dentro). Exemplo de mensagem que o operador poderia escrever:
```
{Oi|Olá|E aí}, {{primeiro_nome}}! {Temos uma novidade|Passando pra te contar algo novo} pra você.
```

- Nova função pura, ex. `resolverSpintax(texto: string): string`, que troca cada bloco `{a|b|c}` por uma opção escolhida aleatoriamente. Local recomendado: perto de `substituirPlaceholders` em `Disparos.tsx` (mesmo arquivo, mesmo padrão de função pura reaproveitável entre prévia e envio real) — não precisa de mudança no backend, porque `disparo_logs.mensagem_enviada` já é resolvido por contato no frontend, em `StepReview.handleStart` (~linha 1921, `mensagem_enviada: substituirPlaceholders(...)`). Encadear `resolverSpintax(substituirPlaceholders(...))` ali já garante uma escolha **independente por contato**, sem precisar tocar em `disparoProcessor.ts`.
- Prévia em `StepMessage` (~linha 1401-1435, `substituirPlaceholders(textoAtivo, {...})`): mostrar o resultado resolvido uma vez (já ajuda o operador a visualizar), com uma nota clara tipo "cada envio real sorteia uma combinação diferente" — não prometer que a prévia é o texto exato que todo mundo vai receber.
- Adicionar a mesma dica de sintaxe perto de onde já existem os atalhos `{{nome}}`/`{{primeiro_nome}}`/etc — tanto em `StepMessage` (`Disparos.tsx`) quanto em `DisparoTemplates.tsx` (~linha 468, mesmo texto de ajuda "Use {{nome}}...").
- Validação leve: se um bloco `{...}` não tiver `|` dentro, tratar como texto literal (não é spintax, não quebrar a mensagem) — cobre o caso de alguém usar chave simples por outro motivo.

### 2. Nudge de "mensagem sem nenhuma personalização" (achado da pesquisa, barato de implementar)

Quando o texto final da campanha (`form.mensagem` ou `form.legenda_midia`, conforme `tipo_midia`) não tiver **nenhum** placeholder (`{{nome}}`/`{{primeiro_nome}}`/etc) **nem** nenhum bloco spintax, mostrar um aviso visível (não bloqueante, mesmo espírito da decisão já tomada nesta sessão sobre importação: avisa, não trava) em `StepMessage` ou `StepReview`: algo como "Esta mensagem vai sair idêntica para todos os destinatários — considere usar {{primeiro_nome}} ou variações {a|b} para reduzir risco de bloqueio." Isso é literalmente o cenário de maior risco segundo a política oficial de spam citada acima.

### 3. Reduzir a dependência do toggle "Humanizar com IA" sem removê-lo

- Trocar o default de `form.humanizar_ia` de `true` pra `false` (~linha 396) — o motor de spintax do item 1, quando usado, já cobre a variação sem custo; a humanização por IA vira reforço opcional pra quem quiser pagar por paráfrase mais sofisticada, não o comportamento padrão de toda campanha.
- Atualizar o texto do toggle (~linha 1778-1781) pra deixar claro o trade-off: algo como "Reescreve cada mensagem via IA (OpenAI) para variação adicional — tem custo por envio. O sistema já varia mensagens com placeholders/spintax sem custo; use isto só se quiser um nível extra de variação."
- Não mudar o comportamento de campanhas já criadas/agendadas (`humanizar_ia` já gravado por campanha em `disparos` — só o default de campanha NOVA muda).

### 4. Não escopo desta sprint, mas linkar

`diagnosticos/SPRINT_DISPAROS_VARIACAO_IMAGEM.md` já existe, pronta pra rodar, cobrindo o mesmo problema pro lado de **imagem** (hash de arquivo idêntico por campanha hoje) — mesma motivação de anti-fingerprint, mesma filosofia de solução barata (perturbação leve via `sharp`, sem custo de IA). Não implementar aqui, só citar como próximo passo natural do mesmo tema — perguntar ao usuário se quer rodar em seguida.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend). Testar em homolog: (a) campanha de teste com spintax + placeholder, 3+ contatos reais — confirmar que cada `disparo_logs.mensagem_enviada` ficou diferente entre si (não só o nome, a escolha de spintax também); (b) mensagem com bloco `{...}` sem pipe — confirmar que não quebra, vira texto literal; (c) campanha sem nenhum placeholder/spintax — confirmar que o aviso aparece; (d) confirmar que uma campanha nova nasce com `humanizar_ia: false`, mas o toggle continua funcionando normalmente se o operador ligar manualmente (chamada à OpenAI ainda acontece, sem regressão nessa parte).

## AO FINALIZAR, REPORTAR

- Sintaxe de spintax implementada, com exemplo real testado (mensagem com 2+ blocos, confirmação de que contatos diferentes receberam combinações diferentes).
- Confirmação de que `{{placeholder}}` (chave dupla) nunca é confundido com spintax (chave simples + pipe).
- Onde o aviso de "mensagem sem personalização" foi colocado (tela/componente) e se é bloqueante ou só visual (deve ser só visual, conforme pedido).
- Confirmação do novo default (`humanizar_ia: false`) e do texto atualizado do toggle.
- Estimativa de quantas chamadas à OpenAI uma campanha de mesmo tamanho deixa de fazer por padrão (comparar antes/depois, mesmo que estimado).
- Build do frontend limpo.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.
- Perguntar ao usuário se quer seguir com `SPRINT_DISPAROS_VARIACAO_IMAGEM.md` (mesmo tema, lado imagem) como próxima sprint.

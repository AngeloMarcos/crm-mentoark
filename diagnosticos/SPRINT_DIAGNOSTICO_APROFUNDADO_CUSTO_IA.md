# Sprint — Diagnóstico aprofundado de custo de IA + opções reais de economia

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Diagnóstico e recomendação — não trocar modelo nem configuração de nenhuma conta sem aprovação explícita, mesmo que pareça óbvio.** Continuação do diagnóstico de consumo já feito (`SPRINT_DIAGNOSTICO_CONSUMO_TOKEN_IA.md`) — não repetir o que já foi levantado (volume por tipo de chamada, chave compartilhada, duplicação Vision/Whisper já confirmada). Esta sprint aprofunda 4 pontos que ficaram sem resposta e mapeia opções concretas de economia.

---

## Contexto sobre modelos (pra alinhar terminologia antes de investigar)

Não existe um modelo atual da OpenAI chamado "GPT-3 mini" — os modelos disponíveis hoje na família GPT relevantes pro caso são, do mais caro pro mais barato, aproximadamente: `gpt-4.1` (o que 3 das 4 contas ativas usam hoje) → `gpt-4o` → `gpt-4o-mini` (o mais barato que ainda suporta visão, necessário aqui já que o sistema manda imagem pro modelo) → `gpt-3.5-turbo` (mais barato ainda, mas sem suporte a visão — quebraria a análise de imagem se usado como modelo principal). `gpt-4o-mini` já é o fallback padrão do código (`'gpt-4o-mini'` hardcoded como default em `agentEngine.ts`) — a razão de 3 contas estarem pagando mais caro é que elas têm um `ai_providers`/config explícito sobrepondo esse default pro `gpt-4.1`, não uma falha do sistema.

## 1. O pico de 154 mil tokens da conta fmakonee03 (28/07) — bug ou uso real?

154 mil tokens de entrada em 73 mensagens dá uma média de ~2.100 tokens de entrada por mensagem — plausível pra conversa real com histórico+prompt grande, mas precisa confirmar que não é sintoma de algo errado:
- Consultar `ai_uso_diario`/logs desse dia especificamente pra essa conta: as 73 mensagens correspondem a 73 conversas de clientes diferentes, ou poucas conversas com MUITAS mensagens repetidas (sinal de loop)?
- Cruzar com `botSentTexts`/`botMessageIds` (mecanismo antiloop) — algum sinal de que o antiloop falhou pra essa conta especificamente nesse dia?
- Medir quantas dessas 73 mensagens bateram no limite de 5 iterações do loop agêntico (se o log de produção não tiver isso — já reportado como lacuna — adicionar um log leve por iteração agora, só contagem, sem detalhe de conteúdo, e reavaliar depois de alguns dias rodando).

## 2. Tamanho do contexto por chamada — quanto do custo é "estrutural"

Cada chamada de conversa hoje carrega: system prompt completo + até 20 mensagens de histórico (`ORDER BY created_at DESC LIMIT 20`) + resultado de RAG (se `rag_ativo`) + lista de ferramentas MCP disponíveis (todas as 10, sempre — sem filtro por toggle, achado já registrado noutra sprint). Levantar, pra uma amostra recente de chamadas reais (ex: últimas 20-30 de qualquer conta ativa):
- Tamanho médio do system prompt em tokens.
- Tamanho médio do bloco de histórico (20 mensagens é sempre necessário, ou a conversa raramente usa isso tudo?).
- Tamanho médio do resultado de RAG injetado, quando ativo.
- Estimar quanto cada um desses blocos representa, percentualmente, do total de tokens de entrada por chamada — isso indica onde cortar traria mais economia (ex: se histórico de 20 mensagens for a maior fatia, baixar pra 10 já corta custo sem mudar de modelo).

## 3. Retry e falha — chamada que falha ainda consome?

Conferir `withAiFallback` e a lógica de retry dos providers (`providers/index.ts`) — uma chamada que falha (rate limit, timeout, erro 5xx) é cobrada mesmo assim pela OpenAI (normalmente não, mas confirmar se algum retry está re-enviando o mesmo prompt grande várias vezes antes de desistir, o que multiplicaria o custo de tentativas que no fim falharam mesmo assim).

## 4. Opções concretas de economia (documentar, não aplicar)

Pra cada opção, estimar impacto (alto/médio/baixo) e risco (ex: perda de qualidade de resposta):
- Trocar `gpt-4.1` por `gpt-4o-mini` nas 3 contas que usam o mais caro — impacto financeiro estimado (comparar custo por mensagem dos dois modelos, usando os tokens médios já medidos no ponto 2), risco de qualidade (não decidir sozinho, só estimar).
- Reduzir histórico de 20 pra um número menor (ex: 10), se o levantamento do ponto 2 mostrar que isso não compromete a qualidade da resposta na prática.
- Filtrar `MCP_TOOLS` pelos toggles configurados por agente em vez de mandar as 10 sempre (já é uma recomendação de outra sprint — só reforçar aqui do ângulo de custo, cada ferramenta na lista consome tokens de contexto mesmo sem ser usada).
- Corrigir a duplicação Vision/Whisper (já confirmada, ainda não implementada) — reforçar estimativa de economia aqui com os números reais desta investigação.
- Cache de resposta pra perguntas muito repetidas (ex: FAQ) — hoje `consultar_faq` já existe como tool, mas isso ainda gasta uma chamada de IA pra decidir usar a tool; avaliar se vale interceptar perguntas muito comuns antes de chegar na IA (fora de escopo de implementar agora, só registrar como ideia).

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Investigação e estimativas — não mudar modelo, não mudar tamanho de histórico, não mudar nenhuma configuração de conta nesta sprint, nem a da própria Mentoark. Se algo parecer um bug real e óbvio (ex: confirmar que o antiloop realmente falhou), reportar com prioridade mas ainda sem corrigir sem aprovação, dado que já mexemos em produção o suficiente por hoje.

## AO FINALIZAR, REPORTAR

- Veredito sobre o pico da fmakonee03: uso real ou sinal de bug/loop.
- Tamanho médio de cada bloco de contexto (system prompt, histórico, RAG) e percentual do total.
- Se retry duplica custo de chamadas que falham.
- Tabela de opções de economia com impacto estimado (alto/médio/baixo) e risco, pra decidirmos juntos o que aplicar.
- Nenhuma mudança de configuração aplicada nesta sprint.

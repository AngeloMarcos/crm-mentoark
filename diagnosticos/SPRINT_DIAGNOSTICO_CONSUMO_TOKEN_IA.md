# Sprint — Diagnóstico: o que está consumindo tanto crédito de IA

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Sprint de diagnóstico — não corrigir nada ainda, só investigar e reportar com números reais.** Usuário recarregou crédito de IA há poucos dias e já esgotou de novo — precisa entender exatamente onde está indo, antes de decidir o que fazer.

---

## Contexto

O sistema chama IA (OpenAI e/ou outros providers) em vários pontos diferentes, cada um com custo próprio:
- `agentEngine.ts`: resposta principal da conversa (loop agentic, até 5 iterações por mensagem).
- `vision.ts`/`analisarImagem` (duas implementações, uma em `utils/vision.ts` outra inline em `agentEngine.ts` — confirmar se as duas estão realmente em uso ou se uma é código morto): roda em toda imagem recebida, sem cache, sem toggle.
- `transcribe.ts`: transcrição de todo áudio recebido.
- `humanizationService.ts`: reescrita de mensagem em campanhas de Disparo (humanização), custo multiplicado por contato.
- Embeddings (RAG, `buscar_documentos`/`text-embedding-3-large`).
- Resumo de atendimento (`Basic LLM Chain`/equivalente, se existir aqui — conferir se esse padrão do n8n antigo tem equivalente no sistema atual).
- A feature de roleta de grupo recém-implementada (`grupoTarefaEngine.ts`, se já foi implementada nesta sessão) — CONFERIR PRIMEIRO se sobrou algum grupo de teste com `ativo=true` em `grupos_ia_permitidos` gerando chamadas de IA a cada mensagem de um grupo movimentado. Isso sozinho pode explicar consumo alto se não foi limpo direito.

## O que investigar

1. **Checar primeiro o óbvio**: `SELECT * FROM grupos_ia_permitidos WHERE ativo = true` — se sobrou alguma linha de teste ativa (da sprint da roleta de grupo, executada recentemente), e esse grupo for movimentado, cada mensagem gera uma chamada de IA. Se achar, desativar imediatamente (`ativo = false`) e reportar como achado principal.
2. **Volume de chamadas recente**: se houver algum log estruturado com contagem de chamadas de IA (ver `logger.ts`/uso de `log.info` nos pontos de chamada de IA), levantar quantas chamadas aconteceram nos últimos 3-5 dias, separadas por tipo (resposta de conversa, visão, transcrição, humanização, embeddings). Se não houver log estruturado suficiente pra isso, reportar essa lacuna também — vale considerar registrar isso daqui pra frente.
3. **Chave de API compartilhada**: confirmar se `OPENAI_API_KEY` do `.env` do backend é uma chave **da conta Mentoark especificamente**, ou uma chave de plataforma usada como fallback por QUALQUER conta cliente que não tenha configurado a própria (`criarProvider()`/`envKey` em `agentEngine.ts`). Se for a segunda opção: **o consumo pode estar vindo de outras contas de cliente rodando na mesma chave**, não só do uso da própria Mentoark — isso muda completamente o diagnóstico. Levantar quantas contas hoje NÃO têm provider próprio configurado e por isso caem no fallback compartilhado.
4. **Loop/bug de duplicação**: conferir o mecanismo anti-eco (`botSentTexts`/`botMessageIds`, TTL) — está funcionando, ou existe algum caminho onde a IA pode estar respondendo à própria mensagem (loop), multiplicando chamadas sem que o usuário perceba no WhatsApp (porque ele só vê a mensagem final, não as chamadas de IA intermediárias que geraram retry/loop)? Conferir `agentEngine.ts` (loop de até 5 iterações) — em que frequência real as conversas estão batendo no limite de 5 iterações (isso indicaria ineficiência: uma pergunta simples não deveria precisar de 5 idas-e-voltas de tool calling).
5. **Vision sem cache/toggle**: já é um achado documentado (não tem toggle, roda sempre) — quantificar quantas imagens foram processadas nos últimos dias, pra saber se isso é uma fatia relevante do consumo ou não.
6. **Campanhas de Disparo com humanização**: quantas campanhas rodaram nos últimos dias com "Humanizar com IA" ativado, e quantos contatos cada uma tinha — cada contato humanizado é uma chamada de IA a mais, isso é esperado mas vale quantificar se bateu um volume muito maior que o normal.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. Puramente investigação — só corrigir sem pedir aprovação se o achado for gritante e óbvio (ex: grupo de teste esquecido ativo — isso sim pode desativar na hora, é claramente um acidente, não uma decisão de produto). Qualquer outra mudança (cache de vision, limite de iteração, etc.) fica como recomendação.

## AO FINALIZAR, REPORTAR

- Se achou grupo de teste esquecido ativo — e se desativou.
- Números reais de volume de chamadas de IA por tipo, nos últimos dias (o mais preciso que os logs permitirem).
- Se a chave de API é compartilhada entre contas de cliente, e quantas contas dependem do fallback.
- Se há sinal de loop/duplicação de chamadas.
- Top 3 causas mais prováveis do consumo alto, ordenadas por probabilidade/impacto.
- Nenhuma mudança de código além do achado óbvio (se houver).

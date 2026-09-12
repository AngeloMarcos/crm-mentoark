# Plano — Motor multi-agente com roteamento por regra + economia de tokens (versão refinada, 9 sprints)

Colado pelo usuário em 2026-08-07 (fonte externa, não escrito pelo Claude Code nesta sessão) — proposta de arquitetura, **não implementada ainda**. Usuário pediu explicitamente só salvar como plano por enquanto, sem tocar em código. Esta é a **segunda versão**, refinada — reordena a primeira versão (rascunho de 7 sprints, mesma pasta, git history) pra uma sequência mais realista de produção: trava a unificação de config como pré-requisito antes de qualquer coisa de multi-agente, e adiciona uma flag de segurança como primeiro passo.

---

## Contexto real do sistema hoje (pra próxima sessão não reabrir do zero)

- `agentEngine.ts` roda **um único agente por conta** — resolve `agent_configs WHERE user_id=$1 AND ativo=true LIMIT 1`, monta um prompt único (`prompt_sistema`) e manda pro provider (OpenAI/Claude) inteiro, toda mensagem. Não existe hoje nenhum conceito de "múltiplos agentes especialistas", "modo" dinâmico, nem "motor de decisão sem IA".
- **Bloqueador real, já identificado e confirmado por leitura de código em sessão anterior**: `agentes` (tela `/agentes`, CRUD completo, 7 abas) e `agent_configs` (usada de fato pelo motor) são duas tabelas que não se falam — vários campos preenchidos em `/agentes` nunca são lidos em lugar nenhum do backend. Documentado em `SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md`, classificado como **risco alto** ("mexe direto no que a IA fala com clientes reais em produção"). Esta versão do plano já assume isso como pré-requisito (Sprint 1) — correto, bate com o que já estava mapeado.
- Diagnóstico de custo de IA já feito e documentado (`SPRINT_DIAGNOSTICO_APROFUNDADO_CUSTO_IA.md`, `SPRINT_DIAGNOSTICO_CONSUMO_TOKEN_IA.md`) — achados de lá (histórico de conversa sem corte, `MCP_TOOLS` sempre mandado inteiro sem filtro por agente, 0 contas com `ai_providers` próprio) se sobrepõem diretamente à Sprint 2 deste plano (cortar histórico, prompt menor, ferramentas relevantes só). **Ler aqueles dois documentos antes de começar a Sprint 2** — o diagnóstico já está pronto, só falta aplicar.
- Nenhuma conta hoje depende de multi-agente — as 5 contas ativas (`mentoark`, `fmakonee03`, `stefanocatedral`, `angelobispofilho`, `crisacorretoradeimoveis`) usam o modelo atual de 1 prompt único, servindo clientes reais agora. A flag `multi_agent_enabled` da Sprint 0 é a peça certa pra isso não virar risco — qualquer sprint que toque `agentEngine.ts` de verdade precisa dessa flag em produção com `false` até o novo caminho estar validado, mesmo que testado exaustivamente em homolog antes.

## O plano refinado (verbatim, resumido por sprint)

### 🎯 Visão estratégica — 4 etapas macro
1. **Otimizar o atual** (economizar $) — sem mudar arquitetura.
2. **Preparar a base** (sem quebrar nada) — resolver a duplicação de config.
3. **Introduzir multi-agente** (gradual, não de uma vez).
4. **Motor inteligente** (o diferencial de produto, roteamento sem depender só de IA).

### 🟢 Sprint 0 — Segurança (antes de tudo)
Flag de feature `multi_agent_enabled: false` por conta. Se `false`, continua usando `agentEngine.ts` atual sem nenhuma mudança de comportamento; se `true`, usa o motor novo. Objetivo: poder evoluir o motor sem arriscar nenhuma conta real no meio do caminho.

### 🟡 Sprint 1 — Unificar config (obrigatório)
Elimina a duplicação `agentes` vs `agent_configs`. Estrutura única proposta (`{id, user_id, nome, tipo, config: {objetivo, tom, regras, ativo}}`). Migrar dados antigos; garantir que "1 agente = modelo atual" continue compatível com o sistema de hoje (não é troca de comportamento, só de esquema).

### 🟠 Sprint 2 — Otimização de tokens (ganho rápido)
Sem mudar arquitetura: cortar histórico pra últimas 3 mensagens; parar de mandar todas as ferramentas MCP sempre (só as relevantes); prompt menor (poucas linhas, não o prompt gigante atual); resumo de conversa salvo estruturado (`{resumo: "..."}`) em vez de histórico bruto.

### 🔵 Sprint 3 — Memória estruturada
`lead_context: {nome, empresa, interesse, status, etapa_funil}`, atualizado a cada mensagem, nunca manda histórico inteiro pra IA — só esse contexto resumido.

### 🟣 Sprint 4 — Primeiro "pseudo multi-agente"
Ainda **1 agente só**, mas com "modo" dinâmico (`sdr` | `closer` | `suporte`) decidido por regra simples (`lead.status === "novo"` → modo sdr; mensagem contém "preço" → modo closer). O prompt muda dinamicamente conforme o modo, sem reescrever o motor inteiro.

### 🔴 Sprint 5 — Motor de decisão (sem IA)
Engine de regras simples (`rules = [{cond, action}]`) que decide o modo/agente ANTES de chamar IA, só cai pra LLM quando nenhuma regra bate. Objetivo: menos chamadas de IA, sistema mais previsível.

### ⚫ Sprint 6 — Multi-agente real (finalmente)
Só aqui separa agentes de verdade (SDR/Closer/Suporte como entidades distintas, cada um com `{id, regras, prompt_base, tools}`), com o motor de decisão da Sprint 5 escolhendo qual usar (`selectedAgent = decisionEngine(...)`).

### ⚪ Sprint 7 — Otimização avançada
Cache de resposta pra pergunta repetida (não chama IA de novo). Templates prontos por palavra-chave, sem IA nenhuma pros casos óbvios (ex: "horário" → resposta fixa). Classificador leve (regex/palavras-chave) pra reduzir dependência de LLM.

### 🧠 Sprint 8 — Fluxo visual (nível n8n)
UI de fluxo (Entrada → SDR → condição → Closer → ação), começando por regras simples antes de qualquer drag-and-drop. Descrito pelo usuário como "o diferencial real, produto vendável de verdade".

## Erros que o plano quer evitar (explícito, verbatim)
- Sair criando multi-agente direto (sem primeiro resolver a duplicação de config nem ter a flag de segurança).
- Depender 100% da OpenAI.
- Prompt gigante.
- Mandar histórico inteiro pra IA.
- Não controlar o fluxo (deixar tudo na mão da IA em vez de regra determinística quando possível).

## Status

**Não implementado.** Esta versão refinada substitui a primeira (mesmo arquivo, git history guarda a versão anterior) — a ordem mudou pra priorizar segurança (Sprint 0) e resolver a dívida técnica real (Sprint 1) antes de qualquer coisa de multi-agente. Quando o usuário decidir priorizar: começar pela Sprint 0 (flag), depois Sprint 1 lendo `SPRINT_UNIFICAR_CONFIGURACAO_AGENTE_IA.md` primeiro (já tem o levantamento feito, não repetir), depois Sprint 2 lendo os 2 diagnósticos de custo já prontos.

# Sprint — Unificar configuração de agente de IA (hoje dividida em 2 tabelas/telas que não se falam)

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Risco alto** — mexe direto no que a IA fala com clientes reais em produção. Homologação obrigatória, testar conta por conta antes de considerar concluído. Ler também o histórico do incidente "Cris" em `AUDITORIA_LOG.md`/comentário `[AUDITORIA] BUG GRAVE` em `src/components/cerebro/ConfigAgenteIA.tsx` antes de começar — é a razão da cautela extra pedida aqui.

---

## Contexto (investigação já feita, não repetir — só confirmar antes de mexer)

Hoje existem **duas telas e duas tabelas** de configuração de agente que não se comunicam:

- `src/pages/Agentes.tsx` (rota `/agentes`) — tela principal, CRUD completo, tabela `agentes`. 7 abas: Identidade, Comportamento, Motor, Conhecimento, WhatsApp, Integração, Status.
- `src/components/cerebro/ConfigAgenteIA.tsx` — componente escondido dentro da rota `/cerebro` (Base de Conhecimento), tabela `agent_configs`, uma config ativa por conta.

Confirmado lendo `backend/src/services/agentEngine.ts` (linhas ~582-642): o **prompt do sistema realmente usado em toda conversa vem de `agent_configs.prompt_sistema`** (com fallback pra `agent_prompts` só em contas antigas) — não de nenhum campo de `agentes`.

Confirmado por busca em todo `backend/src`: os seguintes campos de `agentes`, preenchidos na tela `/agentes`, **não são lidos em nenhum lugar do backend**:
- Aba Identidade/Comportamento: `persona`, `tom`, `objetivo`, `mensagem_boas_vindas`, `regras` — zero ocorrências fora do CRUD de salvar/carregar.
- Aba Motor: os 10 switches individuais de ferramentas MCP (`mcp_tools`) — `agentEngine.ts` linha ~715 manda sempre a constante `MCP_TOOLS` inteira pro provider, sem filtrar pelo que está ligado/desligado na tela.
- Aba Motor: os 3 toggles de modalidade (`modalidade_audio`, `modalidade_imagem`, `modalidade_video`) — só aparecem no whitelist de campos do CRUD (`backend/src/index.ts` ~linha 300), nunca lidos em lógica nenhuma.

Ou seja: a tela mais visível (`/agentes`) tem a maior parte dos seus campos sem efeito real, enquanto o campo que de fato define o comportamento da IA (`prompt_sistema`) fica numa tela escondida dentro de outra página.

**Reconfirmar tudo isso lendo o código atual antes de implementar** — pode ter mudado desde esta investigação.

## Decisão de arquitetura (já definida com o usuário, seguir esta linha)

Unificar em **uma tabela, uma tela**: `agentes` continua sendo a tabela e a tela `/agentes` (já é a mais visível e já suporta múltiplos agentes via CRUD). `agent_configs` é aposentada.

### 1. Migração de schema e dados

- Adicionar em `agentes` as colunas de `agent_configs` que ainda não existem lá e que são realmente lidas pelo motor: `prompt_sistema`, `saudacao_inicial`, `bloco_qualificacao`, `mensagem_encaminhamento`, `mensagem_encerramento`, `palavra_reativar`, `sinal_pausa`, `tempo_espera_mensagem`, `tempo_espera_resposta`, `modelo_llm`, `modelo_parser`, `grupo_notificacao`, `operation_mode`, `distribution_mode`, `resposta_voz_habilitada`, `resposta_voz_id`.
- Script de migração de dados: para cada `user_id` com uma linha em `agent_configs WHERE ativo = true`, copiar os valores pras colunas correspondentes do agente certo em `agentes` (se o usuário tiver mais de um agente cadastrado, copiar pro que já estiver com `ativo = true`; se nenhum estiver ativo ou houver ambiguidade, **parar e listar o caso pra decisão manual — não adivinhar**, é exatamente o tipo de situação que causou o incidente Cris).
- Não apagar `agent_configs` fisicamente nesta sprint — só parar de escrever/ler nela depois que a migração e os testes confirmarem que `agentes` tem os dados certos. Apagar a tabela fica pra uma sprint de limpeza futura, depois de um tempo de operação estável.

### 2. Backend — `agentEngine.ts`

- Trocar a query `SELECT ... FROM agent_configs WHERE user_id = $1 AND ativo = true` pela leitura das mesmas colunas direto de `agentes` (já é buscada nesse fluxo, ver query de `agente` mais acima no arquivo — evitar um segundo round-trip ao banco se der pra reaproveitar a mesma linha já carregada).
- Manter o mesmo comportamento de segurança já existente e testado: **sem `prompt_sistema` com conteúdo real, a IA não responde** (mesmo guard-rail atual, só trocando a fonte da coluna).
- Filtrar `MCP_TOOLS` pelos toggles de `agente.mcp_tools` antes de passar pro `provider.complete()` (linha ~715) — torna a aba Motor funcional de verdade em vez de decorativa.
- Decidir e implementar o que fazer com `modalidade_audio`/`modalidade_imagem`/`modalidade_video`: se não há nenhum ponto do sistema (frontend incluso) que deveria consultar esses toggles pra alguma decisão real (ex: permitir/bloquear resposta em áudio), **remover os campos da tela e do schema** em vez de deixar mais um controle que não faz nada — mais simples é melhor aqui. Confirmar antes se `resposta_voz_habilitada` (que É lido, ver `agentEngine.ts` ~851-866) já cobre o caso de uso de "áudio" e esses 3 toggles são só duplicata morta.

### 3. Frontend — `Agentes.tsx`

- Aba **Identidade**: substituir `persona`/`tom`/`objetivo`/`mensagem_boas_vindas`/`regras` (nunca lidos, causam a sensação de "configurei e não mudou nada") por um único campo grande e claro: **Prompt do Sistema** (`prompt_sistema`, textarea grande, obrigatório) — é o que de fato define quem o agente é e como fala. Se o usuário quiser manter algum campo estruturado como ajuda visual pra montar o prompt (ex: um gerador que monta um prompt sugerido a partir de persona/tom/objetivo preenchidos), deixar isso claramente marcado como "rascunho/sugestão" e não como configuração que funciona sozinha.
- Aba **Comportamento**: trazer `saudacao_inicial`, `bloco_qualificacao`, `mensagem_encaminhamento`, `mensagem_encerramento`, `palavra_reativar`, `sinal_pausa`, `tempo_espera_mensagem`, `tempo_espera_resposta` — os campos reais que hoje só existem na tela escondida.
- Aba **Motor**: manter provider/modelo (já funcional) e os toggles de MCP tools (agora funcionais de verdade); remover modalidades se a decisão do item 2 acima for remover.
- Aba **Integração**: hoje é quase vazia (só um aviso redirecionando pra WhatsApp) — avaliar se ainda faz sentido existir como aba separada ou se deve ser removida/mesclada.
- Aba **Status**: manter `ativo`, mas com um cuidado extra de segurança (ver seção 4 abaixo).

### 4. Aposentar a tela escondida

- Remover `ConfigAgenteIA.tsx` de dentro de `Cerebro.tsx` (ou trocar por um aviso simples "configuração movida para /agentes", se o time preferir uma transição suave em vez de remoção seca).
- Confirmar que `Cerebro.tsx` continua funcionando normalmente pro que não é configuração de agente (RAG, `documents`, base de conhecimento) — essa parte não muda.

### 5. Salvaguarda extra (por causa do incidente Cris)

- Migração de dados: nunca criar ou ativar um agente novo com dados de outra conta. Sempre migrar `user_id → user_id` exato, um a um.
- Depois da migração, conferir manualmente pelo menos 3 contas reais (incluindo a da Mentoark) comparando o `prompt_sistema` que a IA está de fato usando antes e depois da mudança — tem que ser idêntico, byte a byte, pra nenhuma conta.
- Se qualquer conta ficar sem `prompt_sistema` depois da migração (dado ausente/inconsistente), o agente dela deve continuar em silêncio (mesmo comportamento de guard-rail já existente) — nunca cair num prompt genérico ou de outra conta.

## PROCESSO

Seguir `AUDITORIA_PROTOCOLO.md`. `npm run build` (frontend e backend). Testar em homolog primeiro, com pelo menos 2 contas de teste diferentes: confirmar que o prompt configurado na tela nova é exatamente o que a IA usa na conversa real (mandar mensagem de teste, olhar o log/resposta). Confirmar que os MCP tools desligados na tela realmente não ficam disponíveis pra IA numa conversa de teste. Só considerar pronto pra produção depois de validar isso com dado real em homolog — este é o tipo de mudança que, se sair errado, pode fazer a IA responder com a persona errada pra um cliente real.

## AO FINALIZAR, REPORTAR

- Confirmação da migração de dados: quantas contas tinham `agent_configs` ativo, quantas foram migradas sem ambiguidade, quantas precisaram de decisão manual (e o que foi decidido).
- Teste real em homolog: prompt configurado na tela nova batendo com o que a IA respondeu numa conversa de teste, em pelo menos 2 contas.
- Teste real dos MCP tools: toggle desligado → ferramenta de fato indisponível pra IA numa conversa de teste.
- Decisão tomada sobre os 3 toggles de modalidade (removidos ou religados) e justificativa.
- O que aconteceu com `agent_configs` (mantida só de leitura/fallback, ou já sem uso) e com `ConfigAgenteIA.tsx`/aba dentro de `/cerebro`.
- Build do frontend e do backend passaram.
- Atualizar `STATUS.md` e `diagnosticos/AUDITORIA_LOG.md`.

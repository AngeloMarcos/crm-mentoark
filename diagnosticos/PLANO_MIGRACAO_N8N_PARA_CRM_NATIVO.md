## ATUALIZAÇÃO 2026-07-24 (Sprint 1/3): Resposta em Voz (TTS) — IMPLEMENTADO NO CÓDIGO

`agentEngine.ts` agora sabe responder em voz via ElevenLabs (`backend/src/utils/elevenlabs.ts`, novo), opt-in por agente via `agent_configs.resposta_voz_habilitada` + `resposta_voz_id` (migration nova, default `false` — nenhum tenant existente é afetado sem configuração explícita). Gatilho: flag ligada + voice_id configurado + mensagem recebida do cliente foi um áudio. Fallback pro texto normal em qualquer falha, testado contra a API real da ElevenLabs (chave inválida → `null`, sem exceção) e confirmado que hoje **nenhum tenant tem integração ElevenLabs configurada** (então o fallback é o caminho ativo por padrão até alguém configurar). `whatsapp_messages` passa a registrar `message_type`/`media_url` corretos conforme o que realmente foi enviado.

**Pendente:** aplicar a migration em produção (roda sozinha no próximo restart do `crm-api` de produção) e um teste fim-a-fim real em homolog (não foi possível localmente — ver `STATUS.md` da sessão, chave de criptografia local não bate com a de homolog).

Próximas desta linha: Google Calendar (agendamento real) e ingestão automática de documentos via Google Drive — não iniciadas.

---

## CONCLUSÃO FINAL (confirmado no banco de produção e homologação, 2026-07-24)

`SELECT ... FROM agentes WHERE n8n_webhook_url IS NOT NULL AND n8n_webhook_url <> ''` retornou **0 linhas em produção e 0 em homologação** — nenhum tenant real depende do n8n hoje. Os 2 workflows que existem no n8n (`Angelo pospect` e `corretor pospect`, quase idênticos) estão **inativos (`active=0`) e nunca tiveram uma execução registrada**. Foram construídos contra credenciais do Supabase/Postgres de antes da migração pro backend Express atual — nunca chegaram a ser ligados a nada real.

**Não existe migração a fazer.** Não há `n8n_webhook_url` pra trocar, não há tráfego real pra desviar, não há risco em desligar/ignorar o n8n. O pedido original ("não quero depender mais do n8n") já está satisfeito — o CRM nunca dependeu dele de fato.

O que sobra é uma decisão de **produto**, não de migração: os workflows mostram 4 capacidades reais que o motor nativo (`agentEngine.ts`) ainda não tem — voz (TTS já existe como rota solta, falta plugar), agendamento real via Google Calendar, ingestão agendada de documentos do Google Drive pro RAG, e reengajamento automático de conversas paradas. Nenhuma é urgente; são melhorias a implementar uma de cada vez, testáveis via `IA_TEST_MODE` já existente, se e quando você quiser que o motor nativo passe a fazer isso também.

`STATUS.md` já atualizado por essa sessão, incluindo a correção da pendência #2 (P2010) que ainda estava marcada como aberta.

---

## ATUALIZAÇÃO (workflow real analisado: "Angelo pospect.json")

O usuário subiu o export completo de um workflow do n8n. Leitura feita nó a nó (137 nodes). Achados abaixo substituem a suposição da Fase 2 original — a extração já foi feita pra este arquivo específico.

**Atenção — achado que precisa de confirmação sua antes de qualquer migração:** este arquivo mistura, no mesmo workflow, lógica de **pelo menos 3 negócios diferentes**: "SodPet Estética Animal" (persona "Luma", pet shop — é o `systemMessage` ativo hoje no node do agente), "LR Capas Automotivas" (persona "Angelo Marcos", capas de carro, menu 1-6 de linhas de produto) e a própria "Stella" da MentoArk (prospecção de clientes novos do CRM, menu 1-3 WhatsApp/Sites/Design). Tem ainda uma credencial de Postgres chamada "Adega Postgres" (outro projeto, provavelmente nem é cliente da Mentoark) usada num node isolado de criação de tabela. Isso indica que este arquivo é o **template/workspace pessoal que você reaproveita por cópia entre clientes**, não necessariamente o workflow ao vivo de um tenant específico do CRM. Preciso que confirme: este JSON é (a) só um template de referência que nunca roda exatamente assim, ou (b) está mesmo ativo no n8n com todos esses ramos ao mesmo tempo? Se for (b), vale investigar se há vazamento de dado entre esses "clientes" dentro do próprio n8n — mesma classe dos incidentes já corrigidos no CRM.

### O que o workflow faz, de fato (mapeado por node)

**Entrada:** webhook próprio do n8n (`Webhook EVO`, path `/mento-automacao`) recebe evento da Evolution API — **não depende do `webhook.ts` do CRM encaminhar nada**; a Evolution parece estar configurada pra mandar direto pro n8n em paralelo. Roteia por tipo de mensagem (texto/áudio/imagem/documento), extrai `remoteJid` (com fallback pro campo alternativo do LID do WhatsApp), busca/cria contato numa tabela própria (`dados_cliente` — **não é a tabela `contatos` do CRM**), e checa pausa/reativação de IA por palavra-chave (mesmo conceito que o CRM já tem, campo `atendimento_ia`).

**Buffer de mensagens:** usa Redis (lista por telefone) pra concatenar mensagens que cheguem próximas antes de acionar a IA — resolve o mesmo problema que o debounce em memória do `agentEngine.ts` já resolve, só que com mecanismo diferente (sobrevive a restart do processo, o buffer em memória do CRM não).

**Pré-processamento de mídia:** áudio → Whisper (transcrição); imagem → GPT-4o-mini Vision (resumo); documento (PDF/Excel/Google Docs) → Google Gemini 2.5 Flash (resumo). Os dois primeiros o CRM **já tem nativamente** (Whisper/Vision, implementado ontem). Documento (PDF/Excel) **o CRM não tem ainda** — gap real.

**O agente em si (`@n8n/n8n-nodes-langchain.agent`):**
- Prompt de sistema único e grande (persona + regras + fluxo + formatação + FAQ) — equivalente ao que o CRM já modela como `conhecimento` (RAG com tipos personalidade/negocio/faq/objecao/script), só que aqui é um texto monolítico por cliente, não fragmentado.
- **Ferramentas reais que o agente chama:**
  1. `criar_reuniao` / `cancelar_reuniao` / `reagendar_reuniao` — sub-workflow de Google Calendar (checa disponibilidade, cria evento com Google Meet, evita duplicidade de agendamento pro mesmo e-mail, cancela, atualiza). **Gap real — o CRM não tem agendamento hoje.**
  2. `buscar_documentos` (RAG via `toolVectorStore` + Supabase pgvector, `text-embedding-3-large`, função `match_documents`) — **o CRM já tem exatamente isso**, mesma função SQL, já ativo em produção.
  3. Memória de conversa (`Postgres Chat Memory`, LangChain, tabela `n8n_chat_histories`, janela de 50 mensagens) — **mesma tabela que o motor nativo do CRM já usa.**
- Saída da IA pode conter marcadores tipo `ACAO_XXXX` embutidos no próprio texto, extraídos depois por código JS pra: enviar mídia pré-cadastrada por tag (tabela `vw_mento_midias`, um catálogo próprio, diferente do catálogo/produtos do CRM), rotear por "linha de produto", ou pausar a IA quando emite um número de protocolo específico. É function-calling feito via regex em texto livre, não tool-calling estruturado — funciona, mas é frágil (qualquer mudança de prompt pode quebrar o regex).

**RAG — ingestão automática:** pipeline agendado (todo dia 5h) que varre uma pasta do Google Drive, extrai texto (PDF/Excel/Google Docs), quebra em chunks (1200/200), gera embeddings e grava em `documents`. **O CRM tem a ferramenta de busca, mas não esse pipeline de ingestão automática do Drive** — hoje o RAG do CRM depende de outra forma de alimentar `documents` (confirmar qual).

**Saída de voz:** TTS via ElevenLabs + envio de áudio pela Evolution. O CRM já tem uma rota `elevenlabs.ts` (vista na auditoria de fetch/timeout) — não confirmado se já está plugada no fluxo de resposta automática do motor nativo ou só disponível solta.

**Entrega humanizada:** resposta da IA é dividida em pedaços (chunking) com espera entre cada envio, simulando digitação — checar se `enviarResposta()` do CRM já faz isso.

**Reengajamento automático:** dois schedule triggers verificam conversas paradas (>5min sem resposta), classificam o estado da conversa (`Text Classifier`: pendente/encerrada/personal/sem resposta) e mandam uma mensagem de follow-up gerada por LLM. **Gap real — o CRM não tem isso hoje.**

**Escalação:** ao fechar/pausar um caso, gera resumo via LLM e notifica um grupo de WhatsApp interno — **este node está desabilitado (`disabled: true`) no workflow atual**, não está ativo agora.

**Achado importante sobre dados:** o n8n grava conversa em tabelas próprias (`dados_cliente`, `chats`, `chat_messages`) que **não são as tabelas que o CRM usa** (`contatos`, `whatsapp_messages`). Ou seja: hoje, pra qualquer tenant que usa n8n como motor, o histórico de conversa fica guardado fora do CRM — a tela de chat do CRM provavelmente não mostra essas conversas (só a IA teria acesso, via `n8n_chat_histories`, que essa sim é compartilhada). Isso significa que migrar não é só "trocar o motor", é também decidir o que fazer com esse histórico paralelo.

### Tabela de gap consolidada

| Capacidade do n8n | Já existe no motor nativo? | Gap a implementar |
|---|---|---|
| RAG (busca em documentos) | ✅ Sim, mesma função SQL | Nenhum |
| Histórico de conversa (n8n_chat_histories) | ✅ Sim, mesma tabela | Nenhum |
| Transcrição de áudio (Whisper) | ✅ Sim | Nenhum |
| Análise de imagem (Vision) | ✅ Sim | Nenhum |
| Debounce/buffer de mensagens | ✅ Sim (mecanismo diferente, mesmo efeito) | Nenhum |
| Pausa/reativação de IA por palavra-chave | ✅ Sim | Nenhum |
| Análise de documento (PDF/Excel) | ❌ Não | Novo utilitário, mesmo padrão do Whisper/Vision |
| Agendamento (Google Calendar: criar/cancelar/reagendar) | ❌ Não | Integração nova, maior esforço do gap |
| Ingestão automática de RAG via Google Drive | ❌ Não confirmado | Confirmar como `documents` é populado hoje |
| Resposta em áudio (TTS) no fluxo automático | ✅ Implementado 2026-07-24 (opt-in por agente) | Concluído — ver atualização no topo do arquivo |
| Envio em pedaços (chunking humanizado) | ⚠️ Não confirmado | Confirmar em `enviarResposta()` |
| Reengajamento automático (follow-up 24h/72h) | ❌ Não | Novo, cron + classificador |
| Biblioteca de mídia por tag | ❌ Não | Novo, ou adaptar catálogo existente |
| Notificação de handoff em grupo | ⚠️ Existe no n8n mas desabilitado | Baixa prioridade |

---

# Levantamento — Migrar tudo que o n8n faz hoje pro motor de IA nativo do CRM

Cole este prompt inteiro no Claude Code (CLI). Ler `AUDITORIA_PROTOCOLO.md` primeiro. **Decisão do usuário para esta sessão:** parar de depender do n8n como orquestrador de IA — tudo que ele faz hoje precisa passar a ser feito pelo motor nativo (`agentEngine.ts`). Esta é a fase de **levantamento**, não de implementação — o objetivo é descobrir com precisão o tamanho real do problema antes de desligar qualquer coisa em produção que algum cliente real dependa.

**Não desligar, não remover, não migrar nenhum tenant nesta sessão.** Só investigar e reportar.

---

## Por que isso não pode ser feito só lendo o código do CRM

O repo só mostra o que o n8n **chama de volta** no CRM (`n8n.ts`, `mcp.ts`, o webhook do Kanban) — não mostra a lógica real que roda **dentro** do workflow do n8n (que fica salva no banco do próprio n8n, não neste git). Pra migrar de verdade, primeiro precisamos ver o workflow em si.

## FASE 1 — Quantificar o uso real (query no banco de produção)

```sql
-- Quantos agentes têm n8n configurado e ativo hoje, e de quais tenants
SELECT a.id, a.user_id, u.email, a.nome, a.evolution_instancia, a.n8n_webhook_url, a.ativo
FROM agentes a
JOIN users u ON u.id = a.user_id
WHERE a.n8n_webhook_url IS NOT NULL AND a.n8n_webhook_url <> ''
ORDER BY a.updated_at DESC;
```

Rodar contra `crm` (produção) e `crm_hml` (homolog) separadamente. Isso dá a lista exata de quais clientes reais dependem do n8n para a IA responder — não assumir que é só "Cris" ou qualquer nome já citado em sessões anteriores, confirmar com o dado atual.

## FASE 2 — Extrair a lógica real do(s) workflow(s) do n8n

Para cada instância encontrada na Fase 1, localizar e exportar o workflow correspondente do n8n:
1. Verificar se a API REST do próprio n8n está acessível (`n8n.mentoark.com.br/api/v1/workflows`, exige API key do n8n — checar se já existe uma gerada, em `Settings > API` do n8n ou nas variáveis de ambiente do container).
2. Se a API não estiver disponível, ler direto do banco do n8n (hoje caindo em SQLite por causa do `DB_TYPE=mysqldb` inválido já documentado em `STATUS.md` — localizar o arquivo `.sqlite` dentro do volume do container `n8n` e extrair a tabela `workflow_entity`, campo `nodes`/`connections` em JSON).
3. Documentar, por workflow, em português simples: quais nodes existem, em que ordem, o que cada um faz (ex: "recebe webhook → busca histórico via MCP → chama GPT-4 com esse prompt de sistema → decide se cria card no Kanban → envia resposta via Evolution API direto, sem passar pelo CRM").

**Isso é o item mais importante desta sessão** — sem isso, qualquer plano de migração é só suposição.

## FASE 3 — Mapear o gap contra o que `agentEngine.ts` já faz hoje

Comparar linha a linha o que o workflow faz (Fase 2) contra o motor nativo:
- O motor nativo já tem: debounce de 3s, lock por telefone, histórico via `n8n_chat_histories`, RAG (`buscar_documentos`, pgvector), Whisper (áudio), Vision (imagem), envio via Evolution.
- Ferramentas MCP que o n8n usa hoje (`obter_historico_conversa`, `buscar_documentos`, outras em `mcp/tools.ts`) — o motor nativo já usa as mesmas fontes de dado diretamente (sem precisar do protocolo MCP), então isso normalmente não é gap real, é só um caminho de acesso diferente pro mesmo dado.
- O webhook do Kanban (`POST /api/kanban/webhook/n8n`) — se algum workflow cria cards de Kanban a partir da conversa, isso é uma capacidade que precisa de equivalente nativo (`agentEngine.ts` teria que decidir sozinho quando criar um card, hoje quem decide isso é a lógica do workflow).
- Qualquer chamada a serviço externo de terceiro (CRM externo, planilha, sistema de agendamento, etc.) dentro do workflow — isso é o tipo de coisa que só aparece na Fase 2, não tem como prever de antemão.

Produzir uma tabela: `Capacidade do workflow n8n | Já existe no motor nativo? | Gap a implementar | Complexidade estimada`.

## FASE 4 — Relatório final (sem implementar nada ainda)

Apresentar:
1. Lista exata de tenants/instâncias que dependem do n8n hoje (Fase 1).
2. Documentação da lógica real de cada workflow (Fase 2).
3. Tabela de gap (Fase 3).
4. Proposta de plano de migração por etapas — sugestão: implementar os gaps um de cada vez no `agentEngine.ts`, testar em paralelo (`IA_TEST_MODE`, já existe) comparando resposta do n8n vs. resposta do motor nativo pro mesmo histórico de conversa, e só então trocar `n8n_webhook_url` pra vazio nessa instância (rota já cai automaticamente pro motor nativo — ver `webhook.ts`, é só isso que decide entre os dois caminhos hoje).
5. Qualquer achado de segurança/dado sensível dentro do workflow (credenciais hardcoded, etc.) — reportar separado, alta prioridade, independente da decisão sobre a migração.

---

## AO FINALIZAR, REPORTAR

- Quantos tenants/instâncias dependem do n8n hoje, em produção e homolog.
- O que cada workflow faz, em linguagem simples.
- A tabela de gap (Fase 3).
- Proposta de plano de migração por etapas, para decisão do usuário — **não implementar nada desta sessão além do levantamento**.
- Atualizar `STATUS.md`.

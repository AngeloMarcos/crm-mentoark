# Diagnóstico Completo do Sistema — CRM Mentoark (2026-07-24)

Substitui/expande `DIAGNOSTICO_PENDENCIAS_2026-07-24.md`. Compilado de `STATUS.md`, `diagnosticos/AUDITORIA_LOG.md` (histórico completo), `CLAUDE.md`, e verificação direta no código atual (não só nos logs) para os itens da auditoria de fetch/timeout mais recente.

---

## 1. O que está saudável e confirmado funcionando

- **Recebimento de mensagens (bug P2010):** resolvido em definitivo em 21/07 (migração do Evolution pra PostgreSQL + re-pareamento do número). Não é mais um problema.
- **Mensagens de grupo:** chegam normalmente desde 22/07 (`groupsIgnore` estava `true` desde sempre, corrigido). IA nunca responde em grupo, por design confirmado no código.
- **Mídia (áudio/imagem/figurinha) de entrada:** decriptografada e persistida em storage local (antes chegava cifrada e não tocava/exibia).
- **Foto de perfil:** persistida localmente, não expira mais (antes sumia quando a URL do CDN do WhatsApp vencia).
- **Whisper (transcrição de áudio) e Vision (descrição de imagem):** implementados, deployados em homologação, prontos pra validação.
- **Multi-instância:** um tenant já pode conectar um segundo número de WhatsApp, com painel de UI funcional (backend + frontend).
- **SSRF em `GET /api/whatsapp/media`:** corrigido (validação de host).
- **Mensagens efêmeras/"ver uma vez"/documento-com-legenda:** antes eram descartadas silenciosamente, agora capturadas.
- **Limite de payload:** 1mb → 5mb → 50mb (eventos de sincronização em massa da Evolution não são mais descartados).
- **Perda de dados ao desconectar/deletar instância:** corrigida — soft-delete em `whatsapp_messages`, escopo por instância nas 3 tabelas afetadas, checagem de ownership antes de qualquer ação destrutiva na Evolution.
- **Vazamento de dados entre tenants (CRUD genérico + webhook):** dois incidentes reais corrigidos — bypass de admin no `crud.ts` e fallback de webhook que atribuía mensagens órfãs ao admin mais antigo.
- **RLS (isolamento por linha no banco):** piloto funcionando em homologação (`whatsapp_messages`), testado sob simulação de bug de código — bloqueou leitura/escrita cross-tenant com sucesso.
- **Motor de IA (debounce + antiloop):** auditado a fundo, sem race condition real — buffer de 3s + lock por telefone funcionam como esperado.
- **Motor de disparo em lote:** sem duplicidade sob concorrência (`FOR UPDATE SKIP LOCKED`), com retry/backoff, teto diário antiban, e respeito a horário/fim de semana.
- **Deploy:** processo corrigido e centralizado (`scripts/deploy.sh`), risco de apontar pro diretório errado eliminado.
- **Evolution de produção e homologação:** já são servidores separados (`fierceparrot-evolution.cloudfy.live` para homolog desde 22/07) — não compartilham mais instância/API.

## 2. IA / Chat de atendimento — pendente

- **Whisper/Vision só em homolog** — aguardando você mandar áudio e foto de teste no WhatsApp de homolog antes de ir pra produção.
- **Kanban de vendas + Inbox unificada:** código pronto, migrations só rodaram em homolog, `InboxPanel.tsx` não está roteado em nenhuma página — invisível hoje.
- **Teto antiban por usuário, não por chip:** com multi-instância real, um número "queima" o limite dos outros. Precisa de coluna `instancia` em `disparo_logs`.
- **`agentEngine.ts`:** checagem de `agentConfig?.motor_ia` nunca é `true` — coluna talvez nem exista, risco baixo, nunca verificado a fundo.
- **`humanizationService.ts`:** usa chave OpenAI global, não a do provider por usuário (só afeta disparos em massa).
- **`Agentes.tsx`:** `testarEvolution()` não testa a instância específica do agente — pode dar falso positivo agora que multi-instância existe.
- **Multi-instância Sprints 3-4:** validação com 2 números reais simultâneos via clique real na UI, e escolha de qual chip responder numa conversa — não feitos.

## 3. Segurança / Multitenant — pendente

- **`N8N_SECRET` não configurado em nenhum `.env`** — toda chamada a `/api/n8n/*` retorna 401 hoje, inclusive de automação legítima. Precisa da sua confirmação: essa integração deveria estar ativa?
- **RLS só em homologação** — decisão pendente de levar pra produção.
- **Instância órfã `crm_5319f0ed61b3`** — reapareceu sozinha após ser deletada, sem vínculo em nenhuma tabela. Decisão: apagar de vez ou deixar disponível.
- **32 mensagens do Stefano soft-deletadas** (incidente de exclusão indevida) — aguardando confirmação pra restaurar.
- **Rota `agent_configs`:** frontend chama `/api/agent_configs` (não existe), real é `/api/agent-config` — tela `ConfigAgenteIA.tsx` provavelmente falha silenciosamente. Além disso, a rota real descarta 4 colunas no insert. Análise pronta, fix não implementado.
- **Sem backup automatizado do Postgres** — já causou perda de dados definitiva uma vez.

## 4. Achados técnicos de fetch/timeout — 🔧 CORRIGIDOS (2026-07-24)

Todas as 32 chamadas sem timeout em 11 arquivos foram corrigidas, verificado no código (não só no relatório): `humanizationService.ts` (1, AbortController 15s — era a de maior blast radius), `catalogo.ts` (5 → `evolutionFetch`), `mcp.ts` (1 → `evolutionFetch`), `whatsapp.ts` (16 → `evolutionFetch`), `auth.ts` (3, AbortController 10s), `marketing.ts` (6, AbortController 10s), `ai-providers.ts` (3), `elevenlabs.ts` (5), `leads-buscar.ts` (2), `functions.ts` (1 → `evolutionFetch`), `kanban.ts` (1). Build (`swc`) e `tsc --strict` isolado por arquivo passaram limpos.

`contatos.ts` também corrigido: filtro de coluna arbitrária (`?campo_ilike=`) trocado de regex solta pra whitelist explícita de colunas — confirmado no código.

Nenhum SQL Injection real foi encontrado nesta varredura (todo valor de usuário vai por parâmetro `$N`, nomes de tabela/coluna são fixos ou passam por whitelist).

**Ainda não deployado** — só commit local, conforme padrão de auditoria (deploy é passo separado).

## 5. Infraestrutura — pendente

- **VPS com 3.8GB RAM pra 19 containers** — 6 containers de observabilidade sem `mem_limit`. Decisão: configurar limites, redimensionar, ou mover outros projetos (`pdv_prod`/`hemoclinic_prod`) pra outro servidor.
- **n8n com `DB_TYPE=mysqldb` inválido**, caindo em SQLite — em standby, nunca investigado.

## 6. Débito técnico menor / baixo impacto

- `telefone ILIKE '%...'` sem índice — arquitetura de fix pronta (coluna gerada + índice), falta rodar migração/backfill.
- 3 polling intervals redundantes em `WhatsAppInterface.tsx`.
- `TesteConversas.tsx` (ferramenta DEV) com painel de comparação que não compara nada de verdade.
- `UsuariosAcessos.tsx` — botão "remover admin" provavelmente já quebrado (bug funcional, não segurança).
- Backfill de mídia antiga incompleto (reconciliação de gaps por instância, painel do que não foi recuperado).
- **`STATUS.md` desatualizado:** a seção "Pendências abertas" ainda lista o P2010 como crítico/aberto, resolvido há 3 dias — vale limpar numa próxima sessão pra não confundir.

---

## Prioridade sugerida

1. Validar Whisper/Vision em homolog (destrava produção) — ação sua.
2. Corrigir os fetches sem timeout, na ordem de blast radius: `humanizationService.ts` → `catalogo.ts` → `whatsapp.ts` → resto. Mecânico, baixo risco, não depende de decisão sua.
3. Decidir `N8N_SECRET` (integração ativa ou não).
4. Configurar backup do Postgres — ganho puro, sem dependência.
5. Decidir rollout de RLS pra produção.

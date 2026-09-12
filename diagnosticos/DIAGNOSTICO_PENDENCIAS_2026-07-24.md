# Diagnóstico — Pendências e Oportunidades de Melhoria (2026-07-24)

Compilado a partir de `STATUS.md` + `diagnosticos/AUDITORIA_LOG.md` (histórico completo até 2026-07-24). Nota inicial importante: a seção "Pendências abertas" do `STATUS.md` está desatualizada em pelo menos um ponto crítico — lista o bug P2010 do Evolution como aberto, mas o log confirma que foi **resolvido em definitivo em 2026-07-21** (migração pra PostgreSQL + re-pareamento do número). Recomendo limpar essa seção do `STATUS.md` numa próxima sessão pra parar de confundir sessões futuras.

---

## 1. IA / Chat de atendimento (seu foco atual)

- **Whisper (áudio) e Vision (imagem) só em homologação.** Implementados e deployados, mas aguardando você mandar um áudio e uma foto de teste no WhatsApp de homolog pra confirmar transcrição/descrição antes de ir pra produção. **Ação sua, não técnica.**
- **Kanban de vendas + Inbox unificada:** rotas e frontend (`InboxPanel.tsx`) já existem em produção, mas **não estão importados/roteados em nenhuma página** — feature invisível hoje. As migrations que criam as tabelas (`pipelines`, `deals`, `conversations`) só rodaram em homolog, não em produção. Precisa de decisão: quando rodar as migrations em prod e plugar o painel numa rota real.
- **Teto diário antiban por usuário, não por instância/chip.** Agora que multi-instância é real (um tenant pode ter vários números), o limite de disparo de 500 msgs/dia é somado entre todos os chips do mesmo usuário — um chip "queima" o limite dos outros. Precisa de coluna `instancia` em `disparo_logs`.
- **`agentEngine.ts`: checagem `agentConfig?.motor_ia` nunca é `true`** (coluna não vem no SELECT, não confirmado se existe de verdade em produção) — risco baixo mas nunca verificado a fundo.
- **`humanizationService.ts` usa chave OpenAI global**, não a do provider configurado por usuário — só afeta disparos em massa (não o chat principal), fix pendente se não for intencional.
- **`Agentes.tsx` — `testarEvolution()` não testa a instância específica do agente**, pode dar falso positivo "conectado" quando na verdade é outra instância que está aberta. Ganhou mais relevância agora que multi-instância existe de verdade.
- **Multi-instância — Sprints 3 e 4 do plano ainda não feitos:** validação com dois números reais conectados simultaneamente testada por clique real na UI (só via API direta até agora); e o frontend ainda não deixa escolher por qual chip responder uma conversa que chegou por um número não-padrão.

## 2. Segurança / Multitenant

- **`N8N_SECRET` não está configurado em nenhum `.env`** (produção nem homolog) — hoje **toda** chamada a `/api/n8n/*` é rejeitada com 401, inclusive de uma automação n8n legítima. Preciso que você confirme: essa integração deveria estar ativa? Se sim, é só configurar o segredo; se a automação real usa outro caminho, dá pra ignorar.
- **RLS (isolamento por linha no banco) só está ativo em homologação**, só na tabela `whatsapp_messages` — funcionou no teste de estresse (bloqueou leitura/escrita cross-tenant mesmo simulando um bug de código). Decisão pendente: levar pra produção.
- **Instância órfã `crm_5319f0ed61b3`** foi deletada mas reapareceu sozinha horas depois gerando QR novo — sem vínculo em nenhuma tabela, não afeta ninguém, mas seria bom decidir se apaga de vez ou deixa disponível.
- **32 mensagens do Stefano soft-deletadas** (do incidente de exclusão indevida em 07-22) seguem fora da tela — aguardando você confirmar se restaura.
- **`agent_configs` — rota do frontend (`/api/agent_configs`) não existe, só `/api/agent-config`** (singular/hífen) — tela `ConfigAgenteIA.tsx` provavelmente falha silenciosamente hoje. Além disso, a rota real descarta 4 colunas no insert (`tempo_espera_mensagem`, `tempo_espera_resposta`, `modelo_parser`, `grupo_notificacao`). Análise pronta, fix não implementado — precisa reescrever o front pra chamar a rota certa.
- **Sem backup automatizado do Postgres.** Já causou perda de dados definitiva uma vez (5 mensagens, incidente de 07-21). Continua sem `pg_dump` agendado.
- **Evolution de produção e homologação compartilham a mesma instância/número** — testar em um ambiente pode derrubar o outro. Bloqueado por falta de número dedicado pra homolog.

## 3. Infraestrutura

- **VPS estruturalmente sem memória** (3.8GB RAM / 19 containers) — 6 containers de observabilidade (Prometheus/Loki/Grafana/Alloy/cAdvisor/node-exporter) ainda sem `mem_limit`. Decisão pendente: configurar limites, redimensionar a VPS, ou mover `pdv_prod`/`hemoclinic_prod` (projetos de outros clientes) pra outro servidor.
- **n8n com `DB_TYPE=mysqldb` inválido**, caindo em SQLite silenciosamente — em standby, nunca investigado.

## 4. Débito técnico menor (baixa prioridade, sem decisão bloqueante)

- `telefone ILIKE '%...'` ainda não migrado pra E.164 — arquitetura de fix já documentada (coluna gerada + índice), só falta rodar a migração/backfill.
- 3 polling intervals redundantes em `WhatsAppInterface.tsx` — funcionam, mas são ineficientes; consolidação pendente.
- `TesteConversas.tsx` (ferramenta DEV) com painel de comparação que não compara nada de verdade — baixo impacto, ninguém depende disso em produção.
- `UsuariosAcessos.tsx` — botão "remover admin" provavelmente já quebrado (400) por bug pré-existente, não é falha de segurança.
- Backfill de mídia antiga incompleto (Sprints C/D do plano de mídia: reconciliação de gaps por instância e painel do que não foi recuperado) — não implementados.

---

## Sugestão de prioridade se for escolher por onde continuar

1. Validar Whisper/Vision em homolog (é só seu teste, destrava o deploy em produção).
2. Decidir sobre `N8N_SECRET` (integração ativa ou não) — resolve rápido e evita confusão futura.
3. Decidir sobre levar RLS pra produção (rede de segurança contra o tipo de incidente que já aconteceu 2x).
4. Configurar backup do Postgres — não depende de nenhuma outra decisão, é puro ganho de segurança.

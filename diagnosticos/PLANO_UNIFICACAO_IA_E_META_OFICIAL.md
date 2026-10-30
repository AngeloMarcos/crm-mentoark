# Plano — Unificar a configuração da IA + API oficial da Meta

Data: 2026-10-29. Resposta ao prompt "unificar Configuração da IA + integrar API Oficial da Meta".
**Status: aguardando aprovação. Nada desta lista foi codado, exceto a IA-1 (já em homolog).**

## 0. Correções de premissa do prompt

- **Não usamos Supabase nem Edge Functions.** O backend é Express/TypeScript (`backend/src`) com
  PostgreSQL 16 + pgvector próprio. O `api.from(...)` do frontend é um cliente HTTP que imita a interface
  do Supabase. Onde o prompt diz "Edge Function", leia "rota/serviço do Express". Onde diz "Vault", leia
  AES-256 com `ENCRYPTION_KEY`, que já é usado em `ai_providers` e `whatsapp_oficial_config`.
- **RLS**: o isolamento é feito por `user_id` em todas as rotas, com piloto de RLS só em homolog.
  As tabelas novas seguem o mesmo padrão.
- **Boa parte da Parte B já existe** (ver seção 3). O plano cobre só as lacunas.

## 1. Diagnóstico com dados reais (produção, 2026-10-29)

| Achado | Dado | Efeito |
|---|---|---|
| **A IA está parada** | 0 execuções em 7 dias; o log mostra "Agente sem prompt configurado" | os clientes não recebem resposta |
| Agentes ativos sem prompt | **20 de 23** ativos têm `prompt_sistema` vazio | ligados, mas mudos, sem nenhum alerta |
| Chave OpenAI do servidor | `OPENAI_API_KEY` → **401** | contas sem chave própria (6 com agente ativo) não têm IA |
| Chaves das contas (`ai_providers`) | 3 cadastradas: **1 válida, 2 com 401** (incluindo a da Mentoark) | quem tem chave própria também está sem IA |
| Modelo do agente | o motor usa `providerInfo.modelo \|\| agente.modelo` | **o modelo escolhido no agente é ignorado** quando a conta tem provedor |
| Base de conhecimento | 43 itens (persona 20, negócio 23), **nenhum lido pelo motor** | Persona e Negócio do `/cerebro` não chegam à IA interna (só o n8n os usava) |
| RAG | `documents` com 0 linhas; o motor ignora `rag_ativo`, `rag_threshold` e `rag_resultados` do agente | "RAG ativo" na tela não tem efeito; o embedding usa a chave do servidor (401) |
| Indexação | `conhecimento.indexado = false` em tudo; o upload diz "reindexe via n8n" | o status "Pendente" nunca muda |
| Configuração duplicada | `agent_configs` (5 linhas) e `agent_prompts` (3 versões, 1 ativa) ainda têm rotas e telas (`/cerebro` → Prompt/Configs) | duas fontes de verdade |
| Número oficial | `whatsapp_oficial_config` com 0 linhas; `FACEBOOK_APP_ID` e `META_ES_CONFIG_ID` vazios | "Conectar pela Meta" indisponível |

**Recomendação antes de qualquer código (operacional, só você pode fazer):** gerar uma chave nova na
OpenAI e trocar a do servidor e a da conta Mentoark. Sem isso, nada do plano aparece funcionando.

## 2. Fase 1 — Parte A: uma fonte de verdade para a IA

Já entregue (**IA-1**, em homolog): espera para agrupar mensagens, histórico, divisão da resposta, emojis,
idioma, assinatura e mensagem de erro por agente.

| # | O que | Como (arquivos) |
|---|---|---|
| A0 | **Saúde da chave da IA** | `ai-providers.ts`: testar a chave ao salvar, gravar `ultimo_teste_em`, `ultimo_status` e `ultimo_erro`, e retestar 1x/dia. Badge "Chave recusada" em Integrações e no card do agente. Motor: **o agente escolhe o modelo e o provedor só fornece a chave** (corrige a precedência). |
| A1 | Agente é o dono de prompt, modelo, RAG, voz e comportamento | `/cerebro` vira **"Base de Conhecimento"**: saem as abas Fluxo IA, Testar, Prompt e Configs, e Voz vai para dentro do agente. Migration: `agent_prompts` → `agente_prompt_versoes (agente_id)`; o que só existir em `agent_configs` é copiado para `agentes` sem sobrescrever o que já está preenchido. As rotas antigas ficam só de leitura por uma release e depois saem. |
| A2 | Conhecimento por agente | `conhecimento.agente_id UUID NULL` (NULL = todos os agentes), `status_indexacao`, `erro_indexacao`, `indexado_em`. Seletor "usar em: todos / agente X". Correção do dado "Agewndar reuniao". |
| A3 | **Indexação automática** | Rota própria `routes/conhecimento.ts` (sai do `makeCrud`): ao salvar ou excluir, faz chunk + embedding → `documents (conhecimento_id, agente_id)`, com fila em memória e retry. Status `pendente → indexando → indexado / erro (motivo)` e botão Reindexar. **O embedding passa a usar a chave da conta**, com a do servidor como reserva. CSV fica só como import/export em massa. |
| A4 | O motor usa o RAG do agente | `buscar_documentos` filtra por `agente_id` (dele + compartilhados) e respeita `rag_ativo`, `rag_resultados` e `rag_threshold`. Persona e Negócio entram no **prompt gerado** (A5); FAQs, Objeções e Scripts entram pelo RAG. Alerta "RAG ligado com base vazia". |
| A5 | **Gerar prompt + preview + versões** | Função única `montarSystemPrompt()` usada pelo motor, pelo playground e pelo preview, para mostrar exatamente o que a IA recebe. Botão "Gerar prompt" a partir de Comportamento + Persona + Negócio + escopo. Versões: salvar, ativar e restaurar. O n8n busca o prompt ativo por `GET /api/n8n/agentes/:id/prompt` (já autenticado por `x-n8n-secret`), sem copiar e colar. |
| A6 | Validação e saúde do agente | Bloqueia ativar sem prompt. Card com badges: "Não responde: prompt vazio", "Sem canal", "Chave recusada", "Base vazia" e "Último erro". Nome duplicado → sugere o nome do número. **Os 20 agentes mudos não são desativados automaticamente**: ganham badge, e você decide. |
| A7 | Motor explícito | Coluna `motor ('interno'\|'n8n')` (backfill: n8n onde houver URL). Select na aba Canal. Sai a aba Integração (vazia) e fica uma aba Teste só. Ajuda explicando "palavra para reativar" e "sinal de pausa". |
| A8 | Tela em 4 abas (IA-2) | Página `/agentes/:id`: Perfil, Configurações, Execuções, Teste, mais Canal e Conhecimento como seções. Número, proxy e status saem para Conexões. |

Migrations aditivas e reversíveis (colunas novas NULL e tabela nova). Nada é apagado na Fase 1.

## 3. Fase 2 e 3 — Parte B: o que já existe e o que falta

| Item do prompt | Situação | Lacuna a fazer |
|---|---|---|
| B1 Canal com `provider` | Parcial: Evolution = linha de `agentes` (`evolution_instancia`); Meta = `whatsapp_oficial_config` (`agente_id`), com prefixo `meta_oficial:` no motor | Tabela `canais_whatsapp (provider, ref, agente_id)` com backfill das duas origens. O agente escolhe o canal num **select**. Interface `WhatsAppProvider` (`enviarTexto/Midia/Template/Interativo`, `marcarLido`, `baixarMidia`) envolvendo o código atual, com motor e inbox chamando só a interface. |
| B2 Cadastro manual | **Existe** (`/meta-oficial/configs`, teste de 4 itens, token criptografado e nunca devolvido) | Mostrar `verified_name`, qualidade e limite ao salvar; mostrar só os 4 últimos dígitos do token. |
| B2 Embedded Signup | **Código existe** (`embeddedSignup.ts`, v4, coexistência, `subscribed_apps`, `register` com PIN) | **Depende da decisão do app Meta** (próximo item) e das envs. |
| B3 Webhook | **Existe**: verificação GET, `X-Hub-Signature-256`, inbox idempotente, statuses com erro e pricing, qualidade, templates, opt-out, coexistência | **Mídia recebida**: `GET /{media_id}` → baixar → `/uploads` → Whisper/Vision (hoje não baixa). `mark as read` + digitando. Resposta 200 antes de processar (conferir). |
| B4 Janela de 24h | Gravada em `contatos.janela_oficial_ate` (72h para anúncio) | **O motor não confere a janela** antes de responder: fora dela, usar o template de retomada configurado no canal ou avisar o humano. |
| B4 Templates | **Existe**: sincronizar, criar com exemplos, excluir, motivos em português | Mapeamento de variáveis → campos do contato no envio pela IA. |
| B4 Disparos oficiais | **Existe** (`disparoOficial.ts`): só template + opt-in, estimativa de custo e custo por campanha | Esconder aquecimento e score da Evolution nos canais Meta, mostrando qualidade, tier e taxa de falha. |
| B4 Escopo | Existe (`escopo_ia` injetado no prompt) | Bloquear vincular um agente **sem escopo** a um canal Meta. |
| B4 Custos | Pricing gravado por status | Custo por agente na aba Execuções. |
| B5 Checklist + migrar | Checklist existe | Botão "Migrar para API oficial" no card da instância → Embedded Signup em coexistência, mantendo contatos e histórico. |

**Pré-requisito da Fase 2: decidir o app Meta.** (A) reaproveitar o app `1651234338702109` já usado
pelo Cubo, com `override_callback_uri` por WABA, ou (B) criar um app novo e passar pelo App Review.
Detalhes em `engenharia_reversa_suite/RELATORIO_IA_E_META_CUBO.md`.

## 4. Impacto no n8n

Só 2 workflows existem e estão inativos (memória de 2026-07-24). Nenhum fluxo depende do "copiar para n8n".
O endpoint de prompt ativo (A5) atende quem voltar a usar.

## 5. Testes por fase

- **Fase 1**: unitários de `montarSystemPrompt`, chunking e filtro de RAG por agente; integração da indexação
  (salvar → status indexado; excluir → remove chunks); validação de ativação.
- **Fase 2**: webhook com assinatura válida e inválida, evento duplicado (idempotência), mídia (download
  simulado), status `failed` com código, janela fechada → template.
- Toda fase: homolog → validação na tela → produção com `scripts/deploy.sh prod --confirm`.

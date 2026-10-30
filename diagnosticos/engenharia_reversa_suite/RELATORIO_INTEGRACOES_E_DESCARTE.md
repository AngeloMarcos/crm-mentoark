# Integrações num lugar só (modelo Cubo) + inventário de descarte

Data: 2026-10-29. Fontes: props Inertia de `/integrations`, `/integrations/create`, `/integrations/:id/openai`,
`/integrations/:id/whatsapp-business`, `/settings/channels/:id/edit` e `GET /api/integrations/:id/ai-models`,
o chunk `const-*.js` (catálogo de tipos) e a OpenAPI. Nenhum segredo foi salvo.

---

## 1. Como o Cubo organiza IA e integrações

### Uma tabela, um `type`, uma tela por tipo
Tudo é **integração**: uma linha em `integrations` (`id, name, type, status active|deactivated`, segredos
guardados à parte e nunca devolvidos, só `hasApiKey` / `hasToken`). O catálogo tem 16 tipos, nesta ordem:

| `type` | Rótulo | Tela de edição |
|---|---|---|
| webhook | Webhook | `/integrations/:id/webhook` |
| conversas | Cubo Conversas | `.../conversas` |
| facebook | Facebook Lead Ads | `.../facebook` (OAuth) |
| rd | RD Station | `.../rd` (OAuth) |
| cubo_email | Cubo Email | `.../cubo-email` |
| facebook_conversion_api | Facebook Conversion API | `.../facebook-capi` |
| google_data_manager | Google Ads | `.../google-ads` |
| verdata | Verdata | `.../verdata` |
| **whatsapp_business** | WhatsApp Business (oficial) | `.../whatsapp-business` |
| zapi | WhatsApp não oficial (Z-API) | `.../zapi` (aviso de risco de ban) |
| instagram | Instagram | `.../instagram` |
| calcom | Cal.com | `.../calcom` |
| **elevenlabs** | ElevenLabs (voz) | `.../elevenlabs` |
| **openai** | OpenAI (IA) | `.../openai` |
| **google_ai** | Google AI Gemini (IA) | `.../google-ai` |
| **openrouter** | OpenRouter (IA) | `.../openrouter` |

Comum a todos: listar com filtro e ordenação (nome, tipo, status, criação), **ligar/desligar**
(`/toggle`), **logs** (`/logs`), lixeira com restaurar ("volta desativada"), excluir em massa e
"desconectar" (`/disconnect`).

### A integração com o ChatGPT (`type = openai`)
- A tela tem só: **nome**, **chave de API** (`sk-...`, só de escrita; a tela mostra apenas "chave configurada"),
  **consumo** da integração (`aiUsage`) e o botão **Desconectar**.
- **Os modelos não ficam na integração.** `GET /api/integrations/:id/ai-models` lista ao vivo os modelos
  que **aquela chave** enxerga (120 na conta OpenAI da Mentoark), com `capabilities` e
  `toolsUnsupported` (modelo sem ferramentas = agente roda sem os chips).
- Validação da chave: `POST /api/integrations/google-ai/validate-key` e `.../openrouter/validate-key`.
- **O agente escolhe `integrationId` + `model`.** Trocar a chave não mexe em agente nenhum, e vários agentes
  podem usar a mesma integração com modelos diferentes.
- **Transcrição** também aponta para uma integração: o canal tem `transcriptionIntegrationId` + `transcriptionModel`.

### WhatsApp oficial (`type = whatsapp_business`)
- A tela mostra `isConnected`, `fbAppId`, `fbConfigId`, **`hubSignupUrl`** e `phoneNumbers[]`
  (número, `qualityRating`, `messagingLimitTier`, `isOnBizApp` (coexistência), `registered`, `registerError`),
  `userMappings` (número ↔ usuário) e `adsReadEnabled`.
- **`hubSignupUrl` aponta para `conexao.me/whatsapp?state=<JWT>`.** O Embedded Signup roda num domínio
  central do Cubo (hub) que atende todos os white-labels. O `state` assinado leva a origem, a integração, o app e o config_id.
- Cada número vira um **canal** (`/settings/channels`): `integrationId`, `provider: meta_cloud`,
  `defaultAgentId`, `defaultAutomationId`, departamento, SLA, transcrição e `capabilities`.

### Resumo do modelo
```
Integração (onde está a credencial)  →  Canal (o número/inbox)  →  Agente (o cérebro)
  openai / google_ai / openrouter ────────────────────────────────→ agente.integrationId + model
  elevenlabs ─────────────────────────────────────────────────────→ voz do agente
  whatsapp_business / zapi ──→ canal.integrationId ──→ canal.defaultAgentId
```

---

## 2. Como está o nosso hoje (espalhado)

| Credencial / configuração | Onde mora | Tela |
|---|---|---|
| Chave OpenAI/Claude | `ai_providers` (com **modelo fixo** dentro) | Integrações → "Configuração de IA" e Monitor WhatsApp |
| Chave OpenAI global | env `OPENAI_API_KEY` (**401**) | nenhuma |
| Evolution, n8n e "OpenAI" | `integracoes_config` (espelhada em `agentes`) | Integrações ("Conectores") e Segurança → Chaves |
| ElevenLabs | rota própria `/api/elevenlabs` + `agentes.voice_id` | Integrações + Cérebro → Voz |
| WhatsApp oficial | `whatsapp_oficial_config` | WhatsApp → API Oficial |
| Meta Ads / Lead Ads / CAPI | `routes/marketing.ts` (tokens) | Marketing Digital → Conta Meta |
| Número Evolution | **colunas da própria tabela `agentes`** (instância, URL, chave, proxy, score...) | Agentes → WhatsApp + WhatsApp → Instâncias |
| Prompt/modelo legado | `agent_configs`, `agent_prompts` | Cérebro → Prompt/Configs |
| n8n | `agentes.n8n_webhook_url`, `/api/n8n` (x-n8n-secret) | Agentes → WhatsApp, Cérebro → Testar |

**Proposta, seguindo o Cubo:**
1. Uma tabela `integracoes (id, user_id, tipo, nome, status, config jsonb, segredo_enc, ultimo_teste_em, ultimo_status, ultimo_erro)`
   com os tipos `openai | claude | google_ai | openrouter | elevenlabs | evolution | whatsapp_oficial | meta_ads | webhook | n8n`.
   Backfill a partir de `ai_providers`, `integracoes_config`, `whatsapp_oficial_config` e marketing.
   As tabelas antigas ficam só de leitura por uma release.
2. **Uma página `/integracoes`**: lista + "Nova integração" (catálogo) + tela por tipo + ligar/desligar + logs + testar.
3. Agente: `integracao_id` + `modelo`, com o **select de modelos vindo da chave** (`GET /api/integracoes/:id/modelos`).
   Chave recusada = badge vermelho.
4. Canal: `canais (integracao_id, agente_id, ...)`. O número sai de dentro de `agentes` (é o B1 do plano).

---

## 3. Descarte

### Já removido nesta entrega (git rm, reversível pelo histórico)
| Item | Por quê |
|---|---|
| `supabase/` (config + 26 migrations) | Era do Lovable/Supabase. O schema real é `backend/src/migrations.ts`, e nada lia essa pasta. |
| `src/integrations/supabase/*` (stub + types) | O stub devolvia `{data:null}` para qualquer chamada. Ninguém importava. |
| `src/integrations/lovable/index.ts` + dependência `@lovable.dev/cloud-auth-js` | Login do Lovable, sem nenhum uso. |
| `src/integrations/database/types.ts` | Tipos gerados da época do Supabase, sem import. |
| CORS liberando `*.lovable.app` / `*.lovableproject.com` | **Risco de segurança**: qualquer app hospedado no Lovable podia chamar a nossa API pelo navegador. |
| CSS anti-selo do Lovable no `index.html` | Não há mais selo. |
| `src/components/cerebro/ConfigAgenteIA.tsx` | Tela aposentada na unificação de 2026-08-07 e sem uso. |
| `src/data/mockData.ts`, `src/lib/api.ts`, `src/pages/Index.tsx` | Sem import (mock de abril, cliente duplicado e redirect que já fica no `App.tsx`). |
| `backend/src/routes/suporte.ts` + `services/suporte.ts` | **Cópias quase idênticas** do Copiloto. O montado é `suporte_copiloto`. |
| `backend/src/routes/admin_infra.ts` | Nunca montado. O painel usa `admin_firewall`. |

### A descartar junto com a unificação (depende de migrar antes)
| Item | Quando |
|---|---|
| Abas Fluxo IA, Testar, Prompt e Configs do `/cerebro` + `PromptAgente.tsx`, `Configuracoes.tsx`, `TestarAgente.tsx` | Fase 1 (A1), depois de migrar `agent_prompts` para as versões do agente |
| `routes/agent-config.ts` + tabela `agent_configs` | Fase 1, depois de copiar o que faltar para `agentes` |
| `routes/agent_prompts.ts` + tabela `agent_prompts` | Fase 1 (A5) |
| `ai_providers`, `integracoes_config` | Depois do backfill para `integracoes` (seção 2) |
| `agentes.n8n_webhook_url` → coluna `motor` | Fase 1 (A7) |
| Fallback `OPENAI_API_KEY` do servidor no motor | Quando todas as contas tiverem integração própria. Hoje ele está com 401 de qualquer jeito. |
| Segredo padrão `'mentoark-kanban-secret-2025'` no código do motor | Mover para env obrigatória (é segredo hardcoded) |

### Não é lixo, é decisão sua
| Item | Situação |
|---|---|
| `components/whatsapp/InboxPanel.tsx` (Sprints A–C Kanban/Inbox) | Pronto, mas nunca roteado em produção |
| `services/grupoTarefaEngine.ts` | Tarefa a partir de mensagem de grupo autorizado. Escrito, nunca ligado |
| 13 componentes `src/components/ui/*` sem uso (carousel, drawer, menubar...) | Peças do shadcn. Inofensivas, podem ficar |
| `n8n_chat_histories` | **Em uso**: é onde o motor guarda o histórico. Só o nome é legado. |

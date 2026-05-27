# Sprint F — Frontend do Motor de IA Nativo

Backend novo (AI Engine, MCP, multimodal, migração PG) é responsabilidade do Claude Code no VPS. Aqui só faço o frontend Lovable e **defino o contrato de API** que o backend vai expor.

A página `/agentes` já existe com 749 linhas (CRUD de agentes, prompt, modelo, tom, RAG, Evolution). Vou **estendê-la** para suportar o novo motor sem quebrar o que já funciona, e criar um **Dashboard de Uso de IA** novo.

---

## 1. Estender `src/pages/Agentes.tsx`

Adicionar à interface `Agente` e ao formulário 4 blocos novos:

**a) Bloco "Provedor de IA"** (substitui o select de `modelo` plano)
- Select de **Provider**: Claude (Anthropic) · OpenAI · Google Gemini
- Select de **Modelo** dependente do provider:
  - Claude → haiku, sonnet, opus
  - OpenAI → gpt-4o, gpt-4o-mini
  - Gemini → flash, pro
- Badge de custo estimado por mensagem (tabela do plano)

**b) Bloco "Modalidades"** (toggles)
- Áudio (transcrição via Whisper)
- Imagem (visão)
- Vídeo (extração de áudio) — marcado como "em breve", desabilitado

**c) Bloco "Ferramentas MCP"** (lista checkbox)
- buscar_contato · criar_contato · buscar_historico · buscar_leads · criar_lead · atualizar_lead · buscar_produtos · buscar_agendamentos · criar_agendamento · registrar_pausa_ia
- Por padrão todas ligadas; permite desligar individualmente

**d) Limpeza**
- Manter `n8n_webhook_url` no schema mas esconder do formulário com um aviso "Legacy — será removido"
- O campo `modelo` antigo continua sendo enviado (compat) mas derivado de `provider + modelo_id`

## 2. Nova página `src/pages/UsoIA.tsx` (rota `/uso-ia`)

Dashboard simples consumindo o endpoint novo `GET /api/ia/uso`:

- **Cards no topo**: Mensagens hoje · Tokens hoje · Custo estimado hoje · Custo no mês
- **Gráfico de linha**: tokens/dia últimos 30 dias (recharts já está no projeto)
- **Gráfico de pizza**: distribuição por modalidade (texto/áudio/imagem)
- **Tabela**: últimas 20 execuções (agente, modelo, modalidade, tokens in/out, custo, latência, status)
- **Filtros**: range de datas, agente, provider

Adicionar item no Sidebar "Uso de IA" (ícone `Activity`), visível para admin.

## 3. Hook `src/hooks/useUsoIA.ts`

- `useUsoIA({ from, to, agenteId? })` → fetch + cache simples
- `useUltimasExecucoes(limit)` → polling 10s opcional

## 4. Contrato de API esperado do backend

Documento a ser entregue ao Claude Code:

```
GET  /api/ia/uso?from=ISO&to=ISO&agente_id?=
     → { mensagens, tokens_in, tokens_out, custo_brl,
         por_dia: [{ dia, tokens, custo }],
         por_modalidade: [{ modalidade, count }] }

GET  /api/ia/execucoes?limit=20&agente_id?=
     → [{ id, agente_id, agente_nome, provider, modelo,
          modalidade, tokens_in, tokens_out, custo_brl,
          latencia_ms, status, created_at }]

PATCH /api/agentes/:id  (extensão dos campos atuais)
     body adicional: { provider, modelo_id, modalidades: {audio,imagem,video},
                       mcp_tools: string[] }
```

## 5. Limpezas / Memória

- Atualizar `mem://features/architecture` com a decisão "Provider abstrato + modalidades por agente"
- Não tocar em `/cerebro` (continua funcional até backend migrar)
- Não remover n8n do código ainda — só esconder

---

## Detalhes técnicos

- Tudo via `api` em `src/integrations/database/client.ts` (HTTP wrapper já existente, JWT no localStorage)
- Tokens semânticos do design system (sem cores hardcoded)
- shadcn já instalado: Card, Select, Switch, Slider, Tabs, Dialog, Badge, Table
- Recharts já presente para os gráficos
- PT-BR em toda a UI
- Endpoints novos retornam 404 hoje → mostrar empty state "Aguardando backend do motor nativo" em vez de quebrar

## Fora do escopo (backend / Claude Code no VPS)

AI Engine, MCP embutido, providers Claude/OpenAI/Gemini, pipeline Whisper, processamento de imagem, migração PostgreSQL, remoção do n8n, novas tabelas `ia_execucoes` / colunas extras em `agentes`.

## Próximo passo após aprovar

Implemento na ordem: (1) extensão do form em `Agentes.tsx`, (2) hook `useUsoIA`, (3) página `UsoIA.tsx`, (4) item no Sidebar, (5) atualização da memória.

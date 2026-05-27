# Auditoria Frontend — O que falta para o Lovable

> Gerado em: 2026-05-26 | Auditor: Claude Sonnet 4.6
> Sem alterações de código — apenas leitura e análise.

---

## Sprint L1 — Campo n8n_webhook_url na página Agentes

**Status:** FALTA TUDO

- O que falta:
  - [ ] Adicionar `n8n_webhook_url: string | null` à interface `Agente` (linha 45)
  - [ ] Adicionar `n8n_webhook_url: ""` ao objeto `formInicial` (linha 73)
  - [ ] Popular `n8n_webhook_url` ao abrir edição em `abrirEditar()` (linha 144)
  - [ ] Incluir `n8n_webhook_url` no `payload` de `salvar()` (linha 177)
  - [ ] Adicionar campo `<Input>` no modal (aba "whatsapp" ou nova aba "N8N") após o campo "Nome da Instância" (~linha 624)
  - [ ] Adicionar badge no card de listagem indicando se agente tem n8n conectado (~linha 320)

- Arquivo: `src/pages/Agentes.tsx`
- Linha para inserir campo no modal: após linha 632 (fim do bloco de "Nome da Instância")
- Linha para inserir badge no card: após linha 332 (bloco `<div className="flex flex-wrap gap-2">`)
- Observação positiva: o `salvar()` já usa `api.from("agentes").update()` / `.insert()` que vai para o backend REST via PUT/POST — sem Supabase real.

---

## Sprint L2 — Botão Pausar/Reativar no ContatoDetalhe

**Status:** PARCIALMENTE FEITO

- O que **existe** (mas está errado):
  - Botões "Pausar IA" e "Reativar IA" já existem na UI (linhas 199–222)
  - `iaAtiva` calculado na linha 180: `const iaAtiva = contato.atendimento_ia === true`

- O que falta:
  - [ ] Corrigir tipo em `DadoCliente`: `atendimento_ia: boolean | null` → `atendimento_ia: string | null` (linha 29)
  - [ ] Corrigir `iaAtiva`: `=== true` → `=== 'ativo'` (linha 180)
  - [ ] Substituir `toggleIA` (linha 130) para chamar `PATCH /api/contatos/:id/pausa-ia` via fetch + `authHeader()` em vez de `api.from("dados_cliente").update()`
  - [ ] Resolver mismatch de ID: a página usa `dados_cliente.id` (BIGSERIAL) mas a rota backend espera `contatos.id` (UUID) — ver ⚠️ Alertas críticos
  - [ ] Adicionar seletor de duração da pausa (15 min, 30 min, 1h, 2h, personalizado)
  - [ ] Adicionar countdown/timer mostrando tempo restante quando pausado
  - [ ] Adicionar chamada a `GET /api/contatos/:id/pausa-status` no `useEffect` para obter `segundosRestantes`

- Problemas encontrados:
  - `toggleIA` (linha 135): chama `api.from("dados_cliente").update({ atendimento_ia: active })` enviando `boolean` para `PUT /api/dados_cliente/:id` — vai passar pelo makeCrud que escreve boolean no campo que agora é TEXT → **bug silencioso em produção**
  - `atendimento_ia` ainda é `boolean | null` na interface — vai quebrar quando o backend retornar `'ativo'` ou `'pause'` como string
  - Mensagens vêm de `chat_messages` (linha 88) — correto para histórico do n8n
  - JWT: obtido via `api.from()` que internamente lê `localStorage.getItem('access_token')` — funciona

- Arquivo: `src/pages/ContatoDetalhe.tsx`

---

## Sprint L3 — Badge de status na lista de Contatos

**Status:** PARCIALMENTE FEITO

- O que **existe** (mas está quebrado):
  - Badge "IA ativa / IA pause" já renderizado nas linhas 267–277
  - Filtro `iaFilter` com opções "ATIVA" / "PAUSE" já existe (linhas 215–224)

- O que falta:
  - [ ] Corrigir a query da linha 79: `api.from("contatos")` → `api.from("dados_cliente")` — a tabela `contatos` **não tem** campo `atendimento_ia`; este campo existe em `dados_cliente`
  - [ ] Corrigir tipo em `DadoCliente` (linha 27): `atendimento_ia: boolean | null` → `atendimento_ia: string | null`
  - [ ] Corrigir comparação na linha 242: `c.atendimento_ia === true` → `c.atendimento_ia === 'ativo'`
  - [ ] Corrigir filtro na linha 158: `d.atendimento_ia === active` (boolean) → `d.atendimento_ia === (active ? 'ativo' : 'pause')`
  - [ ] Corrigir badge label na linha 276: `"IA " + (iaAtiva ? "ativa" : "pause")` — ok visualmente mas a lógica de `iaAtiva` precisa ser corrigida primeiro

- Problemas encontrados:
  - Query busca `contatos` que tem `nome`, `telefone`, `status`, `opt_out` — **não tem** `nomewpp`, `Setor`, `atendimento_ia`; todos esses campos estão em `dados_cliente`
  - O filtro de IA nunca funciona: `d.atendimento_ia` é sempre `undefined` para registros de `contatos`
  - **Mismatch de navegação**: clique em card faz `navigate(\`/contatos/${c.id}\`)` com `contatos.id` (UUID), mas `ContatoDetalhe` usa esse id para buscar em `dados_cliente` (BIGSERIAL) — ver ⚠️ Alertas críticos

- Arquivo: `src/pages/Contatos.tsx`

---

## Sprint L4 — Painel n8n em Integrações

**Status:** PARCIALMENTE FEITO

- O que **existe**:
  - Card "N8N Automation" (tipo `"n8n"`) já está em `TEMPLATES` (linha 98–104) com campo `url`
  - O card é exibido na grade e salva em `integracoes_config`

- O que falta:
  - [ ] Adicionar campo `n8n_webhook_url` no template do n8n (campo adicional separado da URL geral)
  - [ ] Adicionar seção "Agentes conectados ao N8N" no modal de configuração do n8n, listando agentes que têm `n8n_webhook_url` preenchido
  - [ ] Adicionar teste de conexão n8n específico: fazer GET na URL e verificar se retorna 200/401 (hoje cai no genérico `fetch(form.url)` na linha 294 que retorna erro por CORS)
  - [ ] Opcional: exibir o `N8N_SECRET` status (se configurado no backend) via `GET /api/seguranca/status-chaves`

- Observação: `getAuthToken()` de `src/lib/api-token.ts` já é importado (linha 2) — padrão correto para chamadas diretas

- Arquivo: `src/pages/Integracoes.tsx`

---

## Padrão de autenticação atual

- **Como o token JWT é obtido (chamadas via `api.from()`):**
  ```ts
  // src/integrations/database/client.ts, linha 9
  function _getToken(): string | null { return localStorage.getItem('access_token'); }
  ```

- **Como o token JWT é obtido (chamadas diretas via `fetch`):**
  ```ts
  // src/lib/api-token.ts
  export function getAuthToken(): string {
    return localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";
  }
  export function authHeader(): Record<string, string> {
    const t = getAuthToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }
  ```

- **URL base do backend:**
  ```ts
  // database/client.ts, linha 6
  const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
  // api.ts, linha 3
  const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
  ```
  → Variável de ambiente: `VITE_API_URL`

- **Exemplo de chamada REST já existente (Integracoes.tsx, linha 266):**
  ```ts
  const token = getAuthToken();
  const apiUrl = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
  const res = await fetch(`${apiUrl}/api/elevenlabs/voices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  ```

- **Padrão recomendado para novas chamadas PATCH:**
  ```ts
  import { authHeader } from "@/lib/api-token";
  const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
  
  const res = await fetch(`${API_URL}/api/contatos/${id}/pausa-ia`, {
    method: "PATCH",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ ativo: true, duracao_min: 30 }),
  });
  ```

---

## ⚠️ Alertas críticos

### 1. `atendimento_ia` tratado como `boolean` em 2 arquivos — QUEBRA EM PRODUÇÃO

O campo foi migrado de `BOOLEAN → TEXT` no banco. Valores agora são `'ativo'`, `'pause'`, `'reativada'`.

Arquivos afetados:
- `src/pages/ContatoDetalhe.tsx` linha 29: `atendimento_ia: boolean | null`
- `src/pages/ContatoDetalhe.tsx` linha 180: `const iaAtiva = contato.atendimento_ia === true`
- `src/pages/Contatos.tsx` linha 27: `atendimento_ia: boolean | null`
- `src/pages/Contatos.tsx` linha 242: `const iaAtiva = c.atendimento_ia === true`
- `src/pages/Contatos.tsx` linha 158: `d.atendimento_ia === active` (active é boolean)

**Impacto:** Todos os contatos aparecem como "IA pause" (nenhum como "IA ativa"), pois `'ativo' === true` é `false`. O `toggleIA` envia `true`/`false` para um campo TEXT — pode causar erro no PostgreSQL ou comportamento inesperado.

---

### 2. `toggleIA` chama rota errada — bug silencioso em produção

```ts
// ContatoDetalhe.tsx linha 135 — ERRADO
await api.from("dados_cliente").update({ atendimento_ia: active }).eq("id", contato.id);
```

Isso vai para `PUT /api/dados_cliente/:id` (makeCrud genérico) e tenta gravar `true` ou `false` num campo TEXT. Não chama `PATCH /api/contatos/:id/pausa-ia`, portanto:
- `ia_pausa_log` não é alimentado
- `pausa_timestamp` não é gravado
- O cron de reativação automática nunca é acionado

---

### 3. Mismatch crítico de tabelas e IDs entre Contatos.tsx e ContatoDetalhe.tsx

**Contatos.tsx** (lista):
- Query: `api.from("contatos")` → tabela `contatos` com `id` UUID
- Navega para: `navigate(\`/contatos/${c.id}\`)` usando UUID da tabela `contatos`

**ContatoDetalhe.tsx** (detalhe):
- Query: `api.from("dados_cliente").eq("id", id)` → tabela `dados_cliente` com `id` BIGSERIAL

**Problema:** UUID de `contatos` ≠ BIGSERIAL de `dados_cliente`. Clicar em qualquer contato da lista vai para a página de detalhe que não encontrará o registro em `dados_cliente` (retorna "Contato não encontrado").

**Solução necessária (decidir uma das opções):**
- Opção A: Contatos.tsx muda query para `dados_cliente` (tela mostra contatos do WhatsApp/IA)
- Opção B: ContatoDetalhe.tsx muda query para `contatos` e busca dados_cliente pelo telefone
- Opção C: Unificar ambas as páginas para trabalhar com a mesma tabela

---

### 4. Dois padrões de localStorage key para o token

- `database/client.ts` grava/lê como `access_token`
- `api-token.ts` lê `crm_access_token` primeiro (fallback `access_token`)
- `CLAUDE.md` documenta as chaves como `crm_access_token` / `crm_refresh_token`

**Impacto:** `getAuthToken()` funciona por causa do fallback. Mas se alguém usar apenas `getAuthToken()` (sem o fallback do database/client), e o token foi gravado como `access_token`, há risco de falha. Manter consistência usando sempre `access_token` como chave canônica (que é o que o database/client usa hoje).

---

### 5. Contatos.tsx exibe campos de `dados_cliente` mas consulta `contatos`

A interface `DadoCliente` referencia `nomewpp`, `Setor`, `atendimento_ia` — campos que existem em `dados_cliente`, não em `contatos`. Como a query é `api.from("contatos")`, todos esses campos virão como `undefined` nos dados reais, causando:
- Nome exibido como "Sem nome" para todos
- Setor exibido como "Sem setor" para todos
- Badge IA sempre "IA pause"
- Filtros de setor e IA nunca funcionam


# Plano — Painel Super Admin (Firewall, Copiloto, WhatsApp, Mentoark AI)

Backend já tem tudo pronto (`/api/admin/firewall/*` e `/api/suporte/diagnostico`). Trabalho é 100% frontend.

## 1. Infra compartilhada

- **`src/lib/adminApi.ts`** — helper `adminFetch(path, options)` que:
  - Lê `crm_access_token` do localStorage e adiciona header `Authorization: Bearer …`.
  - Faz `response.text()` + `JSON.parse` defensivo (evita o bug de "<" do HTML de erro).
  - Mapeia 401 → logout + redirect `/login`; 403 → toast "Acesso restrito a administradores"; 503 → toast específico do copiloto; 5xx → toast com `message`; network error → "Servidor indisponível".
- **`ProtectedRoute`** já suporta `requireAdmin`; usar em todas as rotas novas.

## 2. Módulo 1 — `/admin/firewall`

Arquivos novos:
- `src/pages/admin/Firewall.tsx` (página principal)
- `src/components/admin/firewall/FirewallStatusHeader.tsx` (título + badges)
- `src/components/admin/firewall/FirewallConfigCard.tsx` (toggles + avisos)
- `src/components/admin/firewall/FirewallStatsCards.tsx` (5 cards)
- `src/components/admin/firewall/FirewallIpsTable.tsx` (tabela + filtro + busca + paginação + ações inline)
- `src/components/admin/firewall/RegisterIpDialog.tsx` (modal POST)

Detalhes:
- React Query (`@tanstack/react-query` já presente) com `queryKey` `["fw-config"]`, `["fw-stats"]`, `["fw-ips", {tipo, search, offset}]`.
- Validação IP no dialog: regex IPv4 / IPv6 / CIDR antes de habilitar Salvar.
- Toggles `ativo` inline com `PATCH`; delete com confirm. Toda mutação invalida `fw-stats` + `fw-ips`.
- Aviso amarelo quando `firewall_ligado && !modo_simulacao`; aviso azul quando `modo_simulacao`.

## 3. Módulo 2 — `/admin/copiloto`

Arquivos novos:
- `src/pages/admin/Copiloto.tsx` (chat estilo ChatGPT, `max-w-3xl mx-auto`)
- `src/components/admin/copiloto/MessageBubble.tsx` (user direita azul, IA esquerda cinza)
- `src/components/admin/copiloto/ToolCallsAccordion.tsx` (shadcn Accordion com JSON formatado)
- `src/components/admin/copiloto/QuickSuggestions.tsx` (chips fixos)
- `src/components/admin/copiloto/ChatComposer.tsx` (textarea Enter envia, Shift+Enter quebra)

Detalhes:
- Estado local `messages: {role, content, tools?, iterations?}[]`. Sem persistência.
- POST `/api/suporte/diagnostico` via `adminFetch`; loading spinner no balão pendente; auto-scroll ao fim.
- Chips: "Verificar status do sistema", "Corrigir URL do Evolution", "Quantos contatos com IA pausada?", "Diagnóstico completo".
- 503 → toast "Configure uma OPENAI_API_KEY válida no servidor".

## 4. Módulo 3 — Correção WhatsApp/Evolution

Editar `src/pages/Integracoes.tsx` (form do Evolution):
- Garantir que o campo "Servidor Evolution" mostra o valor atual (já vem via GET) e está editável.
- Adicionar validação onChange/onBlur: se a URL contém `fierceparrot` → erro inline + bloquear submit com mensagem "Este servidor foi desativado. Use disparo.mentoark.com.br".
- Defaults sugeridos no placeholder: `https://disparo.mentoark.com.br`, instância `crm_435ee4720fc3`.
- Save continua usando o endpoint atual (`/api/integracoes_config`/`/api/agent-config` conforme já refatorado); **não** chamar `/api/admin/firewall/config`.

## 5. Módulo 4 — Item "Mentoark AI" no sidebar

Editar `src/components/AppSidebar.tsx`:
- Novo grupo "🛡️ SUPER ADMIN" (`adminOnly: true`) com subgrupo "Infraestrutura" contendo:
  - Firewall → `/admin/firewall` (ícone `ShieldCheck`)
  - Copiloto → `/admin/copiloto` (ícone `Sparkles`)
  - Mentoark AI → link externo `https://ai.mentoark.com.br` (ícone `Bot`)
- Para o link externo, criar pequeno wrapper `ExternalNavItem` que renderiza `<a target="_blank" rel="noopener">` em vez de `NavLink`, com badge de status.
- Hook `useExternalHealth(url)` faz `fetch(url + "/health", { mode: "no-cors" })` ao montar; verde "Online" se resolver, amarelo "DNS pendente" caso falhe. Cache 60s.

## 6. Roteamento

Editar `src/App.tsx`:
```
<Route path="/admin/firewall" element={<ProtectedRoute requireAdmin><Firewall/></ProtectedRoute>} />
<Route path="/admin/copiloto" element={<ProtectedRoute requireAdmin><Copiloto/></ProtectedRoute>} />
```

## 7. Design tokens

Tudo via classes semânticas (`bg-primary`, `bg-destructive`, `bg-muted`, `text-warning`, etc.). Badges: shadcn `<Badge variant="…">`. Nada de cores hardcoded.

## Detalhes técnicos

- React Query já configurado em `App.tsx` (`QueryClientProvider`).
- Toasts via `sonner` (`import { toast } from "sonner"`).
- shadcn components a usar: Card, Switch, Badge, Button, Input, Textarea, Select, Table, Dialog, Accordion, Tooltip, ScrollArea.
- Sem mudanças no backend, sem migrations, sem alterar `src/integrations/supabase/client.ts`.
- `adminFetch` lida com resposta vazia (204) e com HTML de erro retornando objeto `{ error }` em vez de explodir.

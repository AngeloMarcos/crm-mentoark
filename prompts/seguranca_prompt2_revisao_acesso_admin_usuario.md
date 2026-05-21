# Prompt Lovable — Revisão Completa: Admin vs Usuário Comum

## Objetivo
Revisar e corrigir o controle de acesso de **todas** as páginas do CRM MentoArk,
separando com clareza o que pertence ao administrador da plataforma e o que o usuário
comum (vendedor/atendente) pode acessar. Atualizar rotas, sidebar e painel de módulos.

---

## Modelo de acesso adotado

| Nível | Quem é | O que pode |
|-------|--------|------------|
| **Admin** | Dono da conta / equipe MentoArk | Tudo — configura a plataforma, cria agentes, integra APIs, gerencia equipe |
| **Usuário comum** | Vendedor / atendente | Usa o CRM no dia a dia — leads, WhatsApp, funil, disparos etc. |

A separação é feita por dois mecanismos já existentes no sistema:
- `requireAdmin` no `ProtectedRoute` → bloqueia usuários comuns
- `requireModulo` → libera por permissão granular (admin gerencia no painel Usuários)

---

## Mapa definitivo de acesso

### ADMIN ONLY (`requireAdmin`) — usuário comum nunca vê

| Rota | Página | Motivo |
|------|--------|--------|
| `/seguranca` | Segurança | Painel de segurança, chaves, multi-tenant |
| `/usuarios` | Usuários | Gerenciar contas da equipe |
| `/integracoes` | Integrações | Conectar Evolution API, webhooks, APIs externas |
| `/agentes` | Agentes IA | Criar e configurar os agentes de IA |
| `/cerebro` | Cérebro do Agente | Base de conhecimento, personalidade, FAQ do agente |
| `/workflows` | Workflows | Fluxos n8n — configuração técnica |

### MÓDULO-CONTROLADO (`requireModulo`) — admin libera por usuário

| Rota | Módulo | Padrão |
|------|--------|--------|
| `/dashboard` | dashboard | ✓ habilitado por padrão |
| `/bi` | dashboard | ✓ habilitado por padrão |
| `/leads` | leads | ✓ habilitado por padrão |
| `/tags-funil` | leads | ✓ habilitado por padrão |
| `/contatos` | contatos | ✓ habilitado por padrão |
| `/contatos/:id` | contatos | ✓ habilitado por padrão |
| `/discagem` | discagem | ✓ habilitado por padrão |
| `/funil` | funil | ✓ habilitado por padrão |
| `/whatsapp` | whatsapp | ✓ habilitado por padrão |
| `/sla` | whatsapp | ✓ habilitado por padrão |
| `/respostas-rapidas` | whatsapp | ✓ habilitado por padrão |
| `/disparos` | disparos | ✓ habilitado por padrão |
| `/campanhas` | campanhas | — liberado pelo admin |
| `/marketing-digital` | campanhas | — liberado pelo admin |
| `/catalogo` | catalogo | — liberado pelo admin |
| `/galeria` | galeria | — liberado pelo admin |
| `/docs` | docs | — liberado pelo admin |

---

## Alterações necessárias

### 1. `src/App.tsx` — corrigir as rotas

Substituir as rotas das páginas admin-only para usar `requireAdmin` (remover `requireModulo`):

```tsx
{/* ADMIN ONLY */}
<Route path="/seguranca"    element={<ProtectedRoute requireAdmin><SegurancaPage /></ProtectedRoute>} />
<Route path="/usuarios"     element={<ProtectedRoute requireAdmin><UsuariosPage /></ProtectedRoute>} />
<Route path="/integracoes"  element={<ProtectedRoute requireAdmin><IntegracoesPage /></ProtectedRoute>} />
<Route path="/agentes"      element={<ProtectedRoute requireAdmin><AgentesPage /></ProtectedRoute>} />
<Route path="/cerebro"      element={<ProtectedRoute requireAdmin><CerebroPage /></ProtectedRoute>} />
<Route path="/workflows"    element={<ProtectedRoute requireAdmin><WorkflowsPage /></ProtectedRoute>} />

{/* MÓDULO-CONTROLADO (usuário comum com permissão) */}
<Route path="/dashboard"    element={<ProtectedRoute requireModulo="dashboard"><DashboardPage /></ProtectedRoute>} />
<Route path="/bi"           element={<ProtectedRoute requireModulo="dashboard"><CentralBIPage /></ProtectedRoute>} />
<Route path="/leads"        element={<ProtectedRoute requireModulo="leads"><LeadsPage /></ProtectedRoute>} />
<Route path="/tags-funil"   element={<ProtectedRoute requireModulo="leads"><TagsPage /></ProtectedRoute>} />
<Route path="/contatos"     element={<ProtectedRoute requireModulo="contatos"><ContatosPage /></ProtectedRoute>} />
<Route path="/contatos/:id" element={<ProtectedRoute requireModulo="contatos"><ContatoDetalhePage /></ProtectedRoute>} />
<Route path="/discagem"     element={<ProtectedRoute requireModulo="discagem"><DiscagemPage /></ProtectedRoute>} />
<Route path="/funil"        element={<ProtectedRoute requireModulo="funil"><FunilPage /></ProtectedRoute>} />
<Route path="/whatsapp"     element={<ProtectedRoute requireModulo="whatsapp"><WhatsAppPage /></ProtectedRoute>} />
<Route path="/sla"          element={<ProtectedRoute requireModulo="whatsapp"><SLAPage /></ProtectedRoute>} />
<Route path="/respostas-rapidas" element={<ProtectedRoute requireModulo="whatsapp"><RespostasRapidasPage /></ProtectedRoute>} />
<Route path="/disparos"     element={<ProtectedRoute requireModulo="disparos"><DisparosPage /></ProtectedRoute>} />
<Route path="/campanhas"    element={<ProtectedRoute requireModulo="campanhas"><CampanhasPage /></ProtectedRoute>} />
<Route path="/marketing-digital" element={<ProtectedRoute requireModulo="campanhas"><MarketingDigitalPage /></ProtectedRoute>} />
<Route path="/catalogo"     element={<ProtectedRoute requireModulo="catalogo"><CatalogoPage /></ProtectedRoute>} />
<Route path="/catalogo/:id" element={<ProtectedRoute requireModulo="catalogo"><CatalogoDetalhePage /></ProtectedRoute>} />
<Route path="/galeria"      element={<ProtectedRoute requireModulo="galeria"><GaleriaPage /></ProtectedRoute>} />
<Route path="/docs"         element={<ProtectedRoute requireModulo="docs"><DocsPage /></ProtectedRoute>} />
```

---

### 2. `src/components/AppSidebar.tsx` — ocultar seções admin do usuário comum

Na definição dos `navGroups`, marcar os grupos/itens exclusivos de admin com uma
propriedade `adminOnly: true`. Adicionar ao tipo `NavItem`:

```tsx
interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  modulo: string;
  color: string;
  adminOnly?: boolean; // novo campo
}
```

Marcar os itens admin-only:

```tsx
// Grupo "Automação & IA" — todos admin
{
  label: "Automação & IA",
  adminOnly: true, // o grupo inteiro é admin
  items: [
    { title: "Workflows",         url: "/workflows",   icon: GitBranch, modulo: "workflows",   color: "text-violet-500", adminOnly: true },
    { title: "Agentes",           url: "/agentes",     icon: Bot,       modulo: "agentes",     color: "text-teal-500",   adminOnly: true },
    { title: "Cérebro do Agente", url: "/cerebro",     icon: Brain,     modulo: "cerebro",     color: "text-purple-400", adminOnly: true },
    { title: "Integrações",       url: "/integracoes", icon: Plug,      modulo: "integracoes", color: "text-amber-500",  adminOnly: true },
  ],
},

// Grupo "Conteúdo" — misturado
{
  label: "Conteúdo",
  items: [
    { title: "Catálogo",     url: "/catalogo",  icon: Package,     modulo: "catalogo",  color: "text-fuchsia-500" },
    { title: "Galeria",      url: "/galeria",   icon: Images,      modulo: "galeria",   color: "text-pink-500"    },
    { title: "Documentação", url: "/docs",      icon: BookOpen,    modulo: "docs",      color: "text-slate-400"   },
    { title: "Usuários",     url: "/usuarios",  icon: ShieldCheck, modulo: "usuarios",  color: "text-teal-600",   adminOnly: true },
    { title: "Segurança",    url: "/seguranca", icon: Lock,        modulo: "usuarios",  color: "text-red-400",    adminOnly: true },
  ],
},
```

No componente `NavGroupSection`, filtrar pelos itens visíveis:

```tsx
// Filtrar: se adminOnly, só aparece para admins
const visibleItems = group.items.filter(i =>
  hasModulo(i.modulo) &&
  (!i.adminOnly || isAdmin)       // ← novo filtro
);

// Se o grupo inteiro é adminOnly e o usuário não é admin, não renderiza
if (group.adminOnly && !isAdmin) return null;
```

O `isAdmin` vem do `useAuth()` já disponível no componente.

---

### 3. `src/routes/modulos.ts` — limpar lista de módulos controlados

Os módulos que viraram admin-only não precisam mais aparecer no painel de gestão
de módulos (já que não são liberados por usuário, são automáticos para admin):

```typescript
// REMOVER da TODOS_MODULOS (ou marcar como adminOnly para não aparecer nos toggles):
// integracoes, agentes, cerebro, workflows, usuarios

export const TODOS_MODULOS = [
  { key: 'dashboard',   label: 'Dashboard',         padrao: true  },
  { key: 'leads',       label: 'Leads',              padrao: true  },
  { key: 'contatos',    label: 'Contatos',           padrao: true  },
  { key: 'discagem',    label: 'Discagem',           padrao: true  },
  { key: 'funil',       label: 'Funil de Vendas',   padrao: true  },
  { key: 'whatsapp',    label: 'WhatsApp',           padrao: true  },
  { key: 'disparos',    label: 'Disparos',           padrao: true  },
  { key: 'campanhas',   label: 'Campanhas',          padrao: false },
  { key: 'catalogo',    label: 'Catálogo',           padrao: false },
  { key: 'galeria',     label: 'Galeria',            padrao: false },
  { key: 'docs',        label: 'Documentação',       padrao: false },
  // integracoes, agentes, cerebro, workflows, usuarios → removidos
  // (são admin-only, não precisam de toggle por usuário)
];
```

---

### 4. `src/pages/Usuarios.tsx` — atualizar painel de gestão de módulos

O painel que o admin usa para habilitar módulos por usuário deve mostrar
apenas os módulos da lista atualizada (sem os admin-only).

Adicionar texto explicativo no painel:

```
"Os módulos de Automação & IA, Integrações e Configurações do Sistema
são exclusivos do administrador e não podem ser delegados a usuários comuns."
```

---

### 5. `src/pages/Seguranca.tsx` — atualizar aba "Banco de Dados"

Na aba 1 (Usuários & Acessos), a grade de toggles de módulos deve refletir
apenas os módulos da lista atualizada (11 módulos, não 16).

Na aba 3 (Logins & Sessões), atualizar o checklist para incluir:

```
✓  Páginas admin-only protegidas por requireAdmin (Segurança, Usuários, Integrações, Agentes, Cérebro, Workflows)
✓  Sidebar oculta itens admin para usuários comuns
✓  Módulos admin-only removidos dos toggles de delegação
```

---

## Resultado esperado

**Quando um usuário comum faz login:**
- Sidebar mostra: Dashboard, BI, Leads, Tags, Contatos, Discagem, Funil, WhatsApp, SLA, Respostas, Disparos + módulos liberados pelo admin (Campanhas, Catálogo, Galeria, Docs)
- Sidebar NÃO mostra: Workflows, Agentes, Cérebro, Integrações, Usuários, Segurança
- Acesso direto via URL a rotas admin → redireciona para `/dashboard`

**Quando o admin faz login:**
- Sidebar mostra tudo
- Tem acesso a todas as configurações da plataforma

---

## Arquivos a alterar

| Arquivo | O que muda |
|---------|-----------|
| `src/App.tsx` | Rotas admin-only trocam `requireModulo` por `requireAdmin` |
| `src/components/AppSidebar.tsx` | Items marcados com `adminOnly`, filtrados por `isAdmin` |
| `backend/src/routes/modulos.ts` | Remove módulos admin-only da lista de toggles |
| `src/pages/Usuarios.tsx` | Grid de módulos usa lista atualizada + texto explicativo |
| `src/pages/Seguranca.tsx` | Aba 1 usa 11 módulos; Aba 3 checklist atualizado |

## Não alterar
`src/hooks/useAuth.tsx`, `src/components/ProtectedRoute.tsx`, `backend/src/middleware.ts`
— a lógica de autenticação já está correta.

# Sprint RBAC-1 — Camada de Permissões por Módulo
# Arquivos: useAuth.tsx · ProtectedRoute.tsx · AppSidebar.tsx · App.tsx

## Contexto
O backend agora expõe `GET /api/modulos` que retorna um array de strings com os módulos
habilitados para o usuário logado (ex: `["dashboard","leads","disparos"]`).
Admins (role=admin) recebem todos os módulos automaticamente no backend.
Precisamos que o frontend respeite isso: mostrar só os itens do sidebar permitidos
e bloquear o acesso direto via URL a módulos não liberados.

---

## 1. `src/hooks/useAuth.tsx` — adicionar módulos ao contexto

### Adicionar ao tipo `AuthContextValue`:
```ts
modulos: string[];
hasModulo: (key: string) => boolean;
modulosLoading: boolean;
```

### Adicionar estado no `AuthProvider`:
```ts
const [modulos, setModulos] = useState<string[]>([]);
const [modulosLoading, setModulosLoading] = useState(true);
```

### Adicionar função para buscar módulos:
```ts
const carregarModulos = async (token: string) => {
  try {
    const BASE = import.meta.env.VITE_API_URL || 'https://api.mentoark.com.br';
    const r = await fetch(`${BASE}/api/modulos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const data = await r.json();
      setModulos(Array.isArray(data) ? data : []);
    }
  } catch {
    // fallback silencioso — mantém módulos vazios
  } finally {
    setModulosLoading(false);
  }
};
```

### Chamar `carregarModulos` após autenticação:
No `useEffect` onde `api.auth.getSession()` resolve, após `resolveAdmin(s?.user)`,
adicionar:
```ts
if (s?.access_token) {
  carregarModulos(s.access_token);
} else {
  setModulosLoading(false);
}
```

Também chamar `carregarModulos` no `onAuthStateChange` quando o evento for `SIGNED_IN`:
```ts
if (_event === 'SIGNED_IN' && s?.access_token) {
  carregarModulos(s.access_token);
}
if (_event === 'SIGNED_OUT') {
  setModulos([]);
  setModulosLoading(false);
}
```

### Expor `hasModulo` no contexto:
```ts
const hasModulo = (key: string): boolean => {
  if (isAdmin) return true; // admins veem tudo
  return modulos.includes(key);
};
```

### Atualizar `signOut`:
```ts
setModulos([]);
setModulosLoading(false);
```

### Atualizar o `AuthContext.Provider value`:
```ts
value={{ user, session, isAdmin, loading, signOut, modulos, hasModulo, modulosLoading }}
```

### Atualizar o fallback do `useAuth()`:
```ts
return {
  user: null, session: null, isAdmin: false, loading: true,
  signOut: async () => {},
  modulos: [], hasModulo: () => false, modulosLoading: true,
};
```

---

## 2. `src/components/ProtectedRoute.tsx` — suportar `requireModulo`

### Nova assinatura:
```tsx
export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireModulo,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireModulo?: string;
}) {
  const { user, isAdmin, loading, hasModulo, modulosLoading } = useAuth();

  if (loading || modulosLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/dashboard" replace />;
  if (requireModulo && !hasModulo(requireModulo)) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
```

---

## 3. `src/components/AppSidebar.tsx` — filtrar itens pelo módulo

### Adicionar `modulo` à definição de cada item:
```ts
const items = [
  { title: "Dashboard",         url: "/dashboard",   icon: LayoutDashboard, modulo: "dashboard"   },
  { title: "Leads",             url: "/leads",       icon: Users,           modulo: "leads"       },
  { title: "Contatos",          url: "/contatos",    icon: Contact,         modulo: "contatos"    },
  { title: "Discagem",          url: "/discagem",    icon: PhoneCall,       modulo: "discagem"    },
  { title: "Funil de Vendas",   url: "/funil",       icon: Kanban,          modulo: "funil"       },
  { title: "WhatsApp",          url: "/whatsapp",    icon: MessageCircle,   modulo: "whatsapp"    },
  { title: "Disparos",          url: "/disparos",    icon: Send,            modulo: "disparos"    },
  { title: "Campanhas",         url: "/campanhas",   icon: Megaphone,       modulo: "campanhas"   },
  { title: "Workflows",         url: "/workflows",   icon: GitBranch,       modulo: "workflows"   },
  { title: "Integrações",       url: "/integracoes", icon: Plug,            modulo: "integracoes" },
  { title: "Agentes",           url: "/agentes",     icon: Bot,             modulo: "agentes"     },
  { title: "Catálogo",          url: "/catalogo",    icon: LayoutGrid,      modulo: "catalogo"    },
  { title: "Galeria",           url: "/galeria",     icon: Images,          modulo: "galeria"     },
  { title: "Cérebro do Agente", url: "/cerebro",     icon: Brain,           modulo: "cerebro"     },
  { title: "Documentação",      url: "/docs",        icon: BookOpen,        modulo: "docs"        },
];
```
Importar `Images` do lucide-react se ainda não importado.

### Substituir a lógica de `menuItems`:
```ts
const { isAdmin, hasModulo } = useAuth();

const menuItems = [
  ...items.filter(item => hasModulo(item.modulo)),
  ...(hasModulo('usuarios') || isAdmin
    ? [{ title: "Usuários", url: "/usuarios", icon: ShieldCheck, modulo: "usuarios" }]
    : []),
];
```
Remover o `isAdmin ? [...items, { Usuários }] : items` anterior.

---

## 4. `src/App.tsx` — proteger rotas com `requireModulo`

Substituir as rotas protegidas adicionando `requireModulo` em cada uma:

```tsx
<Route path="/dashboard"   element={<ProtectedRoute requireModulo="dashboard">  <DashboardPage /></ProtectedRoute>} />
<Route path="/leads"       element={<ProtectedRoute requireModulo="leads">       <LeadsPage /></ProtectedRoute>} />
<Route path="/contatos"    element={<ProtectedRoute requireModulo="contatos">    <ContatosPage /></ProtectedRoute>} />
<Route path="/contatos/:id" element={<ProtectedRoute requireModulo="contatos">  <ContatoDetalhePage /></ProtectedRoute>} />
<Route path="/discagem"    element={<ProtectedRoute requireModulo="discagem">    <DiscagemPage /></ProtectedRoute>} />
<Route path="/funil"       element={<ProtectedRoute requireModulo="funil">       <FunilPage /></ProtectedRoute>} />
<Route path="/whatsapp"    element={<ProtectedRoute requireModulo="whatsapp">    <WhatsAppPage /></ProtectedRoute>} />
<Route path="/disparos"    element={<ProtectedRoute requireModulo="disparos">    <DisparosPage /></ProtectedRoute>} />
<Route path="/campanhas"   element={<ProtectedRoute requireModulo="campanhas">   <CampanhasPage /></ProtectedRoute>} />
<Route path="/integracoes" element={<ProtectedRoute requireModulo="integracoes"> <IntegracoesPage /></ProtectedRoute>} />
<Route path="/cerebro"     element={<ProtectedRoute requireModulo="cerebro">     <CerebroPage /></ProtectedRoute>} />
<Route path="/agentes"     element={<ProtectedRoute requireModulo="agentes">     <AgentesPage /></ProtectedRoute>} />
<Route path="/catalogo"    element={<ProtectedRoute requireModulo="catalogo">    <CatalogoPage /></ProtectedRoute>} />
<Route path="/catalogo/:id" element={<ProtectedRoute requireModulo="catalogo">  <CatalogoDetalhePage /></ProtectedRoute>} />
<Route path="/workflows"   element={<ProtectedRoute requireModulo="workflows">   <WorkflowsPage /></ProtectedRoute>} />
<Route path="/galeria"     element={<ProtectedRoute requireModulo="galeria">     <GaleriaPage /></ProtectedRoute>} />
<Route path="/docs"        element={<ProtectedRoute requireModulo="docs">        <DocsPage /></ProtectedRoute>} />
<Route path="/usuarios"    element={<ProtectedRoute requireAdmin>               <UsuariosPage /></ProtectedRoute>} />
```

Adicionar o import de `GaleriaPage` se ainda não existir:
```tsx
import GaleriaPage from "./pages/Galeria";
```

---

## Não alterar
- Lógica de login/logout
- Estilo visual do sidebar
- Outros arquivos fora dos 4 listados

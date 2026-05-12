# Sprint RBAC-2 — Painel de Gestão de Módulos (Usuarios.tsx)
# Arquivo: src/pages/Usuarios.tsx

## Contexto
O backend agora tem:
- `GET  /api/modulos/lista`            → lista canônica de todos os módulos com label e flag `padrao`
- `GET  /api/modulos/usuario/:userId`  → módulos ativos/inativos de um usuário específico
- `POST /api/modulos/usuario/:userId/toggle` → ativa/desativa um módulo individual
- `PUT  /api/modulos/usuario/:userId`  → substitui todos os módulos de uma vez

A página de Usuários deve ganhar uma seção de gerenciamento de módulos por usuário.
Admins podem ativar/desativar qualquer módulo clicando em toggles.

---

## Novos tipos
```ts
interface ModuloInfo {
  key: string;
  label: string;
  padrao: boolean;
}

interface UserModulo {
  modulo: string;
  ativo: boolean;
}
```

---

## Novo estado na página
```ts
const [todosModulos, setTodosModulos] = useState<ModuloInfo[]>([]);
const [userModulos, setUserModulos] = useState<Record<string, boolean>>({});
// userId do painel de permissões aberto
const [modulosUsuarioId, setModulosUsuarioId] = useState<string | null>(null);
const [modulosLoading, setModulosLoading] = useState(false);
const [salvandoModulo, setSalvandoModulo] = useState<string | null>(null); // key do módulo salvando
const [modalModulos, setModalModulos] = useState(false);
const [nomeUsuarioModulos, setNomeUsuarioModulos] = useState("");
```

---

## Funções

### Carregar lista canônica de módulos (uma vez ao montar a página)
```ts
const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const token = () => localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";

useEffect(() => {
  const fetchModulos = async () => {
    const r = await fetch(`${BASE}/api/modulos/lista`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) setTodosModulos(await r.json());
  };
  fetchModulos();
}, []);
```

### Abrir painel de módulos de um usuário
```ts
const abrirModulos = async (userId: string, nome: string) => {
  setModulosUsuarioId(userId);
  setNomeUsuarioModulos(nome);
  setModalModulos(true);
  setModulosLoading(true);

  const r = await fetch(`${BASE}/api/modulos/usuario/${userId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (r.ok) {
    const rows: UserModulo[] = await r.json();
    const map: Record<string, boolean> = {};
    // Inicializa tudo como false
    todosModulos.forEach(m => { map[m.key] = false; });
    // Aplica o que veio do banco
    rows.forEach(r => { map[r.modulo] = r.ativo; });
    setUserModulos(map);
  }
  setModulosLoading(false);
};
```

### Toggle de um módulo individual
```ts
const toggleModulo = async (moduloKey: string, novoValor: boolean) => {
  if (!modulosUsuarioId) return;
  setSalvandoModulo(moduloKey);

  // Otimismo: atualiza localmente primeiro
  setUserModulos(prev => ({ ...prev, [moduloKey]: novoValor }));

  try {
    const r = await fetch(`${BASE}/api/modulos/usuario/${modulosUsuarioId}/toggle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modulo: moduloKey, ativo: novoValor }),
    });
    if (!r.ok) {
      // Reverte em caso de erro
      setUserModulos(prev => ({ ...prev, [moduloKey]: !novoValor }));
      toast.error("Erro ao salvar permissão");
    }
  } catch {
    setUserModulos(prev => ({ ...prev, [moduloKey]: !novoValor }));
    toast.error("Erro de conexão");
  } finally {
    setSalvandoModulo(null);
  }
};
```

### Aplicar módulos padrão (reset)
```ts
const aplicarPadrao = async () => {
  if (!modulosUsuarioId) return;
  const modulosPadrao = todosModulos.filter(m => m.padrao).map(m => m.key);
  const r = await fetch(`${BASE}/api/modulos/usuario/${modulosUsuarioId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ modulos: modulosPadrao }),
  });
  if (r.ok) {
    const map: Record<string, boolean> = {};
    todosModulos.forEach(m => { map[m.key] = modulosPadrao.includes(m.key); });
    setUserModulos(map);
    toast.success("Permissões resetadas para o padrão");
  }
};

const darTodosModulos = async () => {
  if (!modulosUsuarioId) return;
  const todos = todosModulos.map(m => m.key);
  const r = await fetch(`${BASE}/api/modulos/usuario/${modulosUsuarioId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ modulos: todos }),
  });
  if (r.ok) {
    const map: Record<string, boolean> = {};
    todosModulos.forEach(m => { map[m.key] = true; });
    setUserModulos(map);
    toast.success("Todos os módulos ativados");
  }
};
```

---

## Botão na tabela/lista de usuários

Em cada linha de usuário na tabela existente, adicionar um botão de módulos ao lado dos outros botões de ação:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => abrirModulos(usuario.user_id || usuario.id, usuario.display_name || usuario.email)}
  title="Gerenciar módulos"
>
  <LayoutGrid className="h-4 w-4 mr-1" />
  Módulos
</Button>
```
Importar `LayoutGrid` do lucide-react se ainda não importado.

---

## Modal de Gerenciamento de Módulos (novo modal)

Adicionar antes do fechamento do `return`:

```tsx
<Dialog open={modalModulos} onOpenChange={setModalModulos}>
  <DialogContent className="max-w-lg">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-primary" />
        Módulos — {nomeUsuarioModulos}
      </DialogTitle>
      <DialogDescription>
        Ative ou desative os módulos que este usuário pode acessar.
        As alterações são salvas imediatamente.
      </DialogDescription>
    </DialogHeader>

    {modulosLoading ? (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    ) : (
      <div className="space-y-4 py-2">

        {/* Módulos Padrão */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Módulos Padrão
          </p>
          <div className="space-y-2">
            {todosModulos.filter(m => m.padrao).map(m => (
              <div key={m.key} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-muted/50">
                <Label htmlFor={`mod-${m.key}`} className="cursor-pointer flex-1">
                  {m.label}
                </Label>
                {salvandoModulo === m.key ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Switch
                    id={`mod-${m.key}`}
                    checked={userModulos[m.key] ?? false}
                    onCheckedChange={(v) => toggleModulo(m.key, v)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Divisor */}
        <div className="border-t" />

        {/* Módulos Avançados */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Módulos Avançados
          </p>
          <div className="space-y-2">
            {todosModulos.filter(m => !m.padrao).map(m => (
              <div key={m.key} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-muted/50">
                <Label htmlFor={`mod-${m.key}`} className="cursor-pointer flex-1">
                  {m.label}
                </Label>
                {salvandoModulo === m.key ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Switch
                    id={`mod-${m.key}`}
                    checked={userModulos[m.key] ?? false}
                    onCheckedChange={(v) => toggleModulo(m.key, v)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    <DialogFooter className="flex gap-2 flex-wrap">
      <Button variant="outline" size="sm" onClick={aplicarPadrao}>
        Resetar para padrão
      </Button>
      <Button variant="outline" size="sm" onClick={darTodosModulos}>
        Ativar todos
      </Button>
      <Button onClick={() => setModalModulos(false)}>
        Fechar
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Imports adicionais necessários
```tsx
import { LayoutGrid, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DialogDescription } from "@/components/ui/dialog";
```

---

## Não alterar
- Lógica de criar/editar/deletar usuários
- Gestão de roles (admin/user) existente
- Outros arquivos fora de Usuarios.tsx

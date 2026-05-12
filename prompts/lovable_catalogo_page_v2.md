# Prompt Lovable 3 — Catalogo.tsx v2 (Cover image + Enviar catálogo inteiro)

## Objetivo
Melhorar `src/pages/Catalogo.tsx` com:
1. **Imagem de capa** em cada card (primeira imagem do primeiro produto)
2. **Botão "Enviar catálogo"** que envia todos os produtos para contatos via WhatsApp
3. **Estatísticas** por catálogo (total produtos, total imagens)

---

## Tipo atualizado
```ts
interface Catalogo {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  total_produtos: string;
  capa_url?: string | null;       // nova: URL da imagem de capa
  total_imagens?: number;
}
```

## Estado novo
```ts
const [modalEnviarCatalogo, setModalEnviarCatalogo] = useState(false);
const [catalogoParaEnviar, setCatalogoParaEnviar] = useState<Catalogo | null>(null);
const [contatosEnvio, setContatosEnvio] = useState("");
const [introEnvio, setIntroEnvio] = useState("");
const [enviando, setEnviando] = useState(false);
```

## Carregar catálogos com capa
Substituir a função `carregar` para usar um endpoint que retorna a capa. Como o backend atual retorna total_produtos, vamos buscar a capa de uma forma simples — chamando o endpoint `/api/catalogo` que já existe, e depois buscando individualmente só quando necessário. Ou melhor: fazer uma única chamada ao endpoint existente e para cada catálogo buscar a primeira imagem via os produtos.

Alternativa mais simples: ao montar os cards, buscar a capa via fetch lazy. Use este approach:
```ts
// Ao carregar a lista, para cada catálogo buscar a capa
const carregarCapas = async (cats: Catalogo[]) => {
  const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
  const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";
  const updated = await Promise.all(cats.map(async (c) => {
    try {
      const r = await fetch(`${BASE}/api/catalogo/${c.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return c;
      const d = await r.json();
      const primeiroProduto = d.produtos?.[0];
      const primeiraImagem = primeiroProduto?.imagens?.[0];
      return { ...c, capa_url: primeiraImagem?.url ?? null };
    } catch { return c; }
  }));
  setCatalogos(updated);
};

// Chamar após setCatalogos na função carregar():
useEffect(() => { carregar(); }, []);
// E em carregar():
const carregar = async () => {
  setLoading(true);
  const { data, error } = await api.from("catalogos").select("*");
  if (error) toast.error("Erro ao carregar catálogos");
  else {
    const cats = (data as Catalogo[]) ?? [];
    setCatalogos(cats);
    carregarCapas(cats);   // busca capas em paralelo
  }
  setLoading(false);
};
```

## Função: enviar catálogo no WhatsApp
```ts
const enviarCatalogo = async () => {
  if (!catalogoParaEnviar || !contatosEnvio.trim()) return;
  const contatos = contatosEnvio.split(/[\n,;]/).map(s => s.replace(/\D/g,"")).filter(s => s.length >= 10);
  if (!contatos.length) { toast.error("Nenhum número válido"); return; }

  setEnviando(true);
  const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
  const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";

  const r = await fetch(`${BASE}/api/catalogo/whatsapp/catalogo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      catalogo_id: catalogoParaEnviar.id,
      contatos,
      intro: introEnvio || undefined,
    }),
  });
  const d = await r.json();
  setEnviando(false);

  if (r.ok) {
    toast.success(`Catálogo enviado! ${d.produtos_por_envio} produtos para ${d.contatos} contato(s)`);
    setModalEnviarCatalogo(false);
    setContatosEnvio(""); setIntroEnvio("");
  } else {
    toast.error(d.message);
  }
};
```

## Cards melhorados (substituir o grid atual)
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  {catalogos.map((c) => (
    <Card key={c.id} className="overflow-hidden hover:shadow-md transition-shadow">
      {/* Imagem de capa */}
      <div className="aspect-video bg-muted relative">
        {c.capa_url ? (
          <img src={c.capa_url} alt={c.nome} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <LayoutGrid className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <Badge
          variant={c.ativo ? "default" : "secondary"}
          className="absolute top-2 right-2"
        >
          {c.ativo ? "Ativo" : "Inativo"}
        </Badge>
      </div>

      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">{c.nome}</h3>
          {c.descricao && <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{c.descricao}</p>}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {c.total_produtos} produto{Number(c.total_produtos) !== 1 ? "s" : ""}
          </Badge>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="default" size="sm" onClick={() => navigate(`/catalogo/${c.id}`)}>
            Ver produtos
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => { setCatalogoParaEnviar(c); setModalEnviarCatalogo(true); }}
            title="Enviar catálogo no WhatsApp"
          >
            <MessageCircle className="h-3.5 w-3.5 mr-1 text-green-600" /> Enviar
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={() => { setEditing(c); setForm({ nome: c.nome, descricao: c.descricao || "", ativo: c.ativo }); setModal(true); }}
          ><Pencil className="h-4 w-4" /></Button>
          <Button
            variant="ghost" size="icon"
            onClick={async () => { await api.from("catalogos").delete().eq("id", c.id); carregar(); }}
          ><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      </CardContent>
    </Card>
  ))}
</div>
```

## Modal: Enviar catálogo (novo modal, adicionar antes do fechamento do return)
```tsx
<Dialog open={modalEnviarCatalogo} onOpenChange={setModalEnviarCatalogo}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>
        <MessageCircle className="inline h-5 w-5 mr-2 text-green-600" />
        Enviar catálogo "{catalogoParaEnviar?.nome}"
      </DialogTitle>
      <DialogDescription>
        Todos os produtos ativos serão enviados como imagens no WhatsApp.
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-2">
      <div>
        <Label>Mensagem de introdução (opcional)</Label>
        <Textarea
          placeholder={`Ex: Olá! Confira nosso catálogo ${catalogoParaEnviar?.nome} 🛍️`}
          value={introEnvio}
          onChange={(e) => setIntroEnvio(e.target.value)}
          rows={2}
        />
      </div>
      <div>
        <Label>Números para envio</Label>
        <Textarea
          placeholder={"5511999990001\n5511999990002\nou separados por vírgula"}
          value={contatosEnvio}
          onChange={(e) => setContatosEnvio(e.target.value)}
          rows={4}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Inclua DDI 55. O sistema aguarda alguns segundos entre cada produto para evitar bloqueio.
        </p>
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setModalEnviarCatalogo(false)}>Cancelar</Button>
      <Button
        onClick={enviarCatalogo}
        disabled={enviando}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        {enviando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageCircle className="h-4 w-4 mr-2" />}
        {enviando ? "Enviando..." : "Enviar"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Imports adicionais
```tsx
import { MessageCircle, Loader2 } from "lucide-react";
import { DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
```

---

## Não alterar
- Modal de criar/editar catálogo
- Outros arquivos

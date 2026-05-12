# Prompt Lovable 2 — CatalogoDetalhe.tsx v2 (Picker da Galeria + Envio WhatsApp)

## Objetivo
Reformular `src/pages/CatalogoDetalhe.tsx` com:
1. **Picker de imagens da galeria** ao adicionar imagens a um produto (em vez de só fazer upload)
2. **Botão "Enviar produto no WhatsApp"** por produto
3. **Cards de produto melhorados** (carousel de imagens, preços formatados, badge de estoque)
4. **Modal de galeria unificado**: abas "Galeria" (selecionar existente) e "Upload" (enviar novo)

---

## Tipos novos
```ts
interface GaleriaImagem {
  id: string; url: string; filename: string;
  titulo: string | null; tags: string[]; tipo: string;
}
```

## Estado novo a adicionar
```ts
const [galeriaImagens, setGaleriaImagens] = useState<GaleriaImagem[]>([]);
const [galeriaLoading, setGaleriaLoading] = useState(false);
const [galeriaBusca, setGaleriaBusca] = useState("");
const [enviandoWpp, setEnviandoWpp] = useState<string | null>(null); // produto_id em envio
const [modalEnviar, setModalEnviar] = useState(false);
const [produtoParaEnviar, setProdutoParaEnviar] = useState<Produto | null>(null);
const [contatosEnvio, setContatosEnvio] = useState(""); // números separados por vírgula/nova linha
const [mensagemExtra, setMensagemExtra] = useState("");
```

---

## Função: carregar galeria
```ts
const carregarGaleria = async (busca = "") => {
  setGaleriaLoading(true);
  const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
  const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";
  const params = new URLSearchParams({ limit: "80" });
  if (busca) params.set("q", busca);
  const r = await fetch(`${BASE}/api/galeria?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.ok) { const d = await r.json(); setGaleriaImagens(d.images ?? []); }
  setGaleriaLoading(false);
};
```

---

## Função: vincular imagem da galeria ao produto
```ts
const vincularDaGaleria = async (galeriaId: string) => {
  const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
  const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";
  const r = await fetch(`${BASE}/api/galeria/produto/${activeProduto!.id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ galeria_imagem_id: galeriaId, principal: activeProduto?.imagens?.length === 0 }),
  });
  if (r.ok) { toast.success("Imagem adicionada"); carregar(); }
  else { const d = await r.json(); toast.error(d.message); }
};
```

---

## Função: enviar produto no WhatsApp
```ts
const enviarProdutoWhatsApp = async () => {
  if (!produtoParaEnviar || !contatosEnvio.trim()) return;
  const contatos = contatosEnvio.split(/[\n,;]/).map(s => s.replace(/\D/g, "")).filter(s => s.length >= 10);
  if (contatos.length === 0) { toast.error("Nenhum número válido informado"); return; }

  setEnviandoWpp(produtoParaEnviar.id);
  const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
  const token = localStorage.getItem("crm_access_token") || localStorage.getItem("access_token") || "";

  const r = await fetch(`${BASE}/api/catalogo/whatsapp/produto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ produto_id: produtoParaEnviar.id, contatos, mensagem_extra: mensagemExtra }),
  });
  const d = await r.json();
  if (r.ok) {
    toast.success(`Produto enviado para ${d.enviados} contato(s)`);
    setModalEnviar(false);
    setContatosEnvio(""); setMensagemExtra("");
  } else {
    toast.error(d.message);
  }
  setEnviandoWpp(null);
};
```

---

## Alterações no JSX dos cards de produto

No map dos produtos, substituir o card atual por este layout melhorado:
```tsx
<Card key={p.id} className="overflow-hidden">
  {/* Imagem principal */}
  <div className="aspect-video relative bg-muted flex items-center justify-center">
    {principal ? (
      <img src={principal.url} className="w-full h-full object-cover" alt={p.nome} />
    ) : (
      <ImageIcon className="h-10 w-10 text-muted-foreground" />
    )}
    {/* Contador de imagens */}
    {p.imagens?.length > 1 && (
      <span className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
        {p.imagens.length} fotos
      </span>
    )}
    {/* Badge inativo */}
    {!p.ativo && (
      <span className="absolute top-2 left-2 bg-destructive text-destructive-foreground text-xs px-2 py-0.5 rounded-full">
        Inativo
      </span>
    )}
  </div>

  <CardContent className="p-4 space-y-2">
    <div className="flex items-start justify-between gap-2">
      <h3 className="font-semibold leading-tight">{p.nome}</h3>
      {p.codigo && <span className="text-xs text-muted-foreground shrink-0">#{p.codigo}</span>}
    </div>
    <p className="text-xs text-muted-foreground line-clamp-2">{p.descricao}</p>

    {/* Preços */}
    <div className="flex items-baseline gap-2">
      {p.preco_promocional ? (
        <>
          <span className="text-success font-bold text-lg">
            R$ {Number(p.preco_promocional).toFixed(2).replace(".", ",")}
          </span>
          <span className="text-xs line-through text-muted-foreground">
            R$ {Number(p.preco).toFixed(2).replace(".", ",")}
          </span>
        </>
      ) : p.preco ? (
        <span className="text-success font-bold text-lg">
          R$ {Number(p.preco).toFixed(2).replace(".", ",")}
        </span>
      ) : null}
      {p.estoque != null && (
        <Badge variant={p.estoque > 0 ? "outline" : "destructive"} className="ml-auto text-xs">
          {p.estoque > 0 ? `${p.estoque} un.` : "Sem estoque"}
        </Badge>
      )}
    </div>

    {/* Botões de ação */}
    <div className="flex gap-1 flex-wrap pt-1">
      <Button
        variant="outline" size="sm"
        onClick={() => { setActiveProduto(p); setModalGaleria(true); carregarGaleria(); }}
      >
        <ImageIcon className="h-3.5 w-3.5 mr-1" /> Imagens
      </Button>
      <Button
        variant="outline" size="sm"
        onClick={() => { setProdutoParaEnviar(p); setModalEnviar(true); }}
        title="Enviar no WhatsApp"
      >
        <MessageCircle className="h-3.5 w-3.5 mr-1 text-green-600" /> Enviar
      </Button>
      <Button
        variant="ghost" size="sm"
        onClick={() => { setEditingProduto(p); setForm({...p, ...}); setModalProduto(true); }}
      ><Pencil className="h-3.5 w-3.5" /></Button>
      <Button
        variant="ghost" size="sm"
        onClick={async () => { await api.from(`catalogos/${id}/produtos`).delete().eq("id", p.id); carregar(); }}
      ><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
    </div>
  </CardContent>
</Card>
```

---

## Modal de Galeria com abas (substituir o modal atual)

```tsx
<Dialog open={modalGaleria} onOpenChange={setModalGaleria}>
  <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
    <DialogHeader>
      <DialogTitle>Imagens: {activeProduto?.nome}</DialogTitle>
    </DialogHeader>
    <Tabs defaultValue="galeria" className="flex-1 overflow-hidden flex flex-col">
      <TabsList>
        <TabsTrigger value="galeria">📁 Galeria ({galeriaImagens.length})</TabsTrigger>
        <TabsTrigger value="produto">🛍️ No Produto ({activeProduto?.imagens?.length ?? 0})</TabsTrigger>
        <TabsTrigger value="upload">⬆️ Upload Novo</TabsTrigger>
      </TabsList>

      {/* Aba Galeria — picker */}
      <TabsContent value="galeria" className="flex-1 overflow-auto">
        <div className="pb-3">
          <Input
            placeholder="Buscar na galeria..."
            value={galeriaBusca}
            onChange={(e) => { setGaleriaBusca(e.target.value); carregarGaleria(e.target.value); }}
          />
        </div>
        {galeriaLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {galeriaImagens.map(img => (
              <div
                key={img.id}
                className="relative group cursor-pointer rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all"
                onClick={() => vincularDaGaleria(img.id)}
                title={`Adicionar: ${img.titulo || img.filename}`}
              >
                <div className="aspect-square bg-muted">
                  <img src={img.url} alt={img.titulo || ""} className="w-full h-full object-cover" loading="lazy" />
                </div>
                <div className="absolute inset-0 bg-primary/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Plus className="h-8 w-8 text-white" />
                </div>
              </div>
            ))}
            {galeriaImagens.length === 0 && (
              <p className="col-span-full text-center text-muted-foreground py-10">
                Galeria vazia. Faça upload na aba ao lado.
              </p>
            )}
          </div>
        )}
      </TabsContent>

      {/* Aba Produto — imagens já vinculadas */}
      <TabsContent value="produto" className="flex-1 overflow-auto">
        <div className="grid grid-cols-3 gap-3 py-2">
          {activeProduto?.imagens?.map(img => (
            <div key={img.id} className="relative group">
              <img src={img.url} className="w-full aspect-square object-cover rounded-lg" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 rounded-lg transition-opacity">
                <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(img.url); toast.success("URL copiada"); }}>
                  <Copy className="h-4 w-4 text-white" />
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => {
                  await api.from("catalogo/imagens").delete().eq("id", img.id);
                  carregar();
                  // Atualiza activeProduto
                  const r = await fetch(`${import.meta.env.VITE_API_URL || "https://api.mentoark.com.br"}/api/catalogo/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("access_token")||""}` } });
                  const d = await r.json();
                  setActiveProduto(d.produtos.find((p: any) => p.id === activeProduto?.id) ?? null);
                }}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
              {img.principal && (
                <span className="absolute top-1 left-1 bg-yellow-400 text-yellow-900 text-[10px] px-1.5 py-0.5 rounded font-bold">
                  Principal
                </span>
              )}
            </div>
          ))}
          {!activeProduto?.imagens?.length && (
            <p className="col-span-full text-center text-muted-foreground py-10">Nenhuma imagem vinculada. Use a aba Galeria para adicionar.</p>
          )}
        </div>
      </TabsContent>

      {/* Aba Upload */}
      <TabsContent value="upload" className="flex-1">
        <label className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center h-48 cursor-pointer hover:bg-muted transition-colors">
          <Upload className="h-10 w-10 text-muted-foreground mb-2" />
          <span className="text-sm text-muted-foreground">Clique para selecionar imagens</span>
          <span className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — até 15 MB cada</span>
          <input type="file" hidden multiple accept="image/*" onChange={handleUpload} />
        </label>
        <p className="text-xs text-muted-foreground text-center mt-2">
          As imagens enviadas são adicionadas à galeria E vinculadas automaticamente ao produto.
        </p>
      </TabsContent>
    </Tabs>
  </DialogContent>
</Dialog>
```

**Nota:** A função `handleUpload` existente deve, após o upload, também chamar `carregarGaleria()` e atualizar `activeProduto`.

---

## Modal: Enviar produto no WhatsApp (novo modal)
```tsx
<Dialog open={modalEnviar} onOpenChange={setModalEnviar}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>
        <MessageCircle className="inline h-5 w-5 mr-2 text-green-600" />
        Enviar "{produtoParaEnviar?.nome}" no WhatsApp
      </DialogTitle>
    </DialogHeader>
    <div className="space-y-4 py-2">
      <div>
        <Label>Números / Contatos</Label>
        <Textarea
          placeholder={"5511999990001\n5511999990002\nou cole números separados por vírgula"}
          value={contatosEnvio}
          onChange={(e) => setContatosEnvio(e.target.value)}
          rows={4}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Inclua o DDI (ex: 55 para Brasil). Um por linha ou separados por vírgula.
        </p>
      </div>
      <div>
        <Label>Mensagem extra (opcional)</Label>
        <Input
          placeholder="Ex: Promoção válida até amanhã!"
          value={mensagemExtra}
          onChange={(e) => setMensagemExtra(e.target.value)}
        />
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setModalEnviar(false)}>Cancelar</Button>
      <Button
        onClick={enviarProdutoWhatsApp}
        disabled={!!enviandoWpp}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        {enviandoWpp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageCircle className="h-4 w-4 mr-2" />}
        Enviar
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Imports adicionais necessários
```tsx
import { MessageCircle, Upload } from "lucide-react";
```

---

## Não alterar
- Lógica de criação/edição de produtos (modal de dados)
- Rotas e navegação
- Outros arquivos

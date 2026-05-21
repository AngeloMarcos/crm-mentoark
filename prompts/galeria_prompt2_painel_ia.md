# Prompt Lovable 2 — Galeria: Painel de Configuração do Agente IA

## Objetivo
Adicionar uma segunda aba **"Agente IA"** na página Galeria que permite ao usuário:
1. Ver todas as mídias disponíveis para o agente (com `descricao` preenchida)
2. Testar a busca como o n8n faria — digitar uma frase e ver qual mídia seria selecionada
3. Ver instruções de como configurar o n8n para usar a galeria via MCP
4. Copiar o bloco de configuração pronto para o n8n

---

## Alterações em `src/pages/Galeria.tsx`

### 1. Envolver o conteúdo atual em abas

Adicionar imports no topo:
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Search, Code, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```

### 2. Adicionar estado de busca de teste

```tsx
const [buscaTeste, setBuscaTeste] = useState("");
const [resultadoTeste, setResultadoTeste] = useState<GaleriaItem | null | "vazio">(null);
const [buscando, setBuscando] = useState(false);

const testarBusca = async () => {
  if (!buscaTeste.trim()) return;
  setBuscando(true);
  try {
    const params = new URLSearchParams({ q: buscaTeste, limit: "1" });
    const r = await fetch(`${API_BASE}/api/galeria?${params}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (r.ok) {
      const d = await r.json();
      setResultadoTeste((d.images ?? []).length > 0 ? d.images[0] : "vazio");
    }
  } finally {
    setBuscando(false);
  }
};
```

### 3. Substituir o retorno do componente por versão com abas

O retorno completo passa a ser:

```tsx
return (
  <CRMLayout>
    <div className="space-y-5">
      {/* Header (mantido igual) */}
      ...

      <Tabs defaultValue="midias">
        <TabsList>
          <TabsTrigger value="midias" className="gap-1.5">
            <Images className="h-3.5 w-3.5" /> Mídias
          </TabsTrigger>
          <TabsTrigger value="agente" className="gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Agente IA
          </TabsTrigger>
        </TabsList>

        {/* ── Aba Mídias (conteúdo atual) ── */}
        <TabsContent value="midias" className="mt-4">
          {/* Filtros, grid/lista — tudo que estava antes */}
          ...
        </TabsContent>

        {/* ── Aba Agente IA ── */}
        <TabsContent value="agente" className="mt-4 space-y-5">

          {/* Resumo do que está configurado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                label: "Mídias com descrição para IA",
                valor: itens.filter(i => i.descricao).length,
                total: itens.length,
                ok: itens.filter(i => i.descricao).length > 0,
              },
              {
                label: "Tags únicas cadastradas",
                valor: tags.length,
                total: null,
                ok: tags.length > 0,
              },
              {
                label: "Tipos de arquivo",
                valor: [...new Set(itens.map(i => tipoCategoria(i.tipo)))].length,
                total: 3,
                ok: true,
              },
            ].map(({ label, valor, total, ok }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    {ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                      : <AlertCircle className="h-4 w-4 text-yellow-500" />
                    }
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                  <p className="text-2xl font-bold">
                    {valor}
                    {total !== null && <span className="text-sm text-muted-foreground font-normal"> / {total}</span>}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Simulador de busca */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-blue-500" />
                Simulador — O que o agente enviaria?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Digite uma frase como o cliente enviaria e veja qual mídia o agente selecionaria.
              </p>
              <div className="flex gap-2">
                <Input
                  value={buscaTeste}
                  onChange={e => setBuscaTeste(e.target.value)}
                  placeholder="Ex: quero ver o catálogo de preços"
                  onKeyDown={e => e.key === "Enter" && testarBusca()}
                  className="flex-1"
                />
                <Button onClick={testarBusca} disabled={buscando} className="gap-1.5">
                  {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Simular
                </Button>
              </div>

              {resultadoTeste === "vazio" && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
                  Nenhuma mídia encontrada para este termo. Adicione tags ou descrições mais específicas.
                </div>
              )}

              {resultadoTeste && resultadoTeste !== "vazio" && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 space-y-2">
                  <p className="text-xs font-semibold text-green-400 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mídia que seria enviada:
                  </p>
                  <div className="flex items-center gap-3">
                    {tipoCategoria(resultadoTeste.tipo) === "imagem" && (
                      <img src={resultadoTeste.url} alt=""
                        className="w-16 h-16 rounded-lg object-cover border border-border" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{resultadoTeste.titulo || resultadoTeste.filename}</p>
                      {resultadoTeste.descricao && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">{resultadoTeste.descricao}</p>
                      )}
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {resultadoTeste.tags?.map(t => (
                          <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 gap-1.5"
                      onClick={() => { navigator.clipboard.writeText(resultadoTeste.url); toast.success("URL copiada!"); }}>
                      <Copy className="h-3.5 w-3.5" /> URL
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lista de mídias configuradas para IA */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-purple-500" />
                Mídias configuradas para o Agente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {itens.filter(i => i.descricao).length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma mídia configurada para o agente ainda.</p>
                  <p className="text-xs mt-1">Edite uma mídia e preencha o campo <strong>Descrição para o Agente IA</strong>.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {itens.filter(i => i.descricao).map(item => {
                    const cat = tipoCategoria(item.tipo);
                    const cfg = TIPO_CONFIG[cat];
                    const IconeTipo = cfg.icon;
                    return (
                      <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border border-purple-500/20 bg-purple-500/5">
                        <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${cfg.bg}`}>
                          {cat === "imagem"
                            ? <img src={item.url} alt="" className="w-9 h-9 rounded-lg object-cover" />
                            : <IconeTipo className={`h-4 w-4 ${cfg.cor}`} />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{item.titulo || item.filename}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 italic">{item.descricao}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {item.tags?.map(t => (
                              <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Instruções de configuração n8n */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Code className="h-4 w-4 text-blue-500" />
                Como configurar no n8n
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Use a ferramenta <strong>buscar_midia</strong> no MCP Client do seu fluxo n8n.
                O agente Cris chamará automaticamente esta ferramenta quando precisar enviar uma mídia.
              </p>

              <div className="space-y-2">
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Parâmetros da tool buscar_midia</p>
                <div className="rounded-lg bg-muted/50 border border-border p-3 font-mono text-xs space-y-1">
                  <p><span className="text-blue-400">user_id</span>: <span className="text-green-400">"UUID do usuário"</span></p>
                  <p><span className="text-blue-400">query</span>: <span className="text-green-400">"termo de busca (ex: catálogo, preço)"</span></p>
                  <p><span className="text-blue-400">tipo</span>: <span className="text-muted-foreground">"imagem | pdf | audio (opcional)"</span></p>
                  <p><span className="text-blue-400">tag</span>: <span className="text-muted-foreground">"filtrar por tag específica (opcional)"</span></p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Retorno da tool</p>
                <div className="rounded-lg bg-muted/50 border border-border p-3 font-mono text-xs space-y-1">
                  <p><span className="text-purple-400">id</span>, <span className="text-purple-400">url</span>, <span className="text-purple-400">titulo</span>, <span className="text-purple-400">tipo</span></p>
                  <p><span className="text-purple-400">tags</span>: <span className="text-green-400">["tag1", "tag2"]</span></p>
                  <p><span className="text-purple-400">descricao</span>: <span className="text-green-400">"contexto do arquivo"</span></p>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-300 space-y-1">
                <p className="font-semibold">Exemplo de instrução no prompt da Cris:</p>
                <p className="italic text-blue-400/80">
                  "Quando o cliente pedir catálogo, imagens de produtos, preços ou qualquer material visual,
                  use a ferramenta buscar_midia com a query relacionada ao pedido e envie o arquivo retornado."
                </p>
              </div>

              <Button variant="outline" size="sm" className="gap-1.5"
                onClick={() => window.open("https://api.mentoark.com.br/mcp", "_blank")}>
                <ExternalLink className="h-3.5 w-3.5" /> Ver documentação do MCP
              </Button>
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>
    </div>

    {/* Modais (mantidos) */}
    ...
  </CRMLayout>
);
```

---

## Não alterar
Apenas `src/pages/Galeria.tsx`. O conteúdo da aba "Mídias" não muda — apenas envolva em `<TabsContent value="midias">`.

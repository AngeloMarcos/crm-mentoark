import { useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Brain, Download, Plus, Trash2, Pencil, User, Building2, HelpCircle, Shield, FileText } from "lucide-react";
import { toast } from "sonner";

// ============ TYPES ============
interface KV { id: string; campo: string; conteudo: string; }
interface FaqItem { id: string; categoria: string; pergunta: string; resposta: string; }
interface Objecao { id: string; objecao: string; resposta: string; contexto: string; }
interface Script { id: string; nome: string; categoria: string; conteudo: string; }

const uid = () => Math.random().toString(36).slice(2, 10);

// ============ DEFAULT DATA ============
const defaultPersonalidade: KV[] = [
  { id: uid(), campo: "Nome do Agente", conteudo: "Ana - Secretária Digital MentoArk" },
  { id: uid(), campo: "Tom de Voz", conteudo: "Profissional, acolhedor e consultivo" },
  { id: uid(), campo: "Estilo de Resposta", conteudo: "Respostas curtas, claras e objetivas. Usar emojis com moderação." },
  { id: uid(), campo: "Idioma", conteudo: "Português Brasileiro (PT-BR)" },
  { id: uid(), campo: "Limites", conteudo: "Não inventar informações. Não falar sobre concorrentes. Não dar conselhos jurídicos." },
];

const defaultNegocio: KV[] = [
  { id: uid(), campo: "Nome da Empresa", conteudo: "MentoArk" },
  { id: uid(), campo: "Segmento", conteudo: "Automação de WhatsApp e CRM com IA" },
  { id: uid(), campo: "Horário de Atendimento", conteudo: "Atendimento 24h via IA, humano de seg-sex 9h-18h" },
  { id: uid(), campo: "Endereço", conteudo: "100% online" },
  { id: uid(), campo: "Site", conteudo: "https://mentoark.com.br" },
  { id: uid(), campo: "Diferencial", conteudo: "Integração nativa com n8n, Meta Ads e CRMs externos" },
];

const defaultFaqs: FaqItem[] = [
  { id: uid(), categoria: "Preço", pergunta: "Quanto custa o serviço?", resposta: "Temos planos a partir de R$ 497/mês. O ideal é agendarmos uma demonstração para entender sua necessidade." },
  { id: uid(), categoria: "Implementação", pergunta: "Em quanto tempo fica pronto?", resposta: "A implementação completa leva de 7 a 14 dias úteis." },
  { id: uid(), categoria: "Integração", pergunta: "Funciona com meu CRM atual?", resposta: "Sim! Integramos via API ou webhooks com a maioria dos CRMs do mercado." },
  { id: uid(), categoria: "Suporte", pergunta: "Como funciona o suporte?", resposta: "Suporte via WhatsApp em horário comercial e base de conhecimento 24h." },
];

const defaultObjecoes: Objecao[] = [
  { id: uid(), objecao: "Está caro", resposta: "Entendo! Vamos olhar pelo retorno: nossos clientes recuperam o investimento em média em 45 dias com a automação. Posso te mostrar um caso?", contexto: "Quando lead questiona valor antes da demo" },
  { id: uid(), objecao: "Vou pensar", resposta: "Claro! Para te ajudar a decidir, posso te enviar um material com casos de sucesso do seu segmento?", contexto: "Final de conversa sem decisão" },
  { id: uid(), objecao: "Já tenho um chatbot", resposta: "Ótimo! O nosso diferencial é a integração nativa com seu CRM e a IA conversacional que aprende com seu negócio. Posso te mostrar a diferença?", contexto: "Lead já usa concorrente" },
];

const defaultScripts: Script[] = [
  { id: uid(), nome: "Saudação Inicial", categoria: "Abertura", conteudo: "Olá! 👋 Sou a Ana, secretária digital da MentoArk.\n\nVi que você se interessou pela nossa solução. Como posso te ajudar hoje?\n\n1️⃣ Quero saber mais\n2️⃣ Agendar demonstração\n3️⃣ Falar com humano" },
  { id: uid(), nome: "Qualificação", categoria: "Descoberta", conteudo: "Para te ajudar melhor, me conta:\n\n• Qual o segmento da sua empresa?\n• Quantos atendimentos vocês fazem por dia?\n• Já usam alguma automação hoje?" },
  { id: uid(), nome: "Agendamento Demo", categoria: "Conversão", conteudo: "Perfeito! Vou te mandar os horários disponíveis para uma demonstração de 30 minutos.\n\n📅 Qual período prefere?\n- Manhã (9h-12h)\n- Tarde (14h-18h)" },
  { id: uid(), nome: "Encerramento", categoria: "Fechamento", conteudo: "Foi ótimo conversar com você! 🙌\n\nQualquer dúvida, é só chamar aqui. Estou disponível 24h.\n\nTenha um excelente dia!" },
];

// ============ CSV EXPORT ============
function exportCSV(data: {
  personalidade: KV[]; negocio: KV[]; faqs: FaqItem[]; objecoes: Objecao[]; scripts: Script[];
}) {
  const rows: string[][] = [["tipo", "categoria", "campo", "conteudo", "contexto"]];
  data.personalidade.forEach((p) => rows.push(["personalidade", "", p.campo, p.conteudo, ""]));
  data.negocio.forEach((n) => rows.push(["negocio", "", n.campo, n.conteudo, ""]));
  data.faqs.forEach((f) => rows.push(["faq", f.categoria, f.pergunta, f.resposta, ""]));
  data.objecoes.forEach((o) => rows.push(["objecao", "", o.objecao, o.resposta, o.contexto]));
  data.scripts.forEach((s) => rows.push(["script", s.categoria, s.nome, s.conteudo, ""]));

  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""').replace(/\n/g, "\\n")}"`;
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cerebro-agente-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exportado com sucesso!");
}

// ============ KEY VALUE EDITOR ============
function KeyValueEditor({ items, setItems, labelCampo }: { items: KV[]; setItems: (v: KV[]) => void; labelCampo: string }) {
  const [editing, setEditing] = useState<KV | null>(null);
  const [draft, setDraft] = useState<KV>({ id: "", campo: "", conteudo: "" });

  const open = (item?: KV) => {
    if (item) { setEditing(item); setDraft(item); }
    else { setEditing(null); setDraft({ id: uid(), campo: "", conteudo: "" }); }
  };
  const save = () => {
    if (!draft.campo.trim()) return toast.error("Preencha o campo");
    if (editing) setItems(items.map((i) => (i.id === editing.id ? draft : i)));
    else setItems([...items, draft]);
    setEditing(null); setDraft({ id: "", campo: "", conteudo: "" });
  };
  const remove = (id: string) => setItems(items.filter((i) => i.id !== id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{items.length} itens</CardTitle>
        <Button onClick={() => open()} size="sm"><Plus className="h-4 w-4" /> Adicionar</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3">{labelCampo}</TableHead>
              <TableHead>Conteúdo</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.id}>
                <TableCell className="font-medium">{it.campo}</TableCell>
                <TableCell className="text-muted-foreground">{it.conteudo}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => open(it)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(it.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!draft.id} onOpenChange={(o) => !o && setDraft({ id: "", campo: "", conteudo: "" })}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Adicionar"} item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">{labelCampo}</label>
              <Input value={draft.campo} onChange={(e) => setDraft({ ...draft, campo: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Conteúdo</label>
              <Textarea value={draft.conteudo} onChange={(e) => setDraft({ ...draft, conteudo: e.target.value })} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft({ id: "", campo: "", conteudo: "" })}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============ FAQ EDITOR ============
function FaqEditor({ items, setItems }: { items: FaqItem[]; setItems: (v: FaqItem[]) => void }) {
  const [draft, setDraft] = useState<FaqItem>({ id: "", categoria: "", pergunta: "", resposta: "" });
  const [editing, setEditing] = useState<FaqItem | null>(null);

  const open = (item?: FaqItem) => {
    if (item) { setEditing(item); setDraft(item); }
    else { setEditing(null); setDraft({ id: uid(), categoria: "", pergunta: "", resposta: "" }); }
  };
  const save = () => {
    if (!draft.pergunta.trim()) return toast.error("Preencha a pergunta");
    if (editing) setItems(items.map((i) => (i.id === editing.id ? draft : i)));
    else setItems([...items, draft]);
    setDraft({ id: "", categoria: "", pergunta: "", resposta: "" }); setEditing(null);
  };
  const remove = (id: string) => setItems(items.filter((i) => i.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{items.length} perguntas cadastradas</p>
        <Button onClick={() => open()} size="sm"><Plus className="h-4 w-4" /> Nova FAQ</Button>
      </div>
      <div className="grid gap-3">
        {items.map((f) => (
          <Card key={f.id}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Badge variant="secondary">{f.categoria}</Badge>
                  <h4 className="font-semibold">{f.pergunta}</h4>
                  <p className="text-sm text-muted-foreground">{f.resposta}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => open(f)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(f.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!draft.id} onOpenChange={(o) => !o && setDraft({ id: "", categoria: "", pergunta: "", resposta: "" })}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} FAQ</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Categoria" value={draft.categoria} onChange={(e) => setDraft({ ...draft, categoria: e.target.value })} />
            <Input placeholder="Pergunta" value={draft.pergunta} onChange={(e) => setDraft({ ...draft, pergunta: e.target.value })} />
            <Textarea placeholder="Resposta" value={draft.resposta} onChange={(e) => setDraft({ ...draft, resposta: e.target.value })} rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft({ id: "", categoria: "", pergunta: "", resposta: "" })}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ OBJECOES EDITOR ============
function ObjecoesEditor({ items, setItems }: { items: Objecao[]; setItems: (v: Objecao[]) => void }) {
  const [draft, setDraft] = useState<Objecao>({ id: "", objecao: "", resposta: "", contexto: "" });
  const [editing, setEditing] = useState<Objecao | null>(null);

  const open = (item?: Objecao) => {
    if (item) { setEditing(item); setDraft(item); }
    else { setEditing(null); setDraft({ id: uid(), objecao: "", resposta: "", contexto: "" }); }
  };
  const save = () => {
    if (!draft.objecao.trim()) return toast.error("Preencha a objeção");
    if (editing) setItems(items.map((i) => (i.id === editing.id ? draft : i)));
    else setItems([...items, draft]);
    setDraft({ id: "", objecao: "", resposta: "", contexto: "" }); setEditing(null);
  };
  const remove = (id: string) => setItems(items.filter((i) => i.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{items.length} objeções mapeadas</p>
        <Button onClick={() => open()} size="sm"><Plus className="h-4 w-4" /> Nova Objeção</Button>
      </div>
      <div className="grid gap-3">
        {items.map((o) => (
          <Card key={o.id} className="border-l-4 border-l-accent">
            <CardContent className="pt-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-2">
                  <h4 className="font-semibold text-accent">"{o.objecao}"</h4>
                  <p className="text-sm">{o.resposta}</p>
                  {o.contexto && <p className="text-xs text-muted-foreground italic">Contexto: {o.contexto}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => open(o)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(o.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!draft.id} onOpenChange={(o) => !o && setDraft({ id: "", objecao: "", resposta: "", contexto: "" })}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} Objeção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Objeção do lead" value={draft.objecao} onChange={(e) => setDraft({ ...draft, objecao: e.target.value })} />
            <Textarea placeholder="Resposta sugerida" value={draft.resposta} onChange={(e) => setDraft({ ...draft, resposta: e.target.value })} rows={4} />
            <Input placeholder="Contexto de uso" value={draft.contexto} onChange={(e) => setDraft({ ...draft, contexto: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft({ id: "", objecao: "", resposta: "", contexto: "" })}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ SCRIPTS EDITOR ============
function ScriptsEditor({ items, setItems }: { items: Script[]; setItems: (v: Script[]) => void }) {
  const [draft, setDraft] = useState<Script>({ id: "", nome: "", categoria: "", conteudo: "" });
  const [editing, setEditing] = useState<Script | null>(null);
  const [preview, setPreview] = useState<Script | null>(null);

  const open = (item?: Script) => {
    if (item) { setEditing(item); setDraft(item); setPreview(null); }
    else { setEditing(null); setDraft({ id: uid(), nome: "", categoria: "", conteudo: "" }); }
  };
  const save = () => {
    if (!draft.nome.trim()) return toast.error("Preencha o nome");
    if (editing) setItems(items.map((i) => (i.id === editing.id ? draft : i)));
    else setItems([...items, draft]);
    setDraft({ id: "", nome: "", categoria: "", conteudo: "" }); setEditing(null);
  };
  const remove = (id: string) => setItems(items.filter((i) => i.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{items.length} scripts disponíveis</p>
        <Button onClick={() => open()} size="sm"><Plus className="h-4 w-4" /> Novo Script</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((s) => (
          <Card key={s.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setPreview(s)}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <Badge variant="outline" className="mb-2">{s.categoria}</Badge>
                  <h4 className="font-semibold truncate">{s.nome}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{s.conteudo}</p>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" onClick={() => open(s)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{preview?.nome}</DialogTitle></DialogHeader>
          <pre className="whitespace-pre-wrap font-mono text-sm bg-muted p-4 rounded-lg max-h-96 overflow-auto">{preview?.conteudo}</pre>
        </DialogContent>
      </Dialog>

      <Dialog open={!!draft.id} onOpenChange={(o) => !o && setDraft({ id: "", nome: "", categoria: "", conteudo: "" })}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} Script</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Nome do script" value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} />
            <Input placeholder="Categoria" value={draft.categoria} onChange={(e) => setDraft({ ...draft, categoria: e.target.value })} />
            <Textarea placeholder="Conteúdo do script" value={draft.conteudo} onChange={(e) => setDraft({ ...draft, conteudo: e.target.value })} rows={12} className="font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft({ id: "", nome: "", categoria: "", conteudo: "" })}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ MAIN PAGE ============
export default function CerebroPage() {
  const [personalidade, setPersonalidade] = useState<KV[]>(defaultPersonalidade);
  const [negocio, setNegocio] = useState<KV[]>(defaultNegocio);
  const [faqs, setFaqs] = useState<FaqItem[]>(defaultFaqs);
  const [objecoes, setObjecoes] = useState<Objecao[]>(defaultObjecoes);
  const [scripts, setScripts] = useState<Script[]>(defaultScripts);

  const stats = [
    { label: "Personalidade", value: personalidade.length, icon: User, color: "text-primary" },
    { label: "Negócio", value: negocio.length, icon: Building2, color: "text-info" },
    { label: "FAQs", value: faqs.length, icon: HelpCircle, color: "text-success" },
    { label: "Objeções", value: objecoes.length, icon: Shield, color: "text-accent" },
    { label: "Scripts", value: scripts.length, icon: FileText, color: "text-warning" },
  ];

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Brain className="h-8 w-8 text-primary" />
              Cérebro do Agente
            </h1>
            <p className="text-muted-foreground mt-1">Base de conhecimento que alimenta a IA via N8N</p>
          </div>
          <Button onClick={() => exportCSV({ personalidade, negocio, faqs, objecoes, scripts })} size="lg">
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-2xl font-bold mt-1">{s.value}</p>
                  </div>
                  <s.icon className={`h-6 w-6 ${s.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="personalidade">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto">
            <TabsTrigger value="personalidade"><User className="h-4 w-4 mr-1" /> Personalidade</TabsTrigger>
            <TabsTrigger value="negocio"><Building2 className="h-4 w-4 mr-1" /> Negócio</TabsTrigger>
            <TabsTrigger value="faqs"><HelpCircle className="h-4 w-4 mr-1" /> FAQs</TabsTrigger>
            <TabsTrigger value="objecoes"><Shield className="h-4 w-4 mr-1" /> Objeções</TabsTrigger>
            <TabsTrigger value="scripts"><FileText className="h-4 w-4 mr-1" /> Scripts</TabsTrigger>
          </TabsList>
          <TabsContent value="personalidade" className="mt-4">
            <KeyValueEditor items={personalidade} setItems={setPersonalidade} labelCampo="Atributo" />
          </TabsContent>
          <TabsContent value="negocio" className="mt-4">
            <KeyValueEditor items={negocio} setItems={setNegocio} labelCampo="Informação" />
          </TabsContent>
          <TabsContent value="faqs" className="mt-4">
            <FaqEditor items={faqs} setItems={setFaqs} />
          </TabsContent>
          <TabsContent value="objecoes" className="mt-4">
            <ObjecoesEditor items={objecoes} setItems={setObjecoes} />
          </TabsContent>
          <TabsContent value="scripts" className="mt-4">
            <ScriptsEditor items={scripts} setItems={setScripts} />
          </TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}

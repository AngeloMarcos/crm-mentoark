import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadTimeline } from "@/components/leads/LeadTimeline";
import { LeadTarefas } from "@/components/leads/LeadTarefas";
import {
  Search, Plus, Upload, Trash2, FolderPlus, Phone, Mail, Building2, Loader2, Pencil, FileUp, MessageCircle, Download, ListTodo, ShieldCheck,
} from "lucide-react";
import { normalizarTelefoneBR } from "@/lib/phone";

function formatWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  // Remove leading zeros
  digits = digits.replace(/^0+/, "");
  // If doesn't start with country code (Brazil 55) and length is 10 or 11 (DDD + number), prepend 55
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    digits = "55" + digits;
  }
  if (digits.length < 10) return null;
  return digits;
}
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface Lista {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string | null;
}

interface Contato {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  cargo: string | null;
  origem: string | null;
  status: string;
  tags: string[] | null;
  notas: string | null;
  lista_id: string | null;
  created_at: string;
}

const statusOptions = [
  { value: "novo", label: "Novo" },
  { value: "contatado", label: "Contatado" },
  { value: "qualificado", label: "Qualificado" },
  { value: "agendado", label: "Agendado" },
  { value: "fechado", label: "Fechado" },
  { value: "perdido", label: "Perdido" },
];

const statusColor: Record<string, string> = {
  novo: "bg-info/15 text-info",
  contatado: "bg-primary/15 text-primary",
  qualificado: "bg-success/15 text-success",
  agendado: "bg-warning/15 text-warning",
  fechado: "bg-success/15 text-success",
  perdido: "bg-destructive/15 text-destructive",
};

export default function LeadsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [listas, setListas] = useState<Lista[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [tarefasPendentes, setTarefasPendentes] = useState<Map<string, number>>(new Map());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [listaFiltro, setListaFiltro] = useState<string>("todas");

  // Modais
  const [modalLista, setModalLista] = useState(false);
  const [modalImport, setModalImport] = useState(false);
  const [modalContato, setModalContato] = useState(false);
  const [editing, setEditing] = useState<Contato | null>(null);

  // Form lista
  const [novaLista, setNovaLista] = useState({ nome: "", descricao: "" });

  // Form contato
  const [contatoForm, setContatoForm] = useState({
    nome: "", telefone: "", email: "", empresa: "", cargo: "",
    origem: "Manual", status: "novo", tags: "", notas: "", lista_id: "",
  });

  // Importação
  const [csvTexto, setCsvTexto] = useState("");
  const [importLista, setImportLista] = useState<string>("");

  // ============ CARREGAR DADOS ============
  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: l }, { data: c }, { data: tar }] = await Promise.all([
      supabase.from("listas").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("contatos").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("tarefas").select("contato_id").eq("user_id", user.id).in("status", ["pendente", "em_andamento"]),
    ]);
    setListas(l ?? []);
    setContatos(c ?? []);
    const map = new Map<string, number>();
    (tar ?? []).forEach((t: { contato_id: string | null }) => {
      if (!t.contato_id) return;
      map.set(t.contato_id, (map.get(t.contato_id) ?? 0) + 1);
    });
    setTarefasPendentes(map);
    setLoading(false);
  };

  const recarregarTarefas = async () => {
    if (!user) return;
    const { data: tar } = await supabase
      .from("tarefas")
      .select("contato_id")
      .eq("user_id", user.id)
      .in("status", ["pendente", "em_andamento"]);
    const map = new Map<string, number>();
    (tar ?? []).forEach((t: { contato_id: string | null }) => {
      if (!t.contato_id) return;
      map.set(t.contato_id, (map.get(t.contato_id) ?? 0) + 1);
    });
    setTarefasPendentes(map);
  };

  useEffect(() => { carregar(); }, [user?.id]);

  // ============ LISTA ============
  const criarLista = async () => {
    if (!novaLista.nome.trim() || !user) return;
    const { error } = await supabase.from("listas").insert({
      user_id: user.id,
      nome: novaLista.nome.trim(),
      descricao: novaLista.descricao.trim() || null,
    });
    if (error) {
      toast({ title: "Erro ao criar lista", description: error.message, variant: "destructive" });
      return;
    }
    setNovaLista({ nome: "", descricao: "" });
    setModalLista(false);
    toast({ title: "✅ Lista criada!" });
    carregar();
  };

  const removerLista = async (id: string) => {
    if (!confirm("Remover esta lista? Os contatos ficarão sem lista mas não serão apagados.")) return;
    const { error } = await supabase.from("listas").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    if (listaFiltro === id) setListaFiltro("todas");
    carregar();
  };

  // ============ CONTATO CRUD ============
  const abrirNovo = () => {
    setEditing(null);
    setContatoForm({
      nome: "", telefone: "", email: "", empresa: "", cargo: "",
      origem: "Manual", status: "novo", tags: "", notas: "",
      lista_id: listaFiltro !== "todas" ? listaFiltro : (listas[0]?.id ?? ""),
    });
    setModalContato(true);
  };

  const abrirEdicao = (c: Contato) => {
    setEditing(c);
    setContatoForm({
      nome: c.nome,
      telefone: c.telefone ?? "",
      email: c.email ?? "",
      empresa: c.empresa ?? "",
      cargo: c.cargo ?? "",
      origem: c.origem ?? "Manual",
      status: c.status,
      tags: (c.tags ?? []).join(", "),
      notas: c.notas ?? "",
      lista_id: c.lista_id ?? "",
    });
    setModalContato(true);
  };

  const salvarContato = async () => {
    if (!contatoForm.nome.trim() || !user) return;
    const payload = {
      nome: contatoForm.nome.trim(),
      telefone: contatoForm.telefone.trim() || null,
      email: contatoForm.email.trim() || null,
      empresa: contatoForm.empresa.trim() || null,
      cargo: contatoForm.cargo.trim() || null,
      origem: contatoForm.origem.trim() || "Manual",
      status: contatoForm.status,
      tags: contatoForm.tags ? contatoForm.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notas: contatoForm.notas.trim() || null,
      lista_id: contatoForm.lista_id || null,
    };
    const { error } = editing
      ? await supabase.from("contatos").update(payload).eq("id", editing.id)
      : await supabase.from("contatos").insert({ ...payload, user_id: user.id });
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    setModalContato(false);
    toast({ title: editing ? "✅ Contato atualizado!" : "✅ Contato criado!" });
    carregar();
  };

  const removerContato = async (id: string) => {
    if (!confirm("Remover este contato?")) return;
    const { error } = await supabase.from("contatos").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    carregar();
  };

  // ============ IMPORTAÇÃO CSV ============
  // Parser CSV robusto (RFC 4180): suporta vírgulas dentro de aspas, aspas escapadas ("")
  // e quebras de linha dentro de campos com aspas.
  const parseCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  // Parseia CSV completo respeitando aspas que abrangem múltiplas linhas
  const parseCsvFull = (text: string): string[][] => {
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows: string[][] = [];
    let cur = "";
    let inQuotes = false;
    let row: string[] = [];
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === '"') {
        if (inQuotes && clean[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(cur.trim()); cur = "";
      } else if (ch === "\n" && !inQuotes) {
        row.push(cur.trim()); cur = "";
        if (row.some((c) => c.length > 0)) rows.push(row);
        row = [];
      } else {
        cur += ch;
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
    }
    return rows;
  };

  const importarCSV = async () => {
    if (!user) return;
    const rows = parseCsvFull(csvTexto);
    if (rows.length < 2) {
      toast({ title: "CSV inválido", description: "Cole o cabeçalho + ao menos 1 linha de dados.", variant: "destructive" });
      return;
    }
    const headers = rows[0].map((h) => h.replace(/"/g, "").toLowerCase().trim());
    const listaAlvo = importLista || (listaFiltro !== "todas" ? listaFiltro : (listas[0]?.id ?? null));
    const novos: Array<Omit<Contato, "id" | "created_at">> = [];
    const ignorados: Array<{ linha: number; nome: string; motivo: string }> = [];
    const totalLinhas = rows.length - 1;

    const isCnpjBiz =
      headers.includes("nome da empresa") ||
      headers.includes("cnpj ou cpf da empresa") ||
      headers.includes("categoria da empresa") ||
      headers.includes("razão social da empresa") ||
      // Variante com underscore (export alternativa do Cnpj.biz)
      (headers.includes("cnpj") && (headers.includes("razao_social") || headers.includes("nome_fantasia")));

    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].map((c) => c.replace(/^"|"$/g, "").trim());
      const get = (key: string) => {
        const idx = headers.indexOf(key.toLowerCase());
        return idx >= 0 && cols[idx] ? cols[idx] : "";
      };

      if (isCnpjBiz) {
        const empresa =
          get("nome fantasia da empresa") ||
          get("nome da empresa") ||
          get("nome_fantasia") ||
          get("razao_social");
        const nome = get("nome do contato 1") || get("socios") || empresa;
        const telefoneBruto =
          get("telefones da empresa") ||
          get("telefones") ||
          get("telefone");
        const telefone = telefoneBruto ? telefoneBruto.split(/[,;]/)[0].trim() : "";
        const email = get("e-mails da empresa") || get("email") || get("e-mail");
        const cargo = get("cargo / função do contato 1");
        const segmento = get("categoria da empresa") || get("atividades_principal") || get("atividade_principal");
        const porte = get("porte da empresa") || get("porte_empresa");
        const cnpj = get("cnpj ou cpf da empresa") || get("cnpj");
        const razao = get("razão social da empresa") || get("razao_social");
        const dataAbertura = get("data de abertura da empresa") || get("data_abertura");
        const contato2 = get("nome do contato 2");
        const cargo2 = get("cargo / função do contato 2");

        if (!nome && !telefone && !email) {
          ignorados.push({ linha: i + 1, nome: "(vazio)", motivo: "sem nome, telefone ou e-mail" });
          continue;
        }
        if (!telefone) {
          ignorados.push({ linha: i + 1, nome: nome || empresa || "(sem nome)", motivo: "telefone inválido" });
          continue;
        }

        const tagsAuto: string[] = [];
        const seg = segmento.toLowerCase();
        if (seg.includes("odontol")) tagsAuto.push("Odontologia");
        else if (seg.includes("psicol") || seg.includes("psicanal")) tagsAuto.push("Psicologia");
        else if (seg.includes("fisioter")) tagsAuto.push("Fisioterapia");
        else if (seg.includes("médic") || seg.includes("medic")) tagsAuto.push("Médico");
        else if (seg.includes("comércio") || seg.includes("comerc")) tagsAuto.push("Comércio");
        if (porte) tagsAuto.push(porte);
        tagsAuto.push("Cnpj.biz");

        let notas = `CNPJ: ${cnpj} | Razão social: ${razao} | Abertura: ${dataAbertura} | Segmento: ${segmento}`;
        if (contato2) notas += ` | Contato 2: ${contato2}${cargo2 ? ` (${cargo2})` : ""}`;

        novos.push({
          nome, telefone, email, empresa, cargo,
          origem: "Cnpj.biz",
          status: "novo",
          tags: tagsAuto,
          notas,
          lista_id: listaAlvo,
        });
      } else {
        const nome =
          get("nome") || get("name") || get("nome completo") || get("nome do contato") ||
          get("nome_fantasia") || get("razao_social") || get("razão social");
        const telefoneRaw =
          get("telefone") || get("telefones") || get("fone") || get("celular") ||
          get("phone") || get("whatsapp");
        if (!nome && !telefoneRaw) {
          ignorados.push({ linha: i + 1, nome: "(vazio)", motivo: "sem nome e sem telefone" });
          continue;
        }
        if (!telefoneRaw) {
          ignorados.push({ linha: i + 1, nome: nome || "(sem nome)", motivo: "telefone inválido" });
          continue;
        }
        const tagsRaw = get("tags") || get("tag");
        novos.push({
          nome: nome || telefoneRaw,
          telefone: telefoneRaw ? telefoneRaw.split(/[,;]/)[0].trim() : "",
          email: get("email") || get("e-mail") || get("mail"),
          empresa: get("empresa") || get("company") || get("nome da empresa") || get("nome_fantasia"),
          cargo: get("cargo") || get("função") || get("role"),
          origem: get("origem") || get("source") || "Importado",
          status: get("status") || "novo",
          tags: tagsRaw ? tagsRaw.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [],
          notas: get("notas") || get("observações") || get("notes") || "",
          lista_id: listaAlvo,
        });
      }
    }

    if (!novos.length) {
      toast({
        title: "Nenhum contato válido encontrado",
        description: `${totalLinhas} linha(s) lida(s), ${ignorados.length} ignorada(s). Verifique se há colunas 'nome' e 'telefone'.`,
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase
      .from("contatos")
      .insert(novos.map((n) => ({ ...n, user_id: user.id })));

    if (error) {
      toast({ title: "Erro na importação", description: error.message, variant: "destructive" });
      return;
    }

    setModalImport(false);
    setCsvTexto("");
    setImportLista("");
    toast({
      title: `✅ Importação concluída`,
      description: `${novos.length} importados, ${ignorados.length} ignorados de ${totalLinhas} linhas${isCnpjBiz ? " • formato Cnpj.biz" : ""}`,
    });
    if (ignorados.length > 0) {
      const exemplos = ignorados.slice(0, 3)
        .map((r) => `Linha ${r.linha}: '${r.nome}' — ${r.motivo}`)
        .join(" • ");
      toast({
        title: `⚠️ ${ignorados.length} linha(s) ignorada(s)`,
        description: exemplos,
      });
    }
    carregar();
  };

  // Upload de arquivo do dispositivo (CSV ou Excel)
  const handleArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "csv" || ext === "txt") {
        const texto = await file.text();
        setCsvTexto(texto);
        toast({ title: "📄 Arquivo carregado", description: `${file.name} pronto para importar.` });
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(ws);
        setCsvTexto(csv);
        toast({ title: "📊 Planilha convertida", description: `${file.name} (aba "${wb.SheetNames[0]}") carregada.` });
      } else {
        toast({ title: "Formato não suportado", description: "Use CSV, XLSX ou XLS.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro ao ler arquivo", description: err.message, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  // ============ EXPORTAR CSV ============
  const exportarCsv = () => {
    const filtrados = filtered;
    if (filtrados.length === 0) {
      toast({ title: "Nenhum contato para exportar" });
      return;
    }
    const headers = ["nome", "telefone", "email", "empresa", "cargo", "origem", "status", "tags", "notas"];
    const rows = filtrados.map((c) => [
      c.nome ?? "",
      c.telefone ?? "",
      c.email ?? "",
      c.empresa ?? "",
      c.cargo ?? "",
      c.origem ?? "",
      c.status ?? "",
      (c.tags ?? []).join(";"),
      (c.notas ?? "").replace(/\n/g, " "),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `✅ ${filtrados.length} contatos exportados` });
  };

  // ============ VALIDAR LISTA NO WHATSAPP ============
  const [validandoWa, setValidandoWa] = useState(false);
  const validarListaWhatsApp = async () => {
    if (!user) return;
    const ids = filtered.map((c) => c.id);
    if (ids.length === 0) {
      toast({ title: "Nenhum contato para validar" });
      return;
    }
    if (!confirm(`Validar ${ids.length} contato(s) no WhatsApp?\n\nIsso consulta a Evolution API e marca números inexistentes com a tag "whatsapp_invalido".`)) return;
    setValidandoWa(true);
    try {
      const { data, error } = await supabase.functions.invoke("validar-numeros-whatsapp", {
        body: { contato_ids: ids },
      });
      if (error) throw error;
      const r = data as { total: number; validos: number; invalidos: number; fixos: number };
      toast({
        title: "✅ Validação concluída",
        description: `${r.validos} válidos · ${r.invalidos} inválidos (${r.fixos} fixos detectados)`,
      });
      carregar();
    } catch (err: any) {
      toast({ title: "Erro na validação", description: err.message, variant: "destructive" });
    } finally {
      setValidandoWa(false);
    }
  };

  // ============ FILTROS ============
  const filtered = contatos.filter((c) => {
    const s = search.toLowerCase();
    const matchSearch = !s ||
      c.nome.toLowerCase().includes(s) ||
      (c.telefone ?? "").toLowerCase().includes(s) ||
      (c.email ?? "").toLowerCase().includes(s) ||
      (c.empresa ?? "").toLowerCase().includes(s);
    const matchStatus = statusFilter === "todos" || c.status === statusFilter;
    const matchLista = listaFiltro === "todas" || c.lista_id === listaFiltro;
    return matchSearch && matchStatus && matchLista;
  });

  return (
    <CRMLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leads & Contatos</h1>
            <p className="text-muted-foreground text-sm">
              {filtered.length} de {contatos.length} contato(s)
              {listas.length > 0 && ` • ${listas.length} lista(s)`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setModalLista(true)}>
              <FolderPlus className="h-4 w-4 mr-1" /> Nova Lista
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setImportLista(""); setModalImport(true); }}>
              <Upload className="h-4 w-4 mr-1" /> Importar CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportarCsv}>
              <Download className="h-4 w-4 mr-1" /> Exportar CSV
            </Button>
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="h-4 w-4 mr-1" /> Novo Contato
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, e-mail ou empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={listaFiltro} onValueChange={setListaFiltro}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as listas</SelectItem>
              {listas.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos status</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tags rápidas das listas */}
        {listas.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {listas.map((l) => {
              const ativo = listaFiltro === l.id;
              const count = contatos.filter((c) => c.lista_id === l.id).length;
              return (
                <Badge
                  key={l.id}
                  variant={ativo ? "default" : "outline"}
                  className="cursor-pointer gap-2 py-1 pr-1"
                  onClick={() => setListaFiltro(ativo ? "todas" : l.id)}
                >
                  {l.nome} <span className="opacity-70">({count})</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removerLista(l.id); }}
                    className="ml-1 rounded hover:bg-destructive/20 p-0.5"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}

        {/* Tabela */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nenhum contato encontrado</p>
                <p className="text-sm mt-1">Importe um CSV ou adicione manualmente seu primeiro contato.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome / Empresa</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/40" onClick={() => abrirEdicao(c)}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{c.nome}</p>
                          {(tarefasPendentes.get(c.id) ?? 0) > 0 && (
                            <Badge
                              className="bg-destructive text-white text-[10px] h-4 px-1 gap-0.5"
                              title={`${tarefasPendentes.get(c.id)} tarefa(s) pendente(s)`}
                            >
                              <ListTodo className="h-2.5 w-2.5" />
                              {tarefasPendentes.get(c.id)}
                            </Badge>
                          )}
                        </div>
                        {c.empresa && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3" />{c.empresa}
                            {c.cargo && ` • ${c.cargo}`}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.telefone && (
                          <div className="text-xs flex items-center gap-1.5">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span>{c.telefone}</span>
                            {(() => {
                              const wa = formatWhatsappNumber(c.telefone);
                              if (!wa) return null;
                              return (
                                <a
                                  href={`https://wa.me/${wa}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Abrir conversa no WhatsApp"
                                  className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-whatsapp/15 text-whatsapp hover:bg-whatsapp hover:text-whatsapp-foreground transition-colors"
                                >
                                  <MessageCircle className="h-3 w-3" />
                                </a>
                              );
                            })()}
                          </div>
                        )}
                        {c.email && (
                          <p className="text-xs flex items-center gap-1 text-muted-foreground">
                            <Mail className="h-3 w-3" />{c.email}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{c.origem ?? "Manual"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${statusColor[c.status] ?? "bg-muted"} text-xs border-0`}>
                          {statusOptions.find((s) => s.value === c.status)?.label ?? c.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {(c.tags ?? []).slice(0, 3).map((t) => (
                            <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                          ))}
                          {(c.tags?.length ?? 0) > 3 && (
                            <Badge variant="secondary" className="text-xs">+{(c.tags?.length ?? 0) - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEdicao(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removerContato(c.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ============ MODAL: Nova Lista ============ */}
        <Dialog open={modalLista} onOpenChange={setModalLista}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Lista</DialogTitle>
              <DialogDescription>Organize seus contatos por categoria, campanha ou nicho.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Nome da lista</Label>
                <Input
                  value={novaLista.nome}
                  onChange={(e) => setNovaLista({ ...novaLista, nome: e.target.value })}
                  placeholder="Ex: Odontologistas SP"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição (opcional)</Label>
                <Input
                  value={novaLista.descricao}
                  onChange={(e) => setNovaLista({ ...novaLista, descricao: e.target.value })}
                  placeholder="Ex: Prospecção janeiro 2026"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setModalLista(false)}>Cancelar</Button>
              <Button onClick={criarLista}>Criar lista</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ============ MODAL: Importar CSV ============ */}
        <Dialog open={modalImport} onOpenChange={setModalImport}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Importar contatos via CSV ou Excel</DialogTitle>
              <DialogDescription>
                Envie um arquivo do seu dispositivo (CSV, XLSX, XLS) ou cole o conteúdo abaixo.
              </DialogDescription>
            </DialogHeader>

            <div className="bg-muted rounded-lg p-4 text-xs space-y-3">
              <p className="font-semibold text-sm">📂 Formatos aceitos automaticamente</p>

              <div className="space-y-1">
                <p className="font-medium text-primary">1. Exportação do Cnpj.biz</p>
                <p className="text-muted-foreground">
                  CSV com colunas como "Nome da empresa", "CNPJ ou CPF da empresa", "Categoria da empresa".
                  O sistema detecta e mapeia tudo automaticamente, incluindo segmento, porte e sócio.
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-medium text-primary">2. Exportação do próprio CRM (MentoArk)</p>
                <p className="text-muted-foreground">
                  CSV com colunas: nome, telefone, email, empresa, cargo, origem, status, tags, notas.
                  Tags separadas por ponto e vírgula (;).
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-medium text-primary">3. CSV genérico de qualquer sistema</p>
                <p className="text-muted-foreground">
                  O sistema tenta identificar automaticamente os campos por nome da coluna
                  (aceita variações como "fone", "celular", "company", "e-mail" etc.).
                </p>
              </div>

              <div className="border-t border-border pt-2 space-y-1">
                <p className="font-medium">⚠️ Requisitos do arquivo</p>
                <p className="text-muted-foreground">• Primeira linha deve ser o cabeçalho (nomes das colunas)</p>
                <p className="text-muted-foreground">• Separador: vírgula (,) — campos com vírgula devem estar entre aspas</p>
                <p className="text-muted-foreground">• Codificação: UTF-8 (com ou sem BOM)</p>
                <p className="text-muted-foreground">• Cada contato precisa ter ao menos nome ou telefone preenchido</p>
              </div>
            </div>

            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label>Lista de destino</Label>
                <Select value={importLista} onValueChange={setImportLista}>
                  <SelectTrigger>
                    <SelectValue placeholder={listas.length ? "Selecione uma lista" : "Crie uma lista primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {listas.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Importar do dispositivo</Label>
                <label className="flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer py-6 px-4 text-sm">
                  <FileUp className="h-5 w-5 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Clique para selecionar um arquivo <strong className="text-foreground">CSV, XLSX ou XLS</strong>
                  </span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="hidden"
                    onChange={handleArquivo}
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <Label>Ou cole o conteúdo do CSV</Label>
                <Textarea
                  value={csvTexto}
                  onChange={(e) => setCsvTexto(e.target.value)}
                  placeholder="Cole aqui o CSV (com a primeira linha de cabeçalhos)..."
                  rows={10}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setModalImport(false)}>Cancelar</Button>
              <Button onClick={importarCSV} disabled={!csvTexto.trim()}>
                <Upload className="h-4 w-4 mr-1" /> Importar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ============ MODAL: Novo / Editar Contato ============ */}
        <Dialog open={modalContato} onOpenChange={setModalContato}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar contato" : "Novo contato"}</DialogTitle>
            </DialogHeader>

            {editing ? (
              <Tabs defaultValue="dados" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="dados">Dados</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="tarefas" className="gap-1.5">
                    Tarefas
                    {(tarefasPendentes.get(editing.id) ?? 0) > 0 && (
                      <Badge className="bg-destructive text-white text-[10px] h-4 px-1">
                        {tarefasPendentes.get(editing.id)}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="dados" className="space-y-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Nome *</Label>
                      <Input value={contatoForm.nome} onChange={(e) => setContatoForm({ ...contatoForm, nome: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Telefone</Label>
                      <Input value={contatoForm.telefone} onChange={(e) => setContatoForm({ ...contatoForm, telefone: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>E-mail</Label>
                      <Input value={contatoForm.email} onChange={(e) => setContatoForm({ ...contatoForm, email: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Empresa</Label>
                      <Input value={contatoForm.empresa} onChange={(e) => setContatoForm({ ...contatoForm, empresa: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cargo</Label>
                      <Input value={contatoForm.cargo} onChange={(e) => setContatoForm({ ...contatoForm, cargo: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Origem</Label>
                      <Input value={contatoForm.origem} onChange={(e) => setContatoForm({ ...contatoForm, origem: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={contatoForm.status} onValueChange={(v) => setContatoForm({ ...contatoForm, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Lista</Label>
                      <Select value={contatoForm.lista_id} onValueChange={(v) => setContatoForm({ ...contatoForm, lista_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Sem lista" /></SelectTrigger>
                        <SelectContent>
                          {listas.map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tags (separadas por vírgula)</Label>
                    <Input value={contatoForm.tags} onChange={(e) => setContatoForm({ ...contatoForm, tags: e.target.value })} placeholder="Ex: VIP, Urgente, Indicação" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notas</Label>
                    <Textarea value={contatoForm.notas} onChange={(e) => setContatoForm({ ...contatoForm, notas: e.target.value })} rows={4} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setModalContato(false)}>Cancelar</Button>
                    <Button onClick={salvarContato} disabled={!contatoForm.nome.trim()}>
                      Salvar alterações
                    </Button>
                  </DialogFooter>
                </TabsContent>

                <TabsContent value="timeline" className="py-2">
                  <LeadTimeline contatoId={editing.id} />
                </TabsContent>

                <TabsContent value="tarefas" className="py-2">
                  <LeadTarefas contatoId={editing.id} onChange={recarregarTarefas} />
                </TabsContent>
              </Tabs>
            ) : (
              <>
                <div className="space-y-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Nome *</Label>
                      <Input value={contatoForm.nome} onChange={(e) => setContatoForm({ ...contatoForm, nome: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Telefone</Label>
                      <Input value={contatoForm.telefone} onChange={(e) => setContatoForm({ ...contatoForm, telefone: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>E-mail</Label>
                      <Input value={contatoForm.email} onChange={(e) => setContatoForm({ ...contatoForm, email: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Empresa</Label>
                      <Input value={contatoForm.empresa} onChange={(e) => setContatoForm({ ...contatoForm, empresa: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cargo</Label>
                      <Input value={contatoForm.cargo} onChange={(e) => setContatoForm({ ...contatoForm, cargo: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Origem</Label>
                      <Input value={contatoForm.origem} onChange={(e) => setContatoForm({ ...contatoForm, origem: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={contatoForm.status} onValueChange={(v) => setContatoForm({ ...contatoForm, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Lista</Label>
                      <Select value={contatoForm.lista_id} onValueChange={(v) => setContatoForm({ ...contatoForm, lista_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Sem lista" /></SelectTrigger>
                        <SelectContent>
                          {listas.map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tags (separadas por vírgula)</Label>
                    <Input value={contatoForm.tags} onChange={(e) => setContatoForm({ ...contatoForm, tags: e.target.value })} placeholder="Ex: VIP, Urgente, Indicação" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notas</Label>
                    <Textarea value={contatoForm.notas} onChange={(e) => setContatoForm({ ...contatoForm, notas: e.target.value })} rows={4} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setModalContato(false)}>Cancelar</Button>
                  <Button onClick={salvarContato} disabled={!contatoForm.nome.trim()}>
                    Criar contato
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </CRMLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Loader2, FileSpreadsheet, FileText, Users, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface Lista {
  id: string;
  nome: string;
}

interface FunilEstagio {
  id: string;
  nome: string;
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
  nome_verificado: boolean | null;
  created_at: string;
  responsavel: string | null;
  funil_estagio_id: string | null;
}

// [AUDITORIA] LÓGICA: mesmo padrão de `fetchAllContatos()` já usado em `Disparos.tsx` (Sprint
// Cooldown de Disparos, 2026-07-29) — o GET genérico (`backend/src/crud.ts`) tem default de
// `limit=100` (teto 500), então uma tela de exportação "todos os dados", por definição, não pode
// confiar no default sem truncar silenciosamente contas com mais de 100 contatos. Duplicado aqui
// (em vez de importar de `Disparos.tsx`, que não exporta a função) — função pequena o bastante
// pra não valer o acoplamento entre páginas.
async function fetchAllContatos(build: () => any): Promise<any[]> {
  const PAGE_SIZE = 500;
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const { data } = await build().limit(PAGE_SIZE).page(page);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

const statusOptions = [
  { value: "novo", label: "Novo" },
  { value: "contatado", label: "Contatado" },
  { value: "qualificado", label: "Qualificado" },
  { value: "agendado", label: "Agendado" },
  { value: "fechado", label: "Fechado" },
  { value: "perdido", label: "Perdido" },
];

// [AUDITORIA] LÓGICA (Sprint Nome Real de Leads de Grupo, 2026-08-26 — pedido explícito do
// usuário: "uma tela própria de exportação" além do botão que já existe em Leads.tsx): esta
// página não recria nenhum CRUD — reusa a mesma fonte (`api.from("contatos")`, já usada em
// `Leads.tsx`) só que sem o recorte de UI da tela de Leads (paginação visual, edição inline).
// Foco único: trazer TODOS os contatos do usuário (todas as listas, sem filtro implícito) e
// deixar explícito, coluna própria, quando o Nome é um nome real resolvido (cadeia em
// `resolverNomeParticipante()`, backend/src/routes/whatsapp.ts) ou não — o problema central que
// motivou esta tela ("o mais importante além do número é o nome, aí mora o erro").
export default function ExportarDadosPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [listas, setListas] = useState<Lista[]>([]);
  const [funilEstagios, setFunilEstagios] = useState<FunilEstagio[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [exportando, setExportando] = useState<"csv" | "excel" | null>(null);
  // [AUDITORIA] LÓGICA (achado do usuário, 2026-08-26 — pediu um modelo de planilha específico:
  // Título/Pessoa/Usuário/Funil/Estágio/Status, formato de "negócio" já usado por ferramentas de
  // funil externas): não substitui o modelo "CRM completo" já entregue — são dois formatos de
  // saída pro MESMO conjunto filtrado de contatos, escolhidos aqui.
  const [modelo, setModelo] = useState<"crm" | "funil">("crm");

  const [listaFiltro, setListaFiltro] = useState("todas");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [origemFiltro, setOrigemFiltro] = useState("todas");
  const [nomeVerificadoFiltro, setNomeVerificadoFiltro] = useState("todos"); // todos | sim | nao

  useEffect(() => {
    const carregar = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const [{ data: l }, { data: fe }, contatosData] = await Promise.all([
          api.from("listas").select("*").eq("user_id", user.id).order("nome", { ascending: true }),
          api.from("funil_estagios").select("*").eq("user_id", user.id).order("ordem", { ascending: true }),
          fetchAllContatos(() => api.from("contatos").select("*").eq("user_id", user.id)),
        ]);
        setListas(l ?? []);
        setFunilEstagios(fe ?? []);
        setContatos(contatosData ?? []);
      } catch (err) {
        console.error("[ExportarDados] Erro ao carregar:", err);
        toast({ title: "Erro ao carregar dados", description: "Não foi possível carregar os contatos.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    carregar();
  }, [user?.id]);

  const listaNomePorId = useMemo(() => new Map(listas.map((l) => [l.id, l.nome])), [listas]);
  const estagioNomePorId = useMemo(() => new Map(funilEstagios.map((f) => [f.id, f.nome])), [funilEstagios]);
  const origensDisponiveis = useMemo(
    () => Array.from(new Set(contatos.map((c) => c.origem || "Manual"))).sort((a, b) => a.localeCompare(b)),
    [contatos]
  );

  const filtrados = useMemo(() => contatos.filter((c) => {
    const matchLista = listaFiltro === "todas" || c.lista_id === listaFiltro;
    const matchStatus = statusFiltro === "todos" || c.status === statusFiltro;
    const matchOrigem = origemFiltro === "todas" || (c.origem || "Manual") === origemFiltro;
    const matchNomeVerificado =
      nomeVerificadoFiltro === "todos" ||
      (nomeVerificadoFiltro === "sim" && c.nome_verificado === true) ||
      (nomeVerificadoFiltro === "nao" && c.nome_verificado !== true);
    return matchLista && matchStatus && matchOrigem && matchNomeVerificado;
  }), [contatos, listaFiltro, statusFiltro, origemFiltro, nomeVerificadoFiltro]);

  const totalNomeVerificado = useMemo(() => filtrados.filter((c) => c.nome_verificado === true).length, [filtrados]);
  const totalNaoVerificado = useMemo(() => filtrados.length - totalNomeVerificado, [filtrados, totalNomeVerificado]);

  const rotuloNomeVerificado = (c: Contato) =>
    c.nome_verificado === true ? "Sim" : c.nome_verificado === false ? "Não" : "Não avaliado";

  // [AUDITORIA] LÓGICA: mesmo conjunto de colunas de `exportarCsv()` em `Leads.tsx`
  // (nome/telefone/email/empresa/cargo/origem/status/tags/notas), acrescido de `Lista` (nome
  // resolvido via join client-side com `listas`, ausente no export original) e `Nome Verificado`
  // (sinal novo — ver comentário no topo do arquivo).
  const linhasExport = useMemo(() => filtrados.map((c) => ({
    Nome: c.nome ?? "",
    "Nome Verificado": rotuloNomeVerificado(c),
    Telefone: c.telefone ?? "",
    Email: c.email ?? "",
    Empresa: c.empresa ?? "",
    Cargo: c.cargo ?? "",
    Origem: c.origem ?? "Manual",
    Status: statusOptions.find((s) => s.value === c.status)?.label ?? c.status ?? "",
    Lista: c.lista_id ? (listaNomePorId.get(c.lista_id) ?? "") : "",
    Tags: (c.tags ?? []).join("; "),
    Notas: (c.notas ?? "").replace(/\n/g, " "),
    "Data de Criação": c.created_at ? new Date(c.created_at).toLocaleDateString("pt-BR") : "",
  })), [filtrados, listaNomePorId]);

  // [AUDITORIA] LÓGICA (pedido literal do usuário, 2026-08-26): modelo "de negócio" — Título,
  // Pessoa (nome e telefone), Usuário (responsável), Funil, Estágio, Status — pra importar em
  // ferramenta externa de funil. Nosso schema não tem um campo "Título" nem "Funil" (nomeado)
  // por lead: `contatos.responsavel` já é o texto livre certo pra Usuário;
  // `contatos.funil_estagio_id` resolve Estágio via `funil_estagios.nome`; não existe conceito de
  // múltiplos funis nomeados no schema (só estágios), então Funil vem fixo. Título reaproveita o
  // nome do contato (mesmo dado de Pessoa) — decisão explícita do usuário: preencher com dado do
  // CRM em vez de deixar vazio, mesmo sem um campo "título" próprio.
  const linhasExportFunil = useMemo(() => filtrados.map((c) => ({
    "Título": c.nome ?? "",
    "Pessoa": [c.nome, c.telefone].filter(Boolean).join(" - "),
    "Usuário": c.responsavel ?? "",
    "Funil": "Funil de Vendas",
    "Estágio": c.funil_estagio_id ? (estagioNomePorId.get(c.funil_estagio_id) ?? "") : "",
    "Status": statusOptions.find((s) => s.value === c.status)?.label ?? c.status ?? "",
  })), [filtrados, estagioNomePorId]);

  const linhasAtivas = modelo === "funil" ? linhasExportFunil : linhasExport;
  const nomePlanilha = modelo === "funil" ? "Funil de Vendas" : "Dados do CRM";
  const nomeArquivo = modelo === "funil" ? "funil_vendas" : "dados_crm";
  const largurasColuna = modelo === "funil"
    ? [{ wch: 28 }, { wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]
    : [
        { wch: 24 }, { wch: 15 }, { wch: 16 }, { wch: 24 }, { wch: 20 }, { wch: 16 },
        { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 30 }, { wch: 14 },
      ];

  const exportarCsv = () => {
    if (!linhasAtivas.length) { toast({ title: "Nenhum contato para exportar" }); return; }
    setExportando("csv");
    try {
      const headers = Object.keys(linhasAtivas[0]);
      const rows = linhasAtivas.map((l) =>
        headers.map((h) => `"${String((l as Record<string, string>)[h]).replace(/"/g, '""')}"`).join(",")
      );
      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `✅ ${linhasAtivas.length} contato(s) exportado(s) em CSV` });
    } finally {
      setExportando(null);
    }
  };

  const exportarExcel = () => {
    if (!linhasAtivas.length) { toast({ title: "Nenhum contato para exportar" }); return; }
    setExportando("excel");
    try {
      const planilha = XLSX.utils.json_to_sheet(linhasAtivas);
      // Larguras de coluna generosas — evita abrir no Excel com tudo cortado ("###")
      planilha["!cols"] = largurasColuna;
      const livro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(livro, planilha, nomePlanilha);
      XLSX.writeFile(livro, `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast({ title: `✅ ${linhasAtivas.length} contato(s) exportado(s) em Excel` });
    } finally {
      setExportando(null);
    }
  };

  return (
    <CRMLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exportar Dados</h1>
          <p className="text-muted-foreground text-sm">
            Exporte todos os leads/contatos do CRM em CSV ou Excel — não só a lista filtrada na tela de Leads.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{filtrados.length}</p>
                <p className="text-xs text-muted-foreground">contato(s) no filtro atual</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <ShieldCheck className="h-8 w-8 text-success" />
              <div>
                <p className="text-2xl font-bold">{totalNomeVerificado}</p>
                <p className="text-xs text-muted-foreground">com nome real verificado</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <ShieldQuestion className="h-8 w-8 text-warning" />
              <div>
                <p className="text-2xl font-bold">{totalNaoVerificado}</p>
                <p className="text-xs text-muted-foreground">sem nome confirmado</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Select value={listaFiltro} onValueChange={setListaFiltro}>
              <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Lista" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as listas</SelectItem>
                {listas.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={origemFiltro} onValueChange={setOrigemFiltro}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Origem" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as origens</SelectItem>
                {origensDisponiveis.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={nomeVerificadoFiltro} onValueChange={setNomeVerificadoFiltro}>
              <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Nome verificado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Nome: todos</SelectItem>
                <SelectItem value="sim">Nome: só verificados</SelectItem>
                <SelectItem value="nao">Nome: só não verificados</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Exportar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Modelo da planilha</p>
              <Select value={modelo} onValueChange={(v) => setModelo(v as "crm" | "funil")}>
                <SelectTrigger className="w-full sm:w-[280px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="crm">CRM completo (Nome, Telefone, Email, Empresa...)</SelectItem>
                  <SelectItem value="funil">Funil de Vendas (Título, Pessoa, Usuário, Estágio...)</SelectItem>
                </SelectContent>
              </Select>
              {modelo === "funil" && (
                <p className="text-xs text-muted-foreground">
                  Colunas: Título, Pessoa (nome e telefone), Usuário (responsável), Funil, Estágio, Status.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={exportarCsv} disabled={loading || exportando !== null}>
                {exportando === "csv" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                Exportar CSV
              </Button>
              <Button variant="outline" onClick={exportarExcel} disabled={loading || exportando !== null}>
                {exportando === "excel" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                Exportar Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prévia (20 primeiros)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
              </div>
            ) : filtrados.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Download className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nenhum contato no filtro atual</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Nome Verificado</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead className="hidden sm:table-cell">Origem</TableHead>
                      <TableHead className="hidden md:table-cell">Lista</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtrados.slice(0, 20).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.nome}</TableCell>
                        <TableCell>
                          <Badge
                            variant={c.nome_verificado === true ? "default" : "outline"}
                            className={c.nome_verificado === true ? "bg-success/15 text-success border-0 text-xs" : "text-xs"}
                          >
                            {rotuloNomeVerificado(c)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{c.telefone}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="outline" className="text-xs">{c.origem ?? "Manual"}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {c.lista_id ? (listaNomePorId.get(c.lista_id) ?? "—") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CRMLayout>
  );
}

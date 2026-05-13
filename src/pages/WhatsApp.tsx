import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Search, Bot, User, Phone, MessageCircle, RefreshCw, Loader2, Copy, ExternalLink, FileDown, UserCheck, Save } from "lucide-react";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { WhatsAppStatus } from "@/components/WhatsAppStatus";

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

interface Conversa {
  session_id: string;
  nome: string | null;
  instancia: string | null;
  mensagens: { role: 'user' | 'assistant'; content: string; created_at: string }[];
  ultima_atividade: string;
  ultima_mensagem: string;
  total: number;
}

interface LeadInfo {
  id: string;
  nome: string;
  status: string;
}

const statusOptions = [
  { value: "novo", label: "Novo" },
  { value: "contatado", label: "Contatado" },
  { value: "qualificado", label: "Qualificado" },
  { value: "agendado", label: "Agendado" },
  { value: "fechado", label: "Fechado" },
  { value: "perdido", label: "Perdido" },
];

const formatPhone = (raw: string) => {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
};

const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
};

const PERIODOS = {
  hoje: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); },
  "24h": () => new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  "7d": () => new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  todos: () => null as string | null,
} as const;

export default function WhatsAppPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>("todos");
  const [selecionada, setSelecionada] = useState<Conversa | null>(null);

  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [leadStatus, setLeadStatus] = useState<string>("novo");
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadSaving, setLeadSaving] = useState(false);

  const [chatSearch, setChatSearch] = useState("");

  const getToken = () =>
    localStorage.getItem('access_token') || localStorage.getItem('crm_access_token') || '';

  const carregar = async () => {
    if (conversas.length === 0) setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/conversas`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Erro ao carregar conversas');
      const data: Conversa[] = await res.json();
      setConversas(data);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    const i = setInterval(carregar, 5000);
    return () => clearInterval(i);
  }, []);

  const filtradas = useMemo(() => {
    const since = PERIODOS[periodo]();
    let list = since
      ? conversas.filter((c) => c.ultima_atividade >= since)
      : conversas;

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.session_id.toLowerCase().includes(q.replace(/\D/g, "")) ||
        c.ultima_mensagem.toLowerCase().includes(q) ||
        (c.nome && c.nome.toLowerCase().includes(q))
      );
    }
    return list;
  }, [conversas, search, periodo]);

  const kpis = useMemo(() => {
    const hojeIso = PERIODOS.hoje();
    const conversasHoje = conversas.filter((c) => c.ultima_atividade >= hojeIso);
    const mensagensHoje = conversasHoje.reduce((acc, c) => acc + c.total, 0);
    const totalMsgs = conversas.reduce((acc, c) => acc + c.total, 0);
    const media = conversas.length ? Math.round(totalMsgs / conversas.length) : 0;
    const maior = conversas.length ? Math.max(...conversas.map((c) => c.total)) : 0;
    return { conversasHoje: conversasHoje.length, mensagensHoje, media, maior };
  }, [conversas]);

  const buscarLead = async (phone: string) => {
    if (!user) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return;
    setLeadLoading(true);
    const { data } = await api
      .from("dados_cliente")
      .select("id, nomewpp, Setor")
      .ilike("telefone", `%${digits.slice(-9)}%`)
      .limit(1)
      .maybeSingle();

    if (data) {
      setLead({ id: String(data.id), nome: data.nomewpp || "Sem nome", status: data.Setor || "novo" });
      setLeadStatus(data.Setor || "novo");
    } else {
      setLead(null);
    }
    setLeadLoading(false);
  };

  const salvarStatusLead = async () => {
    if (!lead) return;
    setLeadSaving(true);
    const { error } = await api
      .from("dados_cliente")
      .update({ Setor: leadStatus })
      .eq("id", lead.id);
    setLeadSaving(false);
    if (error) {
      toast.error("Erro ao salvar setor");
      return;
    }
    setLead({ ...lead, status: leadStatus });
    toast.success("Setor atualizado");
  };

  const abrirConversa = async (c: Conversa) => {
    setSelecionada(c);
    setChatSearch('');
    setLead(null);
    setLeadStatus('novo');
    buscarLead(c.session_id);

    try {
      const res = await fetch(
        `${API_BASE}/api/whatsapp/conversas/${encodeURIComponent(c.session_id)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error('Erro ao carregar mensagens');
      const msgs = await res.json();
      setSelecionada({ ...c, mensagens: msgs });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copiarTelefone = (tel: string) => {
    navigator.clipboard.writeText(tel);
    toast.success("Telefone copiado");
  };

  const exportarTxt = () => {
    if (!selecionada) return;
    const linhas = selecionada.mensagens.map((m) => {
      const isHuman = m.role === "user";
      const autor = isHuman ? "Lead" : "Agente";
      const data = new Date(m.created_at).toLocaleString("pt-BR");
      return `[${data}] ${autor}: ${m.content}`;
    });
    const cabecalho = [
      `Conversa WhatsApp — ${formatPhone(selecionada.session_id)}`,
      `Total de mensagens: ${selecionada.mensagens.length}`,
      `Exportado em: ${new Date().toLocaleString("pt-BR")}`,
      "─".repeat(60),
      "",
    ];
    const conteudo = [...cabecalho, ...linhas].join("\n");
    const blob = new Blob([conteudo], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversa_${selecionada.session_id.replace(/\D/g, "")}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Conversa exportada");
  };

  const mensagensFiltradas = useMemo(() => {
    if (!selecionada) return [];
    const q = chatSearch.trim().toLowerCase();
    if (!q) return selecionada.mensagens;
    return selecionada.mensagens.filter((m) =>
      m.content.toLowerCase().includes(q),
    );
  }, [selecionada, chatSearch]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
            <p className="text-muted-foreground text-sm">Gerencie sua conexão e acompanhe as interações do agente</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
          </div>
        </div>

        {/* Status da Conexão Evolution */}
        <WhatsAppStatus />

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-2xl font-bold">{kpis.conversasHoje}</p><p className="text-xs text-muted-foreground">Conversas hoje</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-2xl font-bold">{conversas.length}</p><p className="text-xs text-muted-foreground">Total conversas</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-2xl font-bold">{kpis.mensagensHoje}</p><p className="text-xs text-muted-foreground">Mensagens hoje</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-2xl font-bold">{kpis.media}</p><p className="text-xs text-muted-foreground">Média msg/conversa</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-2xl font-bold">{kpis.maior}</p><p className="text-xs text-muted-foreground">Maior conversa</p></CardContent></Card>
        </div>

        {/* Filtros */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por telefone ou mensagem..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as keyof typeof PERIODOS)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="24h">Últimas 24h</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista */}
        {loading && conversas.length === 0 ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageCircle className="h-16 w-16 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold">Nenhuma conversa registrada ainda</h3>
            <p className="text-sm text-muted-foreground mt-1">Quando o agente IA conversar via WhatsApp, o histórico aparecerá aqui.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtradas.map((c) => {
              const ativa = Date.now() - new Date(c.ultima_atividade).getTime() < 30 * 60 * 1000;
              return (
                <Card
                  key={c.session_id}
                  className={`hover:border-primary/30 transition-all cursor-pointer border-l-4 ${ativa ? "border-l-success" : "border-l-transparent"} ${selecionada?.session_id === c.session_id ? "ring-2 ring-primary/20 border-primary/50" : ""}`}
                  onClick={() => abrirConversa(c)}
                >
                  <CardContent className="p-4 flex flex-col h-full">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${ativa ? "bg-success/15" : "bg-muted"}`}>
                          <User className={`h-5 w-5 ${ativa ? "text-success" : "text-muted-foreground"}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{c.nome || formatPhone(c.session_id)}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Phone className="h-2.5 w-2.5" /> {c.session_id}
                          </p>
                        </div>
                      </div>
                      <Badge variant={ativa ? "default" : "secondary"} className="text-[9px] h-4 px-1 animate-pulse-slow">
                        {ativa ? "Online" : "Offline"}
                      </Badge>
                    </div>

                    <div className="flex-1 bg-muted/30 rounded p-2 mb-3">
                      <p className="text-xs text-muted-foreground line-clamp-2 italic">
                        "{c.ultima_mensagem}"
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{c.total} msg</Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {relativeTime(c.ultima_atividade)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Painel de histórico */}
      <Sheet open={!!selecionada} onOpenChange={(o) => !o && setSelecionada(null)}>
        <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0 border-none bg-background shadow-2xl">
          <div className="p-6 border-b bg-muted/20">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <SheetTitle className="text-xl">{selecionada && (selecionada.nome || formatPhone(selecionada.session_id))}</SheetTitle>
                    <SheetDescription className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {selecionada?.session_id} • {selecionada?.mensagens.length} mensagens
                    </SheetDescription>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="outline" onClick={() => selecionada && copiarTelefone(selecionada.session_id)} title="Copiar Telefone">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" onClick={exportarTxt} title="Exportar Histórico">
                    <FileDown className="h-4 w-4" />
                  </Button>
                  <Button size="icon" asChild className="bg-whatsapp hover:bg-whatsapp/90 text-white">
                    <a href={`https://wa.me/${selecionada?.session_id?.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            </SheetHeader>
          </div>

          <div className="px-6 py-4 flex flex-col flex-1 overflow-hidden">
            {/* Card do lead vinculado */}
            <div className="rounded-xl border border-border p-4 bg-muted/30 mb-4">
              {leadLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando lead...
                </div>
              ) : lead ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                      <UserCheck className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <p className="text-sm font-bold">{lead.nome}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lead Identificado</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={leadStatus} onValueChange={setLeadStatus}>
                      <SelectTrigger className="h-9 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-9"
                      onClick={salvarStatusLead}
                      disabled={leadSaving || leadStatus === lead.status}
                    >
                      {leadSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground italic">Lead não encontrado nos contatos</p>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/leads")}>Ver todos</Button>
                </div>
              )}
            </div>

            {/* Busca no chat */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar palavra-chave nesta conversa..."
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                className="pl-9 h-10 text-sm bg-muted/20 border-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-3 pr-2">
              {mensagensFiltradas.map((m, idx) => {
                const isHuman = m.role === "user";
                return (
                  <div key={idx} className={`flex ${isHuman ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 ${isHuman ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {!isHuman && <div className="flex items-center gap-1 text-xs opacity-70 mb-1"><Bot className="h-3 w-3" /> Agente</div>}
                      {isHuman && <div className="flex items-center gap-1 text-xs opacity-70 mb-1 justify-end"><User className="h-3 w-3" /> Lead</div>}
                      <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                      <p className="text-[10px] opacity-60 mt-1 text-right">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                );
              })}
              {chatSearch && mensagensFiltradas.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma mensagem corresponde à busca
                </p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </CRMLayout>
  );
}

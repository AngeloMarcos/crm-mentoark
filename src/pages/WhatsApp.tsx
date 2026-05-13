import { useEffect, useMemo, useState } from "react";
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

interface ChatRow {
  id: number;
  phone: string;
  nomewpp: string | null;
  user_message: string | null;
  bot_message: string | null;
  created_at: string;
}

interface Conversa {
  session_id: string; // We'll use phone as session_id
  nome: string | null;
  mensagens: { id: number; type: 'human' | 'ai'; content: string; created_at: string }[];
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
  const { user } = useAuth();
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>("todos");
  const [selecionada, setSelecionada] = useState<Conversa | null>(null);

  // Lead vinculado à conversa aberta
  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [leadStatus, setLeadStatus] = useState<string>("novo");
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadSaving, setLeadSaving] = useState(false);

  // Busca dentro do chat
  const [chatSearch, setChatSearch] = useState("");

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await api
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000);
    
    if (error) {
      toast.error("Erro ao carregar conversas: " + error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ChatRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
    const i = setInterval(carregar, 5000); // 5s update para tempo real aproximado
    return () => clearInterval(i);
  }, []);

  const filtradas = useMemo(() => {
    const since = PERIODOS[periodo]();
    const filteredRows = since ? rows.filter((r) => r.created_at >= since) : rows;
    
    const map = new Map<string, Conversa>();
    
    for (const r of filteredRows) {
      const phone = r.phone || "unknown";
      let cur = map.get(phone);
      
      const newMessages: { id: number; type: 'human' | 'ai'; content: string; created_at: string }[] = [];
      if (r.user_message) {
        newMessages.push({ id: r.id, type: 'human', content: r.user_message, created_at: r.created_at });
      }
      if (r.bot_message) {
        newMessages.push({ id: r.id, type: 'ai', content: r.bot_message, created_at: r.created_at });
      }

      if (!cur) {
        map.set(phone, {
          session_id: phone,
          nome: r.nomewpp,
          mensagens: newMessages,
          ultima_atividade: r.created_at,
          ultima_mensagem: r.user_message || r.bot_message || "",
          total: newMessages.length,
        });
      } else {
        cur.mensagens.push(...newMessages);
        cur.total += newMessages.length;
        if (new Date(r.created_at) > new Date(cur.ultima_atividade)) {
          cur.ultima_atividade = r.created_at;
          cur.ultima_mensagem = r.user_message || r.bot_message || cur.ultima_mensagem;
        }
      }
    }
    
    let list = Array.from(map.values());
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => 
        c.session_id.toLowerCase().includes(q.replace(/\D/g, "")) || 
        c.ultima_mensagem.toLowerCase().includes(q) ||
        (c.nome && c.nome.toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => (a.ultima_atividade < b.ultima_atividade ? 1 : -1));
  }, [rows, search, periodo]);

  const kpis = useMemo(() => {
    const hojeIso = PERIODOS.hoje();
    const hojeRows = rows.filter((r) => r.created_at >= hojeIso);
    const sessoesHoje = new Set(hojeRows.map((r) => r.phone));
    
    const allSessoes = new Map<string, number>();
    rows.forEach((r) => {
      const p = r.phone || "unknown";
      allSessoes.set(p, (allSessoes.get(p) ?? 0) + 1);
    });
    
    const maior = allSessoes.size ? Math.max(...allSessoes.values()) : 0;
    const media = allSessoes.size ? Math.round(rows.length / allSessoes.size) : 0;
    return { conversasHoje: sessoesHoje.size, mensagensHoje: hojeRows.length, media, maior };
  }, [rows]);

  const buscarLead = async (phone: string) => {
    if (!user) return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return;
    setLeadLoading(true);
    // Buscamos em dados_cliente que parece ser o padrão aqui
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
    setSelecionada(c); // Seta imediatamente para abrir o painel
    setChatSearch("");
    setLead(null);
    setLeadStatus("novo");
    buscarLead(c.session_id);

    const { data, error } = await api
      .from("chat_messages")
      .select("*")
      .eq("phone", c.session_id)
      .order("created_at", { ascending: true });
    
    if (error) return toast.error(error.message);
    
    const msgs: { id: number; type: 'human' | 'ai'; content: string; created_at: string }[] = [];
    (data || []).forEach(r => {
      if (r.user_message) msgs.push({ id: r.id, type: 'human', content: r.user_message, created_at: r.created_at });
      if (r.bot_message) msgs.push({ id: r.id, type: 'ai', content: r.bot_message, created_at: r.created_at });
    });

    setSelecionada({ ...c, mensagens: msgs });
  };

  const copiarTelefone = (tel: string) => {
    navigator.clipboard.writeText(tel);
    toast.success("Telefone copiado");
  };

  const exportarTxt = () => {
    if (!selecionada) return;
    const linhas = selecionada.mensagens.map((m) => {
      const isHuman = m.type === "human";
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
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
            <p className="text-muted-foreground text-sm">Histórico real de conversas do agente IA</p>
          </div>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-2xl font-bold">{kpis.conversasHoje}</p><p className="text-xs text-muted-foreground">Conversas hoje</p></CardContent></Card>
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
        {loading && rows.length === 0 ? (
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
        <SheetContent className="w-full sm:max-w-xl flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Phone className="h-4 w-4" /> {selecionada && formatPhone(selecionada.session_id)}</SheetTitle>
            <SheetDescription>{selecionada?.mensagens.length} mensagens nesta conversa</SheetDescription>
            <div className="flex gap-2 pt-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => selecionada && copiarTelefone(selecionada.session_id)}><Copy className="h-4 w-4 mr-1" /> Copiar</Button>
              <Button size="sm" variant="outline" onClick={exportarTxt}><FileDown className="h-4 w-4 mr-1" /> Exportar .txt</Button>
              <Button size="sm" asChild className="bg-whatsapp hover:bg-whatsapp/90 text-white">
                <a href={`https://wa.me/${selecionada?.session_id?.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> WhatsApp</a>
              </Button>
            </div>
          </SheetHeader>

          {/* Card do lead vinculado */}
          <div className="mt-3 rounded-lg border border-border p-3 bg-muted/30">
            {leadLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando lead...
              </div>
            ) : lead ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-success" />
                  <p className="text-sm font-medium">{lead.nome}</p>
                  <Badge variant="outline" className="text-xs">{lead.status}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={leadStatus} onValueChange={setLeadStatus}>
                    <SelectTrigger className="h-8 text-xs flex-1">
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
                    onClick={salvarStatusLead}
                    disabled={leadSaving || leadStatus === lead.status}
                  >
                    {leadSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Lead não encontrado nos contatos</p>
            )}
          </div>

          {/* Busca no chat */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar nesta conversa..."
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
            {chatSearch && (
              <p className="text-xs text-muted-foreground mt-1">
                {mensagensFiltradas.length} de {selecionada?.mensagens.length} mensagens
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto mt-3 space-y-3 pr-2">
            {mensagensFiltradas.map((m, idx) => {
              const isHuman = m.type === "human";
              return (
                <div key={m.id ?? idx} className={`flex ${isHuman ? "justify-end" : "justify-start"}`}>
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
        </SheetContent>
      </Sheet>
    </CRMLayout>
  );
}

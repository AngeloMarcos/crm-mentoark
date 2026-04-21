import { useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Search, Bot, User, Phone, MessageCircle, RefreshCw, Loader2, Copy, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ChatRow {
  id?: number;
  session_id: string;
  message: { type?: string; content?: string; [k: string]: unknown };
  created_at: string;
}

interface Conversa {
  session_id: string;
  mensagens: ChatRow[];
  ultima_atividade: string;
  ultima_mensagem: string;
  total: number;
}

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
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>("todos");
  const [selecionada, setSelecionada] = useState<Conversa | null>(null);

  const carregar = async () => {
    setLoading(true);
    // Tabela n8n_chat_histories não possui coluna user_id — acesso é controlado
    // pela RLS "Authenticated can read chat histories" (visível a autenticados).
    const { data, error } = await (supabase as any)
      .from("n8n_chat_histories")
      .select("id, session_id, message, created_at")
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
    const i = setInterval(carregar, 60000);
    return () => clearInterval(i);
  }, []);

  const filtradas = useMemo(() => {
    const since = PERIODOS[periodo]();
    const filtered = since ? rows.filter((r) => r.created_at >= since) : rows;
    const map = new Map<string, Conversa>();
    // rows já vêm desc → primeira ocorrência por sessão é a última mensagem
    for (const r of filtered) {
      const cur = map.get(r.session_id);
      if (!cur) {
        map.set(r.session_id, {
          session_id: r.session_id,
          mensagens: [r],
          ultima_atividade: r.created_at,
          ultima_mensagem: r.message?.content ?? "",
          total: 1,
        });
      } else {
        cur.mensagens.push(r);
        cur.total += 1;
      }
    }
    let list = Array.from(map.values());
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => c.session_id.toLowerCase().includes(q.replace(/\D/g, "")) || c.ultima_mensagem.toLowerCase().includes(q));
    return list.sort((a, b) => (a.ultima_atividade < b.ultima_atividade ? 1 : -1));
  }, [rows, search, periodo]);

  const kpis = useMemo(() => {
    const hojeIso = PERIODOS.hoje();
    const hoje = rows.filter((r) => r.created_at >= hojeIso);
    const sessoesHoje = new Set(hoje.map((r) => r.session_id));
    const allSessoes = new Map<string, number>();
    rows.forEach((r) => allSessoes.set(r.session_id, (allSessoes.get(r.session_id) ?? 0) + 1));
    const maior = allSessoes.size ? Math.max(...allSessoes.values()) : 0;
    const media = allSessoes.size ? Math.round(rows.length / allSessoes.size) : 0;
    return { conversasHoje: sessoesHoje.size, mensagensHoje: hoje.length, media, maior };
  }, [rows]);

  const abrirConversa = async (c: Conversa) => {
    // Buscar tudo dessa sessão (caso passe do limite)
    // Tabela n8n_chat_histories não possui coluna user_id — acesso controlado por RLS.
    const { data, error } = await (supabase as any)
      .from("n8n_chat_histories")
      .select("id, session_id, message, created_at")
      .eq("session_id", c.session_id)
      .order("created_at", { ascending: true });
    if (error) return toast.error(error.message);
    setSelecionada({ ...c, mensagens: (data ?? []) as ChatRow[] });
  };

  const copiarTelefone = (tel: string) => {
    navigator.clipboard.writeText(tel);
    toast.success("Telefone copiado");
  };

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
          <div className="space-y-2">
            {filtradas.map((c) => {
              const ativa = Date.now() - new Date(c.ultima_atividade).getTime() < 30 * 60 * 1000;
              return (
                <Card key={c.session_id} className="hover:border-primary/30 transition-colors cursor-pointer" onClick={() => abrirConversa(c)}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${ativa ? "bg-success/15" : "bg-muted"}`}>
                      <MessageCircle className={`h-5 w-5 ${ativa ? "text-success" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{formatPhone(c.session_id)}</p>
                        <Badge variant="outline" className="text-xs">{c.total} msg</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate mt-0.5">{c.ultima_mensagem.slice(0, 80)}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.session_id}</span>
                        <span>{relativeTime(c.ultima_atividade)}</span>
                      </div>
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
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => selecionada && copiarTelefone(selecionada.session_id)}><Copy className="h-4 w-4 mr-1" /> Copiar telefone</Button>
              <Button size="sm" asChild className="bg-whatsapp hover:bg-whatsapp/90 text-white">
                <a href={`https://wa.me/${selecionada?.session_id?.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Abrir no WhatsApp</a>
              </Button>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto mt-4 space-y-3 pr-2">
            {selecionada?.mensagens.map((m, idx) => {
              const isHuman = m.message?.type === "human";
              return (
                <div key={m.id ?? idx} className={`flex ${isHuman ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 ${isHuman ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    {!isHuman && <div className="flex items-center gap-1 text-xs opacity-70 mb-1"><Bot className="h-3 w-3" /> Agente</div>}
                    {isHuman && <div className="flex items-center gap-1 text-xs opacity-70 mb-1 justify-end"><User className="h-3 w-3" /> Lead</div>}
                    <p className="text-sm whitespace-pre-wrap break-words">{m.message?.content ?? ""}</p>
                    <p className="text-[10px] opacity-60 mt-1 text-right">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </CRMLayout>
  );
}

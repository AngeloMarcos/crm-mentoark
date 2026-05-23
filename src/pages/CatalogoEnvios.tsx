import { useState, useEffect, useMemo } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Clock, CheckCircle, AlertCircle, Phone, Package, LayoutGrid, Calendar,
  Search, RefreshCw, Send,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getAuthToken } from "@/lib/api-token";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";
const PAGE_SIZE = 25;

interface Log {
  id: string;
  tipo: "PRODUTO" | "CATALOGO" | string;
  telefone: string;
  status: "ENVIADO" | "ERRO" | string;
  mensagem_texto: string;
  produto_nome?: string;
  catalogo_nome?: string;
  produto_id?: string;
  catalogo_id?: string;
  erro_mensagem?: string;
  created_at: string;
}

export default function CatalogoEnviosPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [reenviando, setReenviando] = useState<string | null>(null);
  const navigate = useNavigate();

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<"TODOS" | "ENVIADO" | "ERRO">("TODOS");
  const [filtroTipo, setFiltroTipo] = useState<"TODOS" | "PRODUTO" | "CATALOGO">("TODOS");
  const [filtroPeriodo, setFiltroPeriodo] = useState<"7" | "30" | "90" | "TODOS">("30");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);

  const carregar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/catalogo/history?limit=500`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (r.ok) setLogs(await r.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);
  useEffect(() => { setPagina(1); }, [filtroStatus, filtroTipo, filtroPeriodo, busca]);

  const reenviar = async (log: Log) => {
    setReenviando(log.id);
    try {
      const r = await fetch(`${API_BASE}/api/catalogo/resend/${log.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Reenvio enfileirado");
      carregar();
    } catch (e: any) {
      toast.error(`Falha ao reenviar: ${e?.message ?? "erro"}`);
    } finally {
      setReenviando(null);
    }
  };

  const filtrados = useMemo(() => {
    const cutoff = filtroPeriodo === "TODOS" ? 0 : Date.now() - Number(filtroPeriodo) * 24 * 60 * 60 * 1000;
    const q = busca.trim().toLowerCase();
    return logs.filter((l) => {
      if (filtroStatus !== "TODOS" && l.status !== filtroStatus) return false;
      if (filtroTipo !== "TODOS" && l.tipo !== filtroTipo) return false;
      if (cutoff && new Date(l.created_at).getTime() < cutoff) return false;
      if (q) {
        const hay = `${l.telefone} ${l.produto_nome ?? ""} ${l.catalogo_nome ?? ""} ${l.mensagem_texto ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, filtroStatus, filtroTipo, filtroPeriodo, busca]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);

  const totais = useMemo(() => ({
    total: filtrados.length,
    enviados: filtrados.filter((l) => l.status === "ENVIADO").length,
    erros: filtrados.filter((l) => l.status === "ERRO").length,
  }), [filtrados]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/catalogo")}>
              <ArrowLeft />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Histórico de Envios</h1>
              <p className="text-sm text-muted-foreground">Log detalhado de produtos e catálogos enviados via WhatsApp</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={carregar} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>

        {/* Totais */}
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total filtrado</p>
            <p className="text-2xl font-bold">{totais.total}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Enviados</p>
            <p className="text-2xl font-bold text-green-500">{totais.enviados}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Erros</p>
            <p className="text-2xl font-bold text-red-500">{totais.erros}</p>
          </CardContent></Card>
        </div>

        {/* Filtros */}
        <Card><CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por telefone, produto, catálogo..."
              value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Select value={filtroStatus} onValueChange={(v: any) => setFiltroStatus(v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos status</SelectItem>
              <SelectItem value="ENVIADO">Enviados</SelectItem>
              <SelectItem value="ERRO">Com erro</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroTipo} onValueChange={(v: any) => setFiltroTipo(v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos tipos</SelectItem>
              <SelectItem value="PRODUTO">Produto</SelectItem>
              <SelectItem value="CATALOGO">Catálogo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroPeriodo} onValueChange={(v: any) => setFiltroPeriodo(v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="TODOS">Todo período</SelectItem>
            </SelectContent>
          </Select>
        </CardContent></Card>

        {loading ? (
          <div className="flex justify-center py-20">
            <Clock className="animate-spin h-8 w-8 text-primary" />
          </div>
        ) : visiveis.length === 0 ? (
          <Card className="py-20 text-center">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {logs.length === 0 ? "Nenhum envio registrado ainda" : "Nenhum envio encontrado com esses filtros"}
            </p>
          </Card>
        ) : (
          <>
            <div className="space-y-4">
              {visiveis.map((log) => (
                <Card key={log.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      <div className={`w-2 ${log.status === 'ENVIADO' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <div className="flex-1 p-4 grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {log.tipo === 'PRODUTO' ? <Package className="h-4 w-4 text-primary" /> : <LayoutGrid className="h-4 w-4 text-primary" />}
                            <span className="font-semibold">{log.tipo}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {log.produto_nome || log.catalogo_nome || "Item removido"}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{log.telefone}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(log.created_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                          </div>
                        </div>

                        <Badge variant={log.status === 'ENVIADO' ? 'default' : 'destructive'} className="gap-1 w-fit">
                          {log.status === 'ENVIADO' ? <CheckCircle className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                          {log.status}
                        </Badge>

                        <div className="text-sm text-muted-foreground line-clamp-2 italic md:col-span-1">
                          {log.status === 'ERRO' ? (
                            <span className="text-red-400">Erro: {log.erro_mensagem}</span>
                          ) : (
                            log.mensagem_texto
                          )}
                        </div>

                        <div className="flex justify-end">
                          {log.status === 'ERRO' && (
                            <Button
                              size="sm" variant="outline" className="gap-2"
                              disabled={reenviando === log.id}
                              onClick={() => reenviar(log)}
                            >
                              <Send className="h-3 w-3" />
                              {reenviando === log.id ? "Reenviando..." : "Reenviar"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  Página {paginaAtual} de {totalPaginas} · {filtrados.length} registros
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={paginaAtual === 1}
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}>Anterior</Button>
                  <Button size="sm" variant="outline" disabled={paginaAtual === totalPaginas}
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>Próxima</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </CRMLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Loader2, Phone, User, Calendar, Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/integrations/database/client";
import { useToast } from "@/hooks/use-toast";

interface DadoCliente {
  id: number;
  nomewpp: string | null;
  telefone: string | null;
  Setor: string | null;
  atendimento_ia: boolean | null;
  created_at: string;
}

function setorBadgeClass(setor: string | null) {
  const s = (setor || "").trim().toUpperCase();
  if (s === "VENDAS") return "bg-success/15 text-success border-success/30";
  if (s === "SUPORTE") return "bg-warning/15 text-warning border-warning/30";
  return "bg-muted text-muted-foreground border-border";
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function ContatosPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<DadoCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [setorFilter, setSetorFilter] = useState("TODOS");
  const [iaFilter, setIaFilter] = useState("TODOS");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    const fetchContatos = async () => {
      setLoading(true);
      const { data, error } = await api
        .from("dados_cliente")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      } else {
        setData((data || []) as DadoCliente[]);
      }
      setLoading(false);
    };

    fetchContatos();

    // Inscrição Realtime
    const channel = api
      .channel("public:dados_cliente")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dados_cliente" },
        (payload) => {
          const updatedRecord = payload.new as DadoCliente;
          setData((prev) =>
            prev.map((item) => (item.id === updatedRecord.id ? updatedRecord : item))
          );
        }
      )
      .subscribe();

    return () => {
      api.removeChannel(channel);
    };
  }, [toast]);

  const filtered = useMemo(() => {
    let result = data;

    // Busca por texto
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(d =>
        (d.nomewpp || "").toLowerCase().includes(q) ||
        (d.telefone || "").toLowerCase().includes(q)
      );
    }

    // Filtro por setor
    if (setorFilter !== "TODOS") {
      result = result.filter(d => (d.Setor || "").trim().toUpperCase() === setorFilter);
    }

    // Filtro por IA
    if (iaFilter !== "TODOS") {
      const active = iaFilter === "ATIVA";
      result = result.filter(d => d.atendimento_ia === active);
    }

    return result;
  }, [data, query, setorFilter, iaFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [query, setorFilter, iaFilter]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contatos</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Carregando..." : `${filtered.length} contato${filtered.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex gap-2 w-full md:w-auto">
            <Select value={setorFilter} onValueChange={setSetorFilter}>
              <SelectTrigger className="w-full md:w-[160px]">
                <SelectValue placeholder="Setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos Setores</SelectItem>
                <SelectItem value="VENDAS">Vendas</SelectItem>
                <SelectItem value="SUPORTE">Suporte</SelectItem>
              </SelectContent>
            </Select>

            <Select value={iaFilter} onValueChange={setIaFilter}>
              <SelectTrigger className="w-full md:w-[160px]">
                <SelectValue placeholder="Status IA" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todas IAs</SelectItem>
                <SelectItem value="ATIVA">Ativa</SelectItem>
                <SelectItem value="PAUSE">Pausada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              Nenhum contato encontrado.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginatedData.map((c) => {
                const iaAtiva = c.atendimento_ia === true;
                return (
                  <Card 
                    key={c.id} 
                    className="card-gradient-border hover:shadow-lg transition-shadow cursor-pointer"
                    onClick={() => navigate(`/contatos/${c.id}`)}
                  >
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg gradient-brand-subtle flex items-center justify-center shrink-0">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold truncate">{c.nomewpp || "Sem nome"}</h3>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Phone className="h-3 w-3" />
                            <span className="truncate">{c.telefone || "—"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className={setorBadgeClass(c.Setor)}>
                          {c.Setor?.trim() || "Sem setor"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            iaAtiva
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-destructive/15 text-destructive border-destructive/30"
                          }
                        >
                          <Bot className="h-3 w-3 mr-1" />
                          IA {iaAtiva ? "ativa" : "pause"}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t border-border/50">
                        <Calendar className="h-3 w-3" />
                        <span>{formatDate(c.created_at)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border/50">
                <p className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Próximo
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </CRMLayout>
  );
}

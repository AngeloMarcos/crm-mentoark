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
import { Search, Loader2, Phone, User, Calendar, Bot, ChevronLeft, ChevronRight, Check, Trash2, Clock, ExternalLink } from "lucide-react";
import { api } from "@/integrations/database/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

interface DadoCliente {
  id: string; // Changed to string to match table definitions
  nomewpp: string | null;
  telefone: string | null;
  Setor: string | null;
  atendimento_ia: string | null;
  created_at: string;
}

type IaStatus = "ativa" | "pausada" | null;
function getIaStatus(v: boolean | string | null | undefined): IaStatus {
  if (v === null || v === undefined || v === "") return null;
  if (v === true) return "ativa";
  if (v === false) return "pausada";
  const s = String(v).toLowerCase().trim();
  if (s === "ativo" || s === "ativa" || s === "reativada" || s === "true") return "ativa";
  if (s === "pause" || s === "pausada" || s === "pausado" || s === "false") return "pausada";
  return null;
}

interface FollowUp {
  id: string;
  contato_id: string;
  data_retorno: string;
  motivo: string;
  observacao: string;
  status: 'pendente' | 'concluido' | 'atrasado';
  contatos: {
    nomewpp: string;
    telefone: string;
  };
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
  const queryClient = useQueryClient();
  const { user } = useAuth();
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
        .from("contatos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      } else {
        setData((data || []) as unknown as DadoCliente[]);
      }
      setLoading(false);
    };

    fetchContatos();
  }, [toast]);

  const { data: followUps = [], isLoading: loadingFollowUps } = useQuery({
    queryKey: ["follow-ups-list"],
    queryFn: async () => {
      const { data, error } = await api
        .from("follow_ups")
        .select("*, contatos:contato_id(nomewpp, telefone)")
        .order("data_retorno", { ascending: true });
      if (error) throw error;
      return data as unknown as FollowUp[];
    },
    enabled: !!user?.id
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await api
        .from("follow_ups")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups-list"] });
      toast({ title: "Status atualizado!" });
    }
  });

  const deleteFollowUpMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api
        .from("follow_ups")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups-list"] });
      toast({ title: "Follow-up removido!" });
    }
  });

  const getFollowUpStatus = (date: string, status: string) => {
    if (status === 'concluido') return 'concluido';
    if (new Date(date) < new Date()) return 'atrasado';
    return 'pendente';
  };

  const statusBadge = (date: string, status: string) => {
    const s = getFollowUpStatus(date, status);
    if (s === 'concluido') return <Badge className="bg-success text-success-foreground">Concluído</Badge>;
    if (s === 'atrasado') return <Badge variant="destructive">Atrasado</Badge>;
    return <Badge className="bg-yellow-500 text-white">Pendente</Badge>;
  };

  const filtered = useMemo(() => {
    let result = data;
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(d =>
        (d.nomewpp || "").toLowerCase().includes(q) ||
        (d.telefone || "").toLowerCase().includes(q)
      );
    }
    if (setorFilter !== "TODOS") {
      result = result.filter(d => (d.Setor || "").trim().toUpperCase() === setorFilter);
    }
    if (iaFilter !== "TODOS") {
      const wanted = iaFilter === "ATIVA" ? "ativa" : "pausada";
      result = result.filter(d => getIaStatus(d.atendimento_ia) === wanted);
    }
    return result;
  }, [data, query, setorFilter, iaFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, setorFilter, iaFilter]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestão de Contatos</h1>
          <p className="text-sm text-muted-foreground">
            Visualize e gerencie seus contatos e follow-ups agendados.
          </p>
        </div>

        <Tabs defaultValue="lista" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="lista">Lista de Contatos</TabsTrigger>
            <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          </TabsList>

          <TabsContent value="lista" className="space-y-6 pt-4">

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
                const iaStatus = getIaStatus(c.atendimento_ia);
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
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold truncate">{c.nomewpp || "Sem nome"}</h3>
                            {iaStatus === "ativa" && (
                              <span
                                title="IA Ativa"
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-success bg-success/10 border border-success/20 rounded-full px-1.5 py-0.5 shrink-0"
                              >
                                🤖
                              </span>
                            )}
                            {iaStatus === "pausada" && (
                              <span
                                title="IA Pausada"
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 border border-warning/20 rounded-full px-1.5 py-0.5 shrink-0"
                              >
                                ⏸️
                              </span>
                            )}
                          </div>
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
          </TabsContent>

          <TabsContent value="followups" className="pt-4">
            {loadingFollowUps ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : followUps.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  Nenhum follow-up agendado.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {followUps.map((fu) => (
                  <Card key={fu.id} className="hover:shadow-md transition-all">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{fu.contatos?.nomewpp || "Contato"}</p>
                            <p className="text-xs text-muted-foreground">{fu.contatos?.telefone}</p>
                          </div>
                        </div>
                        {statusBadge(fu.data_retorno, fu.status)}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Badge variant="outline">{fu.motivo}</Badge>
                        </div>
                        <p className="text-xs font-medium mt-2">{formatDate(fu.data_retorno)}</p>
                        {fu.observacao && (
                          <p className="text-xs text-muted-foreground bg-muted p-2 rounded mt-2 italic">
                            "{fu.observacao}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        {fu.status === 'pendente' && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="flex-1 text-[10px] h-8"
                            onClick={() => updateStatusMutation.mutate({ id: fu.id, status: 'concluido' })}
                          >
                            <Check className="w-3 h-3 mr-1" /> Concluir
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8"
                          onClick={() => navigate(`/contatos/${fu.contato_id}`)}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 text-destructive"
                          onClick={() => deleteFollowUpMutation.mutate(fu.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}

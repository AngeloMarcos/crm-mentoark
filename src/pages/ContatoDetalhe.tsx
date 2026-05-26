import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CRMLayout } from "@/components/CRMLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  ArrowLeft, 
  Phone, 
  User, 
  Calendar, 
  Bot, 
  Play, 
  Pause,
  MessageSquare,
  Clock,
} from "lucide-react";
import { FollowUpModal } from "@/components/FollowUpModal";
import { api } from "@/integrations/database/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { authHeader } from "@/lib/api-token";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";





interface DadoCliente {
  id: number;
  nomewpp: string | null;
  telefone: string | null;
  Setor: string | null;
  atendimento_ia: string | null;
  created_at: string;
}

interface Message {
  id: number;
  user_message: string | null;
  bot_message: string | null;
  created_at: string;
  phone: string;
}

function setorBadgeClass(setor: string | null) {
  const s = (setor || "").trim().toUpperCase();
  if (s === "VENDAS") return "bg-success/15 text-success border-success/30";
  if (s === "SUPORTE") return "bg-warning/15 text-warning border-warning/30";
  return "bg-muted text-muted-foreground border-border";
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function ContatoDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [contato, setContato] = useState<DadoCliente | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingIa, setUpdatingIa] = useState(false);
  const [isFollowUpModalOpen, setIsFollowUpModalOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        // Busca dados do contato
        const { data: contactData, error: contactError } = await api
          .from("dados_cliente")
          .select("*")
          .eq("id", id)
          .single();

        if (contactError) throw contactError;
        setContato(contactData);

        // Busca histórico de mensagens se tiver telefone
        if (contactData?.telefone) {
          const { data: msgData, error: msgError } = await api
            .from("chat_messages")
            .select("*")
            .eq("phone", contactData.telefone)
            .order("created_at", { ascending: true });

          if (msgError) throw msgError;
          setMessages((msgData || []) as Message[]);
        }
      } catch (error: any) {
        toast({ 
          title: "Erro ao carregar dados", 
          description: error.message, 
          variant: "destructive" 
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Inscrição Realtime para mudanças no contato atual
    const channel = api
      .channel(`public:dados_cliente:id=eq.${id}`)
      .on(
        "postgres_changes",
        { 
          event: "UPDATE", 
          schema: "public", 
          table: "dados_cliente",
          filter: `id=eq.${id}`
        },
        (payload) => {
          setContato(payload.new as DadoCliente);
        }
      )
      .subscribe();

    return () => {
      api.removeChannel(channel);
    };
  }, [id, toast]);

  const toggleIA = async (active: boolean) => {
    if (!contato) return;
    setUpdatingIa(true);
    try {
      const res = await fetch(`${API_BASE}/api/contatos/${contato.id}/pausa-ia`, {
        method: "PATCH",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ acao: active ? "reativar" : "pausar", duracaoMinutos: 30 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setContato({ ...contato, atendimento_ia: data.atendimento_ia });
      toast({
        title: active ? "IA Reativada" : "IA Pausada",
        description: `O atendimento automático foi ${active ? "reativado" : "pausado"} para este contato.`
      });
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar IA",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setUpdatingIa(false);
    }
  };

  if (loading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </CRMLayout>
    );
  }

  if (!contato) {
    return (
      <CRMLayout>
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold">Contato não encontrado</h2>
          <Button variant="link" onClick={() => navigate("/contatos")} className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar para lista
          </Button>
        </div>
      </CRMLayout>
    );
  }

  const iaAtiva = contato.atendimento_ia === 'ativo' || contato.atendimento_ia === 'reativada';

  return (
    <CRMLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/contatos")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex gap-2 items-center">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setIsFollowUpModalOpen(true)}
              className="gap-2 border-yellow-500/50 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950/20"
            >
              <Clock className="h-4 w-4" />
              Follow-up
            </Button>
            {iaAtiva ? (
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => toggleIA(false)} 
                disabled={updatingIa}
                className="gap-2"
              >
                {updatingIa ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                Pausar IA
              </Button>
            ) : (
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => toggleIA(true)} 
                disabled={updatingIa}
                className="gap-2 bg-success hover:bg-success/90"
              >
                {updatingIa ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Reativar IA
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna Dados do Contato */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="card-gradient-border">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Dados do Contato
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground uppercase font-semibold">Nome</label>
                  <p className="font-medium text-lg">{contato.nomewpp || "Sem nome"}</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground uppercase font-semibold block">Telefone</label>
                    <div className="flex items-center gap-2 mt-1">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{contato.telefone || "—"}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground uppercase font-semibold block">Setor</label>
                    <Badge variant="outline" className={cn("mt-1", setorBadgeClass(contato.Setor))}>
                      {contato.Setor?.trim() || "Sem setor"}
                    </Badge>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground uppercase font-semibold block">Status IA</label>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "mt-1",
                        iaAtiva 
                          ? "bg-success/15 text-success border-success/30" 
                          : "bg-destructive/15 text-destructive border-destructive/30"
                      )}
                    >
                      <Bot className="h-3 w-3 mr-1" />
                      {iaAtiva ? "Ativa" : "Pausada"}
                    </Badge>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/50">
                  <label className="text-xs text-muted-foreground uppercase font-semibold block">Cadastro</label>
                  <div className="flex items-center gap-2 mt-1 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{formatDate(contato.created_at)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <ControleIA contatoId={contato.id} />
          </div>

          {/* Coluna Histórico de Mensagens */}
          <div className="lg:col-span-2">
            <Card className="card-gradient-border h-full flex flex-col">
              <CardHeader className="border-b border-border/50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  Histórico de Mensagens
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-4 space-y-4 max-h-[600px] min-h-[400px] scrollbar-thin">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-20">
                    <MessageSquare className="h-12 w-12 opacity-20 mb-2" />
                    <p>Nenhuma mensagem trocada ainda.</p>
                  </div>
                ) : (
                  messages.flatMap((msg) => {
                    const items = [];
                    if (msg.user_message) {
                      items.push({ id: `u-${msg.id}`, content: msg.user_message, isBot: false, created_at: msg.created_at });
                    }
                    if (msg.bot_message) {
                      items.push({ id: `b-${msg.id}`, content: msg.bot_message, isBot: true, created_at: msg.created_at });
                    }
                    return items;
                  }).map((item) => {
                    return (
                      <div 
                        key={item.id} 
                        className={cn(
                          "flex flex-col max-w-[80%]",
                          item.isBot ? "self-end items-end" : "self-start items-start"
                        )}
                      >
                        <div 
                          className={cn(
                            "rounded-2xl px-4 py-2 text-sm shadow-sm",
                            item.isBot 
                              ? "bg-primary text-primary-foreground rounded-tr-none" 
                              : "bg-muted text-foreground rounded-tl-none border border-border/50"
                          )}
                        >
                          <p className="whitespace-pre-wrap">{item.content}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-1 px-1">
                          {formatDate(item.created_at)}
                        </span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <FollowUpModal 
          isOpen={isFollowUpModalOpen}
          onClose={() => setIsFollowUpModalOpen(false)}
          contatoId={contato.id.toString()}
          contatoNome={contato.nomewpp || "Contato"}
        />
      </div>
    </CRMLayout>
  );
}

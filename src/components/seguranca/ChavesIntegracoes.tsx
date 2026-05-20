import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Key, Plug, Bot, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { api } from "@/integrations/database/client";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";
const token = () => localStorage.getItem("access_token") || "";

interface ChaveStatus {
  chave: string;
  configurado: boolean;
}

interface EvolutionInstance {
  instancia: string;
  url: string;
  status: string;
  email_dono: string;
}

export function ChavesIntegracoes() {
  const [chaves, setChaves] = useState<ChaveStatus[]>([]);
  const [loadingChaves, setLoadingChaves] = useState(true);
  const [instancias, setInstancias] = useState<EvolutionInstance[]>([]);
  const [loadingInstancias, setLoadingInstancias] = useState(true);

  useEffect(() => {
    // Carregar status das chaves
    fetch(`${API_BASE}/api/seguranca/status-chaves`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setChaves(data);
        setLoadingChaves(false);
      })
      .catch(() => setLoadingChaves(false));

    // Carregar instâncias Evolution
    const loadInstancias = async () => {
      const { data: configs } = await api
        .from("integracoes_config")
        .select("instancia, url, status, user_id")
        .eq("tipo", "evolution");
      
      if (configs && configs.length > 0) {
        const { data: profiles } = await api
          .from("profiles")
          .select("user_id, email")
          .in("user_id", configs.map(c => c.user_id));
        
        const emailMap = new Map();
        profiles?.forEach(p => emailMap.set(p.user_id, p.email));

        setInstancias(configs.map(c => ({
          instancia: c.instancia || "default",
          url: c.url,
          status: c.status,
          email_dono: emailMap.get(c.user_id) || "Desconhecido"
        })));
      }
      setLoadingInstancias(false);
    };

    loadInstancias();
  }, []);

  const tools = [
    { nome: "buscar_contatos", desc: "Busca contatos por nome/tel/email" },
    { nome: "obter_historico_conversa", desc: "Lê chat history (n8n_chat_histories)" },
    { nome: "criar_contato", desc: "Cria contato novo no funil" },
    { nome: "atualizar_status_contato", desc: "Move contato entre etapas do funil" },
    { nome: "enviar_mensagem_whatsapp", desc: "API Evolution de envio de texto" },
    { nome: "listar_agentes", desc: "Consulta agentes do usuário" },
    { nome: "buscar_conhecimento", desc: "RAG simples na base do usuário" },
    { nome: "resumo_dashboard", desc: "Métricas globais para a Cris" },
    { nome: "buscar_midia", desc: "Localiza arquivos na galeria para envio" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chaves de API */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-500" />
              Chaves de API do Sistema (.env)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingChaves ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableBody>
                  {chaves.map((c) => (
                    <TableRow key={c.chave} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="text-xs font-mono text-white/80">{c.chave}</TableCell>
                      <TableCell className="text-right">
                        {c.configurado ? (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-normal gap-1.5">
                            <CheckCircle2 className="h-3 w-3" /> Configurado
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 font-normal gap-1.5">
                            <XCircle className="h-3 w-3" /> Ausente
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Instâncias Evolution */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Plug className="h-4 w-4 text-blue-500" />
              Instâncias Evolution Ativas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingInstancias ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : instancias.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground italic">
                Nenhuma instância configurada no sistema.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="text-[10px] text-muted-foreground">Instância</TableHead>
                    <TableHead className="text-[10px] text-muted-foreground">Dono</TableHead>
                    <TableHead className="text-[10px] text-muted-foreground text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instancias.map((inst, idx) => (
                    <TableRow key={idx} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="text-xs font-medium text-white/90 truncate max-w-[120px]" title={inst.url}>
                        {inst.instancia}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                        {inst.email_dono}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={`text-[10px] font-normal ${
                          inst.status === "ativo" || inst.status === "conectado" ? "text-emerald-400 border-emerald-500/30" : "text-yellow-400 border-yellow-500/30"
                        }`}>
                          {inst.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* MCP Tools */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-3 border-b border-white/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-500" />
            MCP — Model Context Protocol (Tools Disponíveis)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map((tool) => (
            <div key={tool.nome} className="p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
              <p className="text-xs font-mono font-bold text-purple-400">{tool.nome}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{tool.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

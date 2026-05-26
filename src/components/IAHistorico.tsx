import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, History, Pause, Play, RefreshCw, AlertCircle } from "lucide-react";
import { authHeader } from "@/lib/api-token";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "https://api.mentoark.com.br";

interface IALog {
  id: number;
  contato_id: number;
  acao: "pausar" | "reativar" | "expirar";
  origem: string;
  duracao_minutos: number | null;
  usuario_nome: string | null;
  created_at: string;
}

interface IAHistoricoProps {
  contatoId: number;
  telefone: string;
}

export function IAHistorico({ contatoId, telefone }: IAHistoricoProps) {
  const [logs, setLogs] = useState<IALog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(10);
  const [pausaResumo, setPausaResumo] = useState<{
    atendimento_ia?: string;
    pausa_timestamp?: string;
    pausa_duracao_min?: number;
  } | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`${API_BASE}/api/ia-pausa-log/${contatoId}`, {
        headers: authHeader(),
      });

      if (response.ok) {
        const data = await response.json();
        setLogs(Array.isArray(data) ? data : []);
      } else if (response.status === 404) {
        // Se o endpoint não existir, tenta pegar dados básicos do cliente
        const resDados = await fetch(`${API_BASE}/api/dados_cliente/${contatoId}`, {
          headers: authHeader(),
        });
        if (resDados.ok) {
          const dados = await resDados.json();
          setPausaResumo({
            atendimento_ia: dados.atendimento_ia,
            pausa_timestamp: dados.pausa_timestamp,
            pausa_duracao_min: dados.pausa_duracao_min,
          });
        }
      } else {
        setError(true);
      }
    } catch (err) {
      console.error("Erro ao carregar histórico de IA:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [contatoId]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const getLogIcon = (acao: string) => {
    switch (acao) {
      case "pausar":
        return <Pause className="h-3 w-3 text-orange-600" />;
      case "reativar":
        return <Play className="h-3 w-3 text-green-600" />;
      case "expirar":
        return <RefreshCw className="h-3 w-3 text-blue-600" />;
      default:
        return <History className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getLogText = (log: IALog) => {
    const time = formatDate(log.created_at);
    const user = log.usuario_nome || "Sistema";

    if (log.acao === "pausar") {
      const duration = log.duracao_minutos ? `${log.duracao_minutos} min` : "tempo indeterminado";
      return `⏸️ [${time}] — IA pausada por ${duration} por ${user}`;
    }
    if (log.acao === "reativar") {
      return `▶️ [${time}] — IA reativada manualmente por ${user}`;
    }
    if (log.acao === "expirar") {
      return `🔄 [${time}] — IA reativada automaticamente (pausa expirou)`;
    }
    return `[${time}] — Evento desconhecido: ${log.acao}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Fallback se não houver logs mas houver resumo (endpoint não existe)
  if (logs.length === 0 && pausaResumo) {
    return (
      <Card className="border-dashed">
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            Resumo de IA
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 space-y-2">
          <div className="text-xs text-muted-foreground">
            <p><strong>Status:</strong> {pausaResumo.atendimento_ia === 'pause' ? 'Pausada' : 'Ativa'}</p>
            {pausaResumo.pausa_timestamp && (
              <p><strong>Última pausa:</strong> {formatDate(pausaResumo.pausa_timestamp)}</p>
            )}
            {pausaResumo.pausa_duracao_min && (
              <p><strong>Duração:</strong> {pausaResumo.pausa_duracao_min} min</p>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground italic mt-2">
            Histórico detalhado indisponível no servidor.
          </p>
        </CardContent>
      </Card>
    );
  }

  const visibleLogs = logs.slice(0, limit);

  return (
    <Card className="border-muted shadow-sm overflow-hidden">
      <CardHeader className="py-4 bg-muted/30 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Histórico de IA
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] font-bold h-5">
            {logs.length} {logs.length === 1 ? 'pausa' : 'pausas'} realizada{logs.length !== 1 && 's'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-6">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <AlertCircle className="h-8 w-8 opacity-20 mb-2" />
            <p className="text-xs">Nenhuma pausa registrada para este contato.</p>
          </div>
        ) : (
          <div className="relative space-y-6">
            {/* Linha vertical */}
            <div className="absolute left-2 top-2 bottom-2 w-px bg-border ml-[3.5px]" />

            <div className="space-y-4">
              {visibleLogs.map((log) => (
                <div key={log.id} className="relative pl-8 group">
                  {/* Ponto na timeline */}
                  <div 
                    className={cn(
                      "absolute left-0 top-1 p-1 rounded-full border bg-background z-10",
                      log.acao === "pausar" ? "border-orange-200" : 
                      log.acao === "reativar" ? "border-green-200" : "border-blue-200"
                    )}
                  >
                    {getLogIcon(log.acao)}
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground transition-colors">
                      {getLogText(log)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {limit < logs.length && (
              <div className="pt-2 text-center">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs h-7 text-primary hover:bg-primary/5"
                  onClick={() => setLimit(prev => prev + 10)}
                >
                  Ver mais eventos
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authHeader } from "@/lib/api-token";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Smartphone, Bot, Network } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

type Agente = {
  id: number | string;
  nome: string;
  evolution_instancia?: string | null;
  n8n_webhook_url?: string | null;
};

type TesteResultado = {
  state: "open" | "close" | "error" | "unauthorized";
  phoneNumber?: string;
  error?: string;
  testadoEm?: string;
};

function tempoRelativo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "agora mesmo";
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  return `há ${Math.floor(diff / 3600)}h`;
}

export function TesteInstancias() {
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(true);
  const [resultados, setResultados] = useState<Record<string, TesteResultado>>({});
  const [testandoId, setTestandoId] = useState<string | null>(null);
  const [testandoTodos, setTestandoTodos] = useState(false);
  const [ultimoTeste, setUltimoTeste] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 15000);
    return () => clearInterval(i);
  }, []);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/agentes`, { headers: authHeader() });
      const data = await res.json().catch(() => []);
      const lista: Agente[] = Array.isArray(data) ? data : data?.data || [];
      setAgentes(lista.filter((a) => a.evolution_instancia && String(a.evolution_instancia).trim() !== ""));
    } catch {
      setAgentes([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregar();
  }, []);

  const testar = async (agente: Agente) => {
    const key = String(agente.id);
    setTestandoId(key);
    try {
      const res = await fetch(`${API_URL}/api/whatsapp/status`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ instancia: agente.evolution_instancia }),
      });
      const body = await res.json().catch(() => ({}));
      const state = body?.state === "open" ? "open" : body?.state === "unauthorized" ? "unauthorized" : "close";
      setResultados((r) => ({
        ...r,
        [key]: { state, phoneNumber: body?.phoneNumber, testadoEm: new Date().toISOString() },
      }));
    } catch (e) {
      setResultados((r) => ({
        ...r,
        [key]: { state: "error", error: String(e), testadoEm: new Date().toISOString() },
      }));
    }
    setUltimoTeste(new Date().toISOString());
    setTestandoId(null);
  };

  const testarTodos = async () => {
    setTestandoTodos(true);
    for (const a of agentes) {
      await testar(a);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setTestandoTodos(false);
  };

  const total = agentes.length;
  const conectadas = Object.values(resultados).filter((r) => r.state === "open").length;
  const desconectadas = Object.values(resultados).filter((r) => r.state === "close" || r.state === "error" || r.state === "unauthorized").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Instâncias encontradas</p>
              <p className="text-2xl font-bold">{total}</p>
            </div>
            <Smartphone className="h-8 w-8 text-blue-600" />
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Conectadas</p>
              <p className="text-2xl font-bold text-green-700">{conectadas}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Desconectadas</p>
              <p className="text-2xl font-bold text-red-700">{desconectadas}</p>
            </div>
            <XCircle className="h-8 w-8 text-red-600" />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          Último teste: {ultimoTeste ? tempoRelativo(ultimoTeste) : "nunca"}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar agentes
          </Button>
          <Button size="sm" onClick={testarTodos} disabled={testandoTodos || agentes.length === 0}>
            {testandoTodos ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
            Testar todas
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : agentes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            Nenhum agente com instância Evolution configurada.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agentes.map((a) => {
            const key = String(a.id);
            const r = resultados[key];
            const isTesting = testandoId === key;
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{a.nome}</CardTitle>
                    {a.n8n_webhook_url ? (
                      <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                        <Network className="h-3 w-3 mr-1" /> n8n
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <Bot className="h-3 w-3 mr-1" /> IA interna
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{a.evolution_instancia}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="min-h-[40px]">
                    {!r && <p className="text-xs text-muted-foreground">Não testado ainda.</p>}
                    {r?.state === "open" && (
                      <div className="text-sm text-green-700 flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Conectado{r.phoneNumber ? ` — ${r.phoneNumber}` : ""}</span>
                      </div>
                    )}
                    {r?.state === "unauthorized" && (
                      <div className="text-sm text-orange-700 flex items-center gap-1 font-bold animate-pulse">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Sessão expirada — Reconecte</span>
                      </div>
                    )}
                    {r?.state === "close" && (
                      <div className="text-sm text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Desconectado — estado: close</span>
                      </div>
                    )}
                    {r?.state === "error" && (
                      <div className="text-sm text-red-700 flex items-center gap-1">
                        <XCircle className="h-4 w-4" />
                        <span>Erro — {r.error}</span>
                      </div>
                    )}
                    {r?.testadoEm && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Testado {tempoRelativo(r.testadoEm)}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => testar(a)} disabled={isTesting || testandoTodos} className="w-full">
                    {isTesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Testar conexão
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

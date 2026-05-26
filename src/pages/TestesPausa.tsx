import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { authHeader } from "@/lib/api-token";
import { Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

type HistItem = {
  ts: string;
  acao: string;
  status: number;
  body: unknown;
};

type PollLog = { ts: string; segundosRestantes: number | null };

export default function TestesPausa() {
  const [contatoId, setContatoId] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [status, setStatus] = useState<unknown>(null);
  const [lastResponse, setLastResponse] = useState<{ ts: string; acao: string; status: number; body: unknown } | null>(null);
  const [historico, setHistorico] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [pollLog, setPollLog] = useState<PollLog[]>([]);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  if (!import.meta.env.DEV) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Página disponível apenas em desenvolvimento.</p>
      </div>
    );
  }

  const headers = () => ({ ...authHeader(), "Content-Type": "application/json" });
  const nowTs = () => new Date().toLocaleTimeString();

  const pushHist = (item: HistItem) => {
    setHistorico((h) => [item, ...h].slice(0, 5));
    setLastResponse(item);
  };

  const fetchStatus = async (id: string, silent = false) => {
    try {
      const res = await fetch(`${API_URL}/api/contatos/${id}/pausa-status`, { headers: headers() });
      const body = await res.json().catch(() => ({}));
      setStatus(body);
      if (!silent) {
        pushHist({ ts: nowTs(), acao: "GET pausa-status", status: res.status, body });
      }
      return body as { segundosRestantes?: number | null };
    } catch (e) {
      const body = { error: String(e) };
      setStatus(body);
      if (!silent) pushHist({ ts: nowTs(), acao: "GET pausa-status", status: 0, body });
      return null;
    }
  };

  const carregar = async () => {
    if (!contatoId) return;
    setLoading(true);
    setLoadedId(contatoId);
    await fetchStatus(contatoId);
    setLoading(false);
  };

  const acao = async (label: string, payload: Record<string, unknown>) => {
    if (!loadedId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/contatos/${loadedId}/pausa-ia`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      pushHist({ ts: nowTs(), acao: label, status: res.status, body });
      await fetchStatus(loadedId, true);
    } catch (e) {
      pushHist({ ts: nowTs(), acao: label, status: 0, body: { error: String(e) } });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (tickRef.current) window.clearInterval(tickRef.current);
    pollRef.current = null;
    tickRef.current = null;
    setCountdown(10);

    if (polling && loadedId) {
      tickRef.current = window.setInterval(() => {
        setCountdown((c) => (c <= 1 ? 10 : c - 1));
      }, 1000);
      pollRef.current = window.setInterval(async () => {
        const body = await fetchStatus(loadedId, true);
        const seg = (body as { segundosRestantes?: number | null } | null)?.segundosRestantes ?? null;
        setPollLog((l) => [{ ts: nowTs(), segundosRestantes: seg }, ...l].slice(0, 20));
      }, 10000);
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, loadedId]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Testes — Pausa de IA</h1>
          <p className="text-sm text-muted-foreground">
            Ferramenta de desenvolvimento para validar o fluxo de pausa/reativação.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contato</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="cid">ID do contato (dados_cliente.id)</Label>
              <Input
                id="cid"
                type="number"
                value={contatoId}
                onChange={(e) => setContatoId(e.target.value)}
                placeholder="ex: 123"
              />
            </div>
            <Button onClick={carregar} disabled={!contatoId || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Carregar"}
            </Button>
          </CardContent>
        </Card>

        {loadedId && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Status atual</CardTitle>
                <Badge variant="outline">ID {loadedId}</Badge>
              </CardHeader>
              <CardContent>
                <pre className="bg-slate-950 text-green-400 font-mono text-xs p-4 rounded overflow-auto max-h-64">
                  {JSON.stringify(status, null, 2)}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ações de teste</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={() => acao("PATCH pausar 15min", { acao: "pausar", duracaoMinutos: 15 })} disabled={loading}>
                  Pausar 15 min
                </Button>
                <Button onClick={() => acao("PATCH pausar 1min", { acao: "pausar", duracaoMinutos: 1 })} disabled={loading} variant="secondary">
                  Pausar 1 min
                </Button>
                <Button onClick={() => acao("PATCH reativar", { acao: "reativar" })} disabled={loading} variant="secondary">
                  Reativar
                </Button>
                <Button onClick={() => fetchStatus(loadedId)} disabled={loading} variant="outline">
                  Verificar status
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resultado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lastResponse && (
                  <div>
                    <div className="flex gap-2 items-center mb-1">
                      <Badge>{lastResponse.acao}</Badge>
                      <Badge variant={lastResponse.status >= 200 && lastResponse.status < 300 ? "default" : "destructive"}>
                        HTTP {lastResponse.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{lastResponse.ts}</span>
                    </div>
                    <pre className="bg-slate-950 text-green-400 font-mono text-xs p-4 rounded overflow-auto max-h-48">
                      {JSON.stringify(lastResponse.body, null, 2)}
                    </pre>
                  </div>
                )}
                <div>
                  <h4 className="text-sm font-medium mb-2">Histórico (últimas 5)</h4>
                  <div className="space-y-1">
                    {historico.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma chamada ainda.</p>}
                    {historico.map((h, i) => (
                      <div key={i} className="flex gap-2 items-center text-xs font-mono">
                        <span className="text-muted-foreground">{h.ts}</span>
                        <Badge variant="outline" className="text-xs">{h.acao}</Badge>
                        <Badge variant={h.status >= 200 && h.status < 300 ? "default" : "destructive"} className="text-xs">
                          {h.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Verificação automática</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="poll" checked={polling} onCheckedChange={(v) => setPolling(v === true)} />
                  <Label htmlFor="poll">Polling a cada 10s</Label>
                  {polling && (
                    <Badge variant="outline" className="ml-2">próximo em {countdown}s</Badge>
                  )}
                </div>
                <pre className="bg-slate-950 text-green-400 font-mono text-xs p-4 rounded overflow-auto max-h-64">
                  {pollLog.length === 0
                    ? "// aguardando..."
                    : pollLog.map((l) => `${l.ts} — segundosRestantes: ${l.segundosRestantes ?? "null"}`).join("\n")}
                </pre>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

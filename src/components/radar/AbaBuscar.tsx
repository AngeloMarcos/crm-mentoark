import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, Upload } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Busca, Nicho, StatusRadar, planilhaParaCsv } from "./tipos";

const COR_STATUS: Record<Busca["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600",
  concluida: "bg-emerald-500/15 text-emerald-600",
  falhou: "bg-red-500/15 text-red-600",
};
const ROTULO_STATUS: Record<Busca["status"], string> = { queued: "Na fila", running: "Buscando…", concluida: "Concluída", falhou: "Falhou" };
const MOTIVO_PARADA: Record<string, string> = {
  teto_chamadas: "parou no limite de consultas",
  teto_custo: "parou no teto de custo",
  erro_provider: "parou por erro do provedor",
};

export function AbaBuscar({ status }: { status?: StatusRadar }) {
  const qc = useQueryClient();
  const [nichoId, setNichoId] = useState("");
  const [termo, setTermo] = useState("");
  const [max, setMax] = useState(9);
  const [telegram, setTelegram] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const nichos = useQuery({
    queryKey: ["radar-nichos"],
    queryFn: async () => (await api.get("/api/radar/nichos")).data as Nicho[],
  });

  // Enquanto houver busca na fila/rodando, atualiza a cada 2s (feedback em tempo real).
  const buscas = useQuery({
    queryKey: ["radar-buscas"],
    queryFn: async () => (await api.get("/api/radar/buscas")).data as Busca[],
    refetchInterval: (q) => ((q.state.data as Busca[] | undefined)?.some(b => b.status === "queued" || b.status === "running") ? 2000 : false),
  });

  const buscar = useMutation({
    mutationFn: async () =>
      (await api.post("/api/radar/buscas", {
        nicho_id: nichoId, termo: termo.trim() || undefined, max_consultas: max,
        incluir_telegram: telegram, request_id: crypto.randomUUID(),
      })).data,
    onSuccess: () => {
      toast.success("Busca enviada para a fila");
      qc.invalidateQueries({ queryKey: ["radar-buscas"] });
      qc.invalidateQueries({ queryKey: ["radar-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível iniciar a busca"),
  });

  const importar = useMutation({
    mutationFn: async (f: File) => (await api.post("/api/radar/importar", { csv: await planilhaParaCsv(f) })).data,
    onSuccess: (r: any) => {
      toast.success(`${r.novos} grupos novos (${r.ja_existiam} já existiam, ${r.linhas_sem_link} linhas sem link)`);
      qc.invalidateQueries({ queryKey: ["radar-grupos"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao importar a planilha"),
  });

  const restante = status ? Math.max(0, status.limite_consultas_dia - status.consultas_hoje) : null;
  const semCota = restante === 0;

  return (
    <div className="space-y-6 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Nova busca de grupos</CardTitle>
          <CardDescription>
            Procura links de convite na internet pelo nicho escolhido. Depois, cada link novo é verificado sozinho: expirado é descartado e grupo que não condiz com o nicho é rejeitado. Não entra em nenhum grupo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status && !status.busca_real && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Busca real desligada: {status.aviso ?? "provedor simulado"}. As buscas não retornarão grupos.
            </div>
          )}
          {status?.raspagem?.ativa && (
            <p className="text-xs text-muted-foreground">
              Diretórios de grupos também são lidos (respeitando o robots.txt de cada site, até {status.raspagem.limite_dia} páginas por dia; hoje: {status.raspagem.paginas_hoje}).
              O uso depende dos termos de cada site — desligue com RADAR_RASPAR_DIRETORIOS=false.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nicho</Label>
              <Select value={nichoId} onValueChange={setNichoId}>
                <SelectTrigger><SelectValue placeholder={nichos.isLoading ? "Carregando…" : "Escolha um nicho"} /></SelectTrigger>
                <SelectContent>
                  {(nichos.data ?? []).filter(n => n.ativo).map(n => <SelectItem key={n.id} value={n.id}>{n.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Termo customizado <span className="text-muted-foreground font-normal">(opcional — substitui os termos do nicho)</span></Label>
              <Input value={termo} onChange={e => setTermo(e.target.value)} placeholder="Ex.: corretores de imóveis" maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label>Máximo de chamadas ao provedor</Label>
              <Input type="number" min={1} max={30} value={max} onChange={e => setMax(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              <p className="text-xs text-muted-foreground">Cada consulta usa até 3 páginas; cada página conta como 1 chamada.</p>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox id="tg" checked={telegram} onCheckedChange={v => setTelegram(v === true)} />
              <Label htmlFor="tg" className="font-normal">Incluir links do Telegram (só catalogar)</Label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => buscar.mutate()} disabled={!nichoId || buscar.isPending || semCota}>
              {buscar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Buscar agora
            </Button>
            <input ref={arquivo} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importar.mutate(f); e.target.value = ""; }} />
            <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={importar.isPending}>
              {importar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Importar planilha (CSV/Excel)
            </Button>
            {restante !== null && (
              <span className="text-sm text-muted-foreground">
                {semCota ? "Limite diário atingido." : `${restante} chamadas restantes hoje`}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Histórico de buscas</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead><TableHead>Nicho</TableHead><TableHead>Situação</TableHead>
                <TableHead className="text-right">Chamadas</TableHead><TableHead className="text-right">Links</TableHead>
                <TableHead className="text-right">Novos</TableHead><TableHead className="text-right">Custo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(buscas.data ?? []).map(b => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-nowrap">{new Date(b.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>{b.nicho_nome ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={COR_STATUS[b.status]} variant="secondary">
                      {(b.status === "running" || b.status === "queued") && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {ROTULO_STATUS[b.status]}
                    </Badge>
                    {b.interrompida_por && <div className="mt-1 text-xs text-muted-foreground">{MOTIVO_PARADA[b.interrompida_por] ?? b.interrompida_por}</div>}
                    {b.erro && <div className="mt-1 max-w-xs truncate text-xs text-red-600" title={b.erro}>{b.erro}</div>}
                  </TableCell>
                  <TableCell className="text-right">{b.consultas_feitas}</TableCell>
                  <TableCell className="text-right">{b.links_vistos}</TableCell>
                  <TableCell className="text-right font-medium">{b.novos}<span className="text-muted-foreground font-normal"> (+{b.existentes} já no catálogo)</span></TableCell>
                  <TableCell className="text-right">US$ {Number(b.custo_usd).toFixed(3)}</TableCell>
                </TableRow>
              ))}
              {!buscas.isLoading && !(buscas.data ?? []).length && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhuma busca ainda.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

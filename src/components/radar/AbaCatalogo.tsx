import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Eye, Loader2, RefreshCw, X } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Grupo, Nicho, StatusRadar, rotuloMotivo, statusLabel } from "./tipos";

const POR_PAGINA = 25;
const TODOS = "todos";

function BadgeScore({ score }: { score: number | null }) {
  if (score === null) return <Badge variant="outline" className="text-muted-foreground">Não avaliado</Badge>;
  const cor = score >= 70 ? "bg-emerald-500/15 text-emerald-600" : score >= 40 ? "bg-amber-500/15 text-amber-600" : "bg-red-500/15 text-red-600";
  return <Badge variant="secondary" className={`${cor} text-sm font-semibold`}>{score}</Badge>;
}

export function AbaCatalogo({ status }: { status?: StatusRadar }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [qAplicado, setQAplicado] = useState("");
  const [minScore, setMinScore] = useState("");
  const [st, setSt] = useState(TODOS);
  const [nicho, setNicho] = useState(TODOS);
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setQAplicado(q); setPagina(0); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const nichos = useQuery({
    queryKey: ["radar-nichos"],
    queryFn: async () => (await api.get("/api/radar/nichos")).data as Nicho[],
  });

  const params = new URLSearchParams({ order: "score", limit: String(POR_PAGINA), offset: String(pagina * POR_PAGINA) });
  if (qAplicado) params.set("q", qAplicado);
  if (minScore) params.set("min_score", minScore);
  if (st !== TODOS) params.set("status", st);
  if (nicho !== TODOS) params.set("nicho_id", nicho);

  const grupos = useQuery({
    queryKey: ["radar-grupos", params.toString()],
    queryFn: async () => (await api.get(`/api/radar/grupos?${params}`)).data as { total: number; itens: Grupo[] },
    // Enquanto houver leituras pendentes na fila, reatualiza para mostrar o resultado chegando.
    refetchInterval: (query) => ((query.state.data as any)?.itens?.some((g: Grupo) => g.status === "descoberto" && !g.validado_em) ? 15000 : false),
  });

  const decidir = useMutation({
    mutationFn: async (v: { id: string; status: string }) => api.patch(`/api/radar/grupos/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar-grupos"] }),
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível atualizar o grupo"),
  });

  const validar = useMutation({
    mutationFn: async (ids?: string[]) => (await api.post("/api/radar/grupos/validar", ids ? { ids } : { limite: 20 })).data,
    onSuccess: (r: any) => {
      toast.success(r.enfileirados ? `${r.enfileirados} convites na fila de leitura (1 a cada ~8s)` : "Nenhum grupo pendente de leitura");
      qc.invalidateQueries({ queryKey: ["radar-grupos"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível enfileirar a leitura"),
  });

  const total = grupos.data?.total ?? 0;
  const leituraOk = status?.leitura_convites.configurada ?? false;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-4 pt-4">
      {status && !leituraOk && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Leitura de convites desligada: nenhuma instância de leitura configurada no servidor. Sem ela os grupos ficam sem nome,
          participantes e score.
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <Input placeholder="Buscar no nome ou descrição…" value={q} onChange={e => setQ(e.target.value)} className="md:col-span-2" />
          <Input type="number" min={0} max={100} placeholder="Score mínimo" value={minScore}
            onChange={e => { setMinScore(e.target.value); setPagina(0); }} />
          <Select value={st} onValueChange={v => { setSt(v); setPagina(0); }}>
            <SelectTrigger><SelectValue placeholder="Situação" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as situações</SelectItem>
              {["descoberto", "aprovado", "rejeitado", "invalido"].map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={nicho} onValueChange={v => { setNicho(v); setPagina(0); }}>
            <SelectTrigger><SelectValue placeholder="Nicho" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os nichos</SelectItem>
              {(nichos.data ?? []).map(n => <SelectItem key={n.id} value={n.id}>{n.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{total} grupo(s) no catálogo</span>
        <Button variant="outline" size="sm" disabled={!leituraOk || validar.isPending} onClick={() => validar.mutate(undefined)}
          title={leituraOk ? "Lê nome, participantes e link ativo dos próximos 20 grupos pendentes (sem entrar)" : "Instância de leitura não configurada"}>
          {validar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Ler convites pendentes (20)
        </Button>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">Grupo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Particip.</TableHead>
                <TableHead className="min-w-[280px]">Score e motivos</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.isLoading && <TableRow><TableCell colSpan={6} className="text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>}
              {(grupos.data?.itens ?? []).map(g => (
                <TableRow key={g.id}>
                  <TableCell>
                    {g.nome
                      ? <div className="font-medium">{g.nome}</div>
                      : <div className="text-muted-foreground italic">Nome ainda não lido</div>}
                    {!g.nome && g.titulo_origem && <div className="max-w-xs truncate text-xs text-muted-foreground" title={g.titulo_origem}>Página: {g.titulo_origem}</div>}
                    {g.descricao && <div className="max-w-xs truncate text-xs text-muted-foreground" title={g.descricao}>{g.descricao}</div>}
                    {g.erro_validacao && g.status !== "invalido" && <div className="max-w-xs truncate text-xs text-red-600" title={g.erro_validacao}>{g.erro_validacao}</div>}
                    <a href={g.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      {g.codigo_convite.slice(0, 8)}… <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{g.nicho_nome ?? "Sem nicho"}</div>
                    <div className="text-xs text-muted-foreground">{g.fonte === "planilha" ? "Planilha" : g.plataforma === "telegram" ? "Busca · Telegram" : "Busca"}</div>
                  </TableCell>
                  <TableCell className="text-right">{g.participantes ?? "—"}</TableCell>
                  <TableCell>
                    <BadgeScore score={g.score} />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(g.score_motivos ?? []).map(m => (
                        <Badge key={m.regra} variant="outline" title={m.detalhe}
                          className={m.pontos < 0 ? "border-red-500/40 text-red-600" : m.pontos > 0 ? "border-emerald-500/40 text-emerald-600" : "text-muted-foreground"}>
                          {rotuloMotivo(m)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.status === "invalido" || g.status === "rejeitado" ? "destructive" : g.status === "aprovado" ? "default" : "secondary"}>
                      {statusLabel(g.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {g.plataforma === "whatsapp" && (
                      <Button size="icon" variant="ghost" title="Ler convite (sem entrar)" disabled={!leituraOk || validar.isPending}
                        onClick={() => validar.mutate([g.id])}><Eye className="h-4 w-4" /></Button>
                    )}
                    <Button size="icon" variant="ghost" title="Aprovar" disabled={g.status === "invalido" || g.status === "aprovado"}
                      onClick={() => decidir.mutate({ id: g.id, status: "aprovado" })}><Check className="h-4 w-4 text-emerald-600" /></Button>
                    <Button size="icon" variant="ghost" title="Rejeitar" disabled={g.status === "invalido" || g.status === "rejeitado"}
                      onClick={() => decidir.mutate({ id: g.id, status: "rejeitado" })}><X className="h-4 w-4 text-red-600" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!grupos.isLoading && !(grupos.data?.itens ?? []).length && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum grupo com esses filtros.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button>
        <span className="text-sm text-muted-foreground">Página {pagina + 1} de {paginas}</span>
        <Button variant="outline" size="sm" disabled={pagina + 1 >= paginas} onClick={() => setPagina(p => p + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Eye, Link2, Loader2, RefreshCw, X } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Grupo, Nicho, ROTULO_ADERENCIA, StatusRadar, rotuloDescarte, rotuloMotivo, statusLabel } from "./tipos";

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
  const [ader, setAder] = useState(TODOS);
  const [imp, setImp] = useState(TODOS);
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
  if (ader !== TODOS) params.set("aderencia", ader);
  if (imp !== TODOS) params.set("importado", imp);

  const grupos = useQuery({
    queryKey: ["radar-grupos", params.toString()],
    queryFn: async () => (await api.get(`/api/radar/grupos?${params}`)).data as { total: number; itens: Grupo[] },
    // Enquanto houver leituras pendentes na fila, reatualiza para mostrar o resultado chegando.
    refetchInterval: (query) => ((query.state.data as any)?.itens?.some((g: Grupo) => g.plataforma === "whatsapp" && g.status === "descoberto" && !g.link_verificado_em) ? 10000 : false),
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

  const verificar = useMutation({
    mutationFn: async (ids?: string[]) => (await api.post("/api/radar/grupos/verificar-links", ids ? { ids } : { limite: 50 })).data,
    onSuccess: (r: any) => {
      toast.success(r.enfileirados ? `${r.enfileirados} link(s) na fila de verificação (1 a cada ~6s)` : "Nenhum link pendente de verificação");
      if (r.aviso) toast.warning(r.aviso);
      qc.invalidateQueries({ queryKey: ["radar-grupos"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível enfileirar a verificação"),
  });

  const total = grupos.data?.total ?? 0;
  const leituraOk = status?.leitura_convites.configurada ?? false;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-4 pt-4">
      {status && !leituraOk && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Leitura de participantes desligada: nenhuma instância configurada. A verificação de links e o nome do grupo funcionam sem instância; só o nº de participantes depende dela.
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-7">
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
          <Select value={ader} onValueChange={v => { setAder(v); setPagina(0); }}>
            <SelectTrigger><SelectValue placeholder="Condiz com o nicho?" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Aderência: todas</SelectItem>
              {["alta", "media", "baixa", "sem_dados"].map(a => <SelectItem key={a} value={a}>{ROTULO_ADERENCIA[a]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={imp} onValueChange={v => { setImp(v); setPagina(0); }}>
            <SelectTrigger><SelectValue placeholder="Já importado?" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Importação: todos</SelectItem>
              <SelectItem value="nao">Ainda não importados</SelectItem>
              <SelectItem value="sim">Já importados</SelectItem>
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
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={verificar.isPending} onClick={() => verificar.mutate(undefined)}
            title="Abre a página pública de cada convite: descarta link expirado e confere se o nome condiz com o nicho (sem instância, sem entrar)">
            {verificar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
            Verificar links pendentes (50)
          </Button>
          <Button variant="outline" size="sm" disabled={!leituraOk || validar.isPending} onClick={() => validar.mutate(undefined)}
            title={leituraOk ? "Lê participantes, descrição e criação pela instância (sem entrar)" : "Instância de leitura não configurada"}>
            {validar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Ler participantes (20)
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">Grupo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Particip.</TableHead>
                <TableHead className="min-w-[280px]">Score, aderência e motivos</TableHead>
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
                    {rotuloDescarte(g.motivo_descarte) && (g.status === "invalido" || g.status === "rejeitado") && <div className="text-xs text-red-600" title={g.aderencia_motivo ?? g.erro_validacao ?? ""}>Descartado: {rotuloDescarte(g.motivo_descarte)}</div>}
                    {g.erro_validacao && g.status !== "invalido" && <div className="max-w-xs truncate text-xs text-red-600" title={g.erro_validacao}>{g.erro_validacao}</div>}
                    <a href={g.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      {g.codigo_convite.slice(0, 8)}… <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{g.nicho_nome ?? "Sem nicho"}</div>
                    <div className="text-xs text-muted-foreground">{g.fonte === "planilha" ? "Planilha" : g.fonte === "diretorio" ? "Diretório" : g.plataforma === "telegram" ? "Busca · Telegram" : "Busca"}</div>
                    {g.importado_lista_id && <Badge variant="secondary" className="mt-1 font-normal" title="Este grupo já foi importado para uma lista de contatos: não é lead novo.">Já importado</Badge>}
                    {g.pct_com_telefone !== null && g.pct_com_telefone !== undefined && (
                      <div className="mt-1 text-xs text-muted-foreground" title="Participantes com número visível (o resto é LID e não dá para disparar).">
                        {Math.round(Number(g.pct_com_telefone))}% com telefone
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{g.participantes ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <BadgeScore score={g.score} />
                      {g.aderencia && g.aderencia !== "sem_dados" && (
                        <Badge variant="outline" title={g.aderencia_motivo ?? ""}
                          className={g.aderencia === "alta" ? "border-emerald-500/40 text-emerald-600" : g.aderencia === "baixa" ? "border-red-500/40 text-red-600" : "border-amber-500/40 text-amber-600"}>
                          {ROTULO_ADERENCIA[g.aderencia]}
                        </Badge>
                      )}
                    </div>
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
                      <Button size="icon" variant="ghost" title="Verificar link e nome (sem entrar)" disabled={verificar.isPending}
                        onClick={() => verificar.mutate([g.id])}><Eye className="h-4 w-4" /></Button>
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

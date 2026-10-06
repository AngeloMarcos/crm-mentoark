import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AgenteInstancia, EntradaConfig, Nicho, Pesos, ROTULOS_PESO, StatusRadar } from "./tipos";

const lista = (t: string) => t.split(",").map(s => s.trim()).filter(Boolean);
const texto = (l: string[]) => l.join(", ");

function Pesos_() {
  const qc = useQueryClient();
  const pesosQ = useQuery({ queryKey: ["radar-pesos"], queryFn: async () => (await api.get("/api/radar/pesos")).data as Pesos });
  const [form, setForm] = useState<Pesos>({});
  useEffect(() => { if (pesosQ.data) setForm(pesosQ.data); }, [pesosQ.data]);

  const salvar = useMutation({
    mutationFn: async (recalcular: boolean) => {
      await api.put("/api/radar/pesos", form);
      if (recalcular) return (await api.post("/api/radar/grupos/pontuar", {})).data as { recalculados: number };
      return null;
    },
    onSuccess: (r) => {
      toast.success(r ? `Pesos salvos. ${r.recalculados} grupo(s) reavaliado(s).` : "Pesos salvos");
      qc.invalidateQueries({ queryKey: ["radar-pesos"] });
      qc.invalidateQueries({ queryKey: ["radar-grupos"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar os pesos"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pesos do score</CardTitle>
        <CardDescription>O score de 0 a 100 é a soma destas regras, sem IA. Cada regra que bate aparece como selo no catálogo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pesosQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(ROTULOS_PESO).map(([chave, { rotulo, ajuda }]) => (
              <div key={chave} className="space-y-1">
                <Label htmlFor={`p-${chave}`}>{rotulo}</Label>
                <Input id={`p-${chave}`} type="number" min={0} max={10000} value={form[chave] ?? 0}
                  onChange={e => setForm(f => ({ ...f, [chave]: Math.max(0, Number(e.target.value) || 0) }))} />
                <p className="text-xs text-muted-foreground">{ajuda}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => salvar.mutate(false)} disabled={salvar.isPending}><Save className="mr-2 h-4 w-4" />Salvar pesos</Button>
          <Button onClick={() => salvar.mutate(true)} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar e recalcular scores do catálogo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NichoEditor({ n }: { n: Nicho }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    nome: n.nome, termos: texto(n.termos_busca), pos: texto(n.palavras_positivas),
    neg: texto(n.palavras_negativas), reg: texto(n.regioes), ativo: n.ativo,
    agendar: !!n.agendar, ddds: texto(n.ddds ?? []),
  });
  const salvar = useMutation({
    mutationFn: async () => api.patch(`/api/radar/nichos/${n.id}`, {
      nome: f.nome, termos_busca: lista(f.termos), palavras_positivas: lista(f.pos),
      palavras_negativas: lista(f.neg), regioes: lista(f.reg), ativo: f.ativo,
      agendar: f.agendar, ddds: lista(f.ddds),
    }),
    onSuccess: () => { toast.success("Nicho salvo — recalcule os scores para aplicar"); qc.invalidateQueries({ queryKey: ["radar-nichos"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar o nicho"),
  });
  const excluir = useMutation({
    mutationFn: async () => api.delete(`/api/radar/nichos/${n.id}`),
    onSuccess: () => { toast.success("Nicho removido"); qc.invalidateQueries({ queryKey: ["radar-nichos"] }); },
  });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1"><Label>Nome</Label><Input value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
      <div className="flex items-center gap-2 pt-6"><Switch checked={f.ativo} onCheckedChange={v => setF({ ...f, ativo: v })} /><Label>Nicho ativo nas buscas</Label></div>
      <div className="space-y-1 md:col-span-2"><Label>Termos de busca (separados por vírgula)</Label>
        <Textarea rows={2} value={f.termos} onChange={e => setF({ ...f, termos: e.target.value })} /></div>
      <div className="space-y-1"><Label>Palavras positivas</Label>
        <Textarea rows={3} value={f.pos} onChange={e => setF({ ...f, pos: e.target.value })} /></div>
      <div className="space-y-1"><Label>Palavras negativas do nicho</Label>
        <Textarea rows={3} value={f.neg} onChange={e => setF({ ...f, neg: e.target.value })} /></div>
      <div className="space-y-1 md:col-span-2"><Label>Regiões</Label>
        <Textarea rows={2} value={f.reg} onChange={e => setF({ ...f, reg: e.target.value })} /></div>
      <div className="space-y-1"><Label>DDDs (variações de busca, ex.: 11, 21)</Label>
        <Input value={f.ddds} onChange={e => setF({ ...f, ddds: e.target.value })} placeholder="11, 21, 19" /></div>
      <div className="flex items-center gap-2 pt-6">
        <Switch checked={f.agendar} onCheckedChange={v => setF({ ...f, agendar: v })} />
        <Label>Buscar sozinho todo dia (só traz grupos novos)</Label>
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}><Save className="mr-2 h-4 w-4" />Salvar nicho</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remover o nicho “${n.nome}”? Os grupos já catalogados ficam sem nicho.`)) excluir.mutate(); }}>
          <Trash2 className="mr-2 h-4 w-4 text-red-600" />Remover
        </Button>
      </div>
    </div>
  );
}

function Nichos() {
  const qc = useQueryClient();
  const nichos = useQuery({ queryKey: ["radar-nichos"], queryFn: async () => (await api.get("/api/radar/nichos")).data as Nicho[] });
  const [novo, setNovo] = useState("");
  const criar = useMutation({
    mutationFn: async () => api.post("/api/radar/nichos", { nome: novo.trim(), termos_busca: [novo.trim()] }),
    onSuccess: () => { setNovo(""); qc.invalidateQueries({ queryKey: ["radar-nichos"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível criar o nicho"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Nichos</CardTitle>
        <CardDescription>Termos usados na busca e palavras usadas no score. Já vêm 29 nichos prontos; edite à vontade.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Novo nicho (ex.: Dentistas)" value={novo} onChange={e => setNovo(e.target.value)} maxLength={80} />
          <Button onClick={() => criar.mutate()} disabled={novo.trim().length < 2 || criar.isPending}><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
        </div>
        {nichos.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <Accordion type="single" collapsible>
            {(nichos.data ?? []).map(n => (
              <AccordionItem key={n.id} value={n.id}>
                <AccordionTrigger>{n.nome}{!n.ativo && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}</AccordionTrigger>
                <AccordionContent><NichoEditor n={n} /></AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

// Sprint 8 (Sprint 4 / H8): pessoal (sem IA e sem disparo) e maturação.
const ROTULO_PAPEL: Record<string, string> = {
  atendimento: "Atendimento (IA responde)", disparo: "Disparo (campanhas + IA)", prospeccao: "Prospecção (entra em grupo, sem disparo)",
  pessoal: "Pessoal (sem IA e sem disparo)", maturacao: "Maturação (aquecimento)",
};

function PapelInstancias() {
  const qc = useQueryClient();
  // Instâncias WhatsApp são recurso da conta raiz (não do usuário logado) — endpoint próprio do
  // Radar já resolve isso no backend, ao contrário do GET /api/agentes genérico.
  const agentes = useQuery({ queryKey: ["radar-instancias"], queryFn: async () => (await api.get("/api/radar/instancias")).data as AgenteInstancia[] });
  const comInstancia = (agentes.data ?? []).filter(a => a.evolution_instancia);

  const salvarPapel = useMutation({
    mutationFn: async (v: { id: string; papel: string }) => api.put(`/api/radar/instancias/${v.id}/papel`, { papel: v.papel }),
    onSuccess: () => { toast.success("Papel da instância salvo"); qc.invalidateQueries({ queryKey: ["radar-instancias"] }); qc.invalidateQueries({ queryKey: ["radar-entrada-config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar o papel"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Papel de cada instância</CardTitle>
        <CardDescription>
          Só a instância marcada "Prospecção" entra em grupo, e ela não dispara campanha. Número "Pessoal" não recebe IA nem campanha.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {agentes.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {!agentes.isLoading && !comInstancia.length && (
          <p className="text-sm text-muted-foreground">Nenhuma instância WhatsApp conectada foi encontrada nesta conta.</p>
        )}
        {/* Sprint 8 / H8: um ban não pode derrubar o atendimento — recomenda 2+ números com funções separadas. */}
        {!agentes.isLoading && comInstancia.length > 0 && (comInstancia.length < 2
          || !comInstancia.some((a: AgenteInstancia) => (a.papel ?? "atendimento") === "atendimento")
          || !comInstancia.some((a: AgenteInstancia) => ["disparo", "prospeccao"].includes(a.papel ?? ""))) && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            Recomendado: pelo menos 2 números — um de <b>atendimento</b> e outro de <b>disparo/prospecção</b>. Assim, se o número
            de campanha for banido, o atendimento continua de pé.
          </p>
        )}
        {comInstancia.map((a: AgenteInstancia) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
            <div className="text-sm"><span className="font-medium">{a.nome ?? a.evolution_instancia}</span> <span className="text-muted-foreground">({a.evolution_instancia})</span></div>
            <Select value={a.papel ?? "atendimento"} onValueChange={v => salvarPapel.mutate({ id: a.id, papel: v })}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ROTULO_PAPEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EntradaGrupo() {
  const qc = useQueryClient();
  const cfgQ = useQuery({ queryKey: ["radar-entrada-config"], queryFn: async () => (await api.get("/api/radar/entrada-config")).data as EntradaConfig });
  const statusQ = useQuery({ queryKey: ["radar-status"], queryFn: async () => (await api.get("/api/radar/status")).data as StatusRadar, refetchInterval: 30000 });
  const [f, setF] = useState<Partial<EntradaConfig>>({});
  useEffect(() => { if (cfgQ.data) setF(cfgQ.data); }, [cfgQ.data]);

  const salvar = useMutation({
    mutationFn: async () => api.put("/api/radar/entrada-config", f),
    onSuccess: () => { toast.success("Configuração de entrada salva"); qc.invalidateQueries({ queryKey: ["radar-entrada-config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar"),
  });
  const pausar = useMutation({
    mutationFn: async () => api.post("/api/radar/pausas/entrada", { motivo: "Parada manual pelo usuário", minutos: 24 * 60 }),
    onSuccess: () => { toast.success("Fila de entrada parada"); qc.invalidateQueries({ queryKey: ["radar-status"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível parar a fila"),
  });
  const retomar = useMutation({
    mutationFn: async () => api.delete("/api/radar/pausas/entrada"),
    onSuccess: () => { toast.success("Fila de entrada retomada"); qc.invalidateQueries({ queryKey: ["radar-status"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível retomar a fila"),
  });

  const pausaAtiva = statusQ.data?.pausas?.entrada ?? null;
  const instancias = cfgQ.data?.instancias_disponiveis ?? [];
  const apta = cfgQ.data?.instancia_selecionada_apta;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Entrada em grupo</CardTitle>
        <CardDescription>
          Só a instância marcada "prospecção" entra em grupo. Nada aqui entra na hora: tudo passa
          pela fila, respeitando limite diário, janela de horário e pausa entre entradas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pausaAtiva && (
          <div className="flex items-center justify-between rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <span><strong>Fila de entrada parada.</strong> {pausaAtiva}</span>
            <Button size="sm" variant="outline" disabled={retomar.isPending} onClick={() => retomar.mutate()}>Retomar agora</Button>
          </div>
        )}
        {cfgQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <Label>Instância de prospecção</Label>
                <Select value={f.agente_id ?? ""} onValueChange={v => setF(s => ({ ...s, agente_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Escolha a instância que vai entrar nos grupos" /></SelectTrigger>
                  <SelectContent>
                    {instancias.map(i => (
                      <SelectItem key={i.id} value={i.id}>{i.nome ?? i.evolution_instancia} (Saúde: {i.health_score ?? "—"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!instancias.length && (
                  <p className="text-xs text-amber-600">
                    Nenhuma instância com papel "prospecção" ainda. Marque uma em Configurações do agente/instância.
                  </p>
                )}
                {apta && apta.ok === false && <p className="text-xs text-red-600">Instância escolhida não está pronta: {apta.motivo}</p>}
                {apta?.ok && <p className="text-xs text-emerald-600">Instância pronta para entrar em grupos.</p>}
              </div>
              <div className="space-y-1">
                <Label>Entradas por dia (máximo)</Label>
                <Input type="number" min={1} max={50} value={f.limite_dia ?? 5} onChange={e => setF(s => ({ ...s, limite_dia: Number(e.target.value) || 1 }))} />
                {typeof cfgQ.data?.entradas_hoje === "number" && <p className="text-xs text-muted-foreground">{cfgQ.data.entradas_hoje} já tentada(s) hoje.</p>}
              </div>
              <div className="space-y-1">
                <Label>Consultas de convite por dia (máximo)</Label>
                <Input type="number" min={1} max={500} value={f.limite_consultas_dia ?? 50} onChange={e => setF(s => ({ ...s, limite_consultas_dia: Number(e.target.value) || 1 }))} />
                <p className="text-xs text-muted-foreground">
                  Ler convites usa a instância de prospecção. Se o WhatsApp limitar (erro 429), as consultas pausam 30 min, depois 1h, 2h…
                  {typeof cfgQ.data?.consultas_hoje === "number" && <> {cfgQ.data.consultas_hoje} feita(s) hoje.</>}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Pausa entre entradas (segundos, min–máx)</Label>
                <div className="flex gap-2">
                  <Input type="number" min={0} value={f.pausa_min_seg ?? 180} onChange={e => setF(s => ({ ...s, pausa_min_seg: Number(e.target.value) || 0 }))} />
                  <Input type="number" min={0} value={f.pausa_max_seg ?? 480} onChange={e => setF(s => ({ ...s, pausa_max_seg: Number(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Janela de horário (início–fim, São Paulo)</Label>
                <div className="flex gap-2">
                  <Input type="time" value={f.janela_inicio ?? "09:00"} onChange={e => setF(s => ({ ...s, janela_inicio: e.target.value }))} />
                  <Input type="time" value={f.janela_fim ?? "18:00"} onChange={e => setF(s => ({ ...s, janela_fim: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Nota mínima para entrar</Label>
                <Input type="number" min={0} max={100} value={f.corte_score ?? 40} onChange={e => setF(s => ({ ...s, corte_score: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label>Nº mínimo de membros para entrar</Label>
                <Input type="number" min={0} value={f.corte_membros ?? 50} onChange={e => setF(s => ({ ...s, corte_membros: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label>Instância conectada há pelo menos (dias)</Label>
                <Input type="number" min={0} value={f.corte_dias_conectado ?? 15} onChange={e => setF(s => ({ ...s, corte_dias_conectado: Number(e.target.value) || 0 }))} />
                <p className="text-xs text-muted-foreground">Protege número recém-conectado/maturando — não entra em grupo antes disso.</p>
              </div>
              <div className="space-y-1">
                <Label>Score de Saúde mínimo da instância</Label>
                <Input type="number" min={0} max={100} value={f.corte_health_score ?? 70} onChange={e => setF(s => ({ ...s, corte_health_score: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label>Extrair participantes após (horas)</Label>
                <Input type="number" min={1} value={f.extracao_apos_horas ?? 24} onChange={e => setF(s => ({ ...s, extracao_apos_horas: Number(e.target.value) || 1 }))} />
                <p className="text-xs text-muted-foreground">Não extrai na hora — evita parecer robô. Use a importação de membros já existente após esse prazo.</p>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={!!f.sair_apos_extrair} onCheckedChange={v => setF(s => ({ ...s, sair_apos_extrair: v }))} />
                <Label>Sair do grupo depois de extrair (padrão: não sai)</Label>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar configuração de entrada
              </Button>
              {!pausaAtiva && (
                <Button variant="destructive" disabled={pausar.isPending} onClick={() => pausar.mutate()}>
                  <ShieldAlert className="mr-2 h-4 w-4" />Parar a fila de entrada agora
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AbaConfig() {
  return <div className="space-y-6 pt-4"><PapelInstancias /><EntradaGrupo /><Pesos_ /><Nichos /></div>;
}

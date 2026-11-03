/**
 * Funil de Vendas (2026-11-02: funil que anda sozinho, modelo atendIA — ver
 * diagnosticos/engenharia_reversa_atendia/RELATORIO_FUNIL_AUTOMATICO.md).
 *
 * Um card por contato: a etapa é `contatos.funil_estagio_id` (a mesma que os Disparos filtram).
 * O card anda pela equipe (arrastar), pela IA (Agentes → Ações no funil) ou por API; todo
 * movimento fica no histórico do card. Etapas têm tipo (aberta/ganho/perdido) e automações de entrada.
 */
import { useEffect, useMemo, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { authHeader } from "@/lib/api-token";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowDown, ArrowUp, Bot, Clock, Loader2, Plus, Settings2, Trash2, User, X, Zap, Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  DragOverlay, DragStartEvent,
} from "@dnd-kit/core";
import {
  AutomacaoEtapa, CardFunil, EtapaFunil, EventoFunil, ROTULO_ORIGEM, TipoEtapa,
  atualizarEtapa, criarEtapa, eventosDoCard, excluirEtapa, listarCardsFunil, listarEtapasFunil,
  moverCard, ordenarEtapas,
} from "@/lib/funilAuto";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const DIAS_PARADO = 7;
const ROTULO_TIPO: Record<TipoEtapa, string> = { aberta: "Aberta", ganho: "Ganho", perdido: "Perdido" };

const diasDesde = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);
const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function CardArrastavel({ card, cor, onClick }: { card: CardFunil; cor: string; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  const dias = diasDesde(card.funil_entrou_em);
  const parado = dias >= DIAS_PARADO;
  const pelaIA = card.ultimo_movimento?.origem === "ia";
  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors border-t-2 ${isDragging ? "opacity-30" : ""}`}
      style={{ borderTopColor: cor }}
    >
      <div className="space-y-2 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <p className="font-medium text-sm break-words line-clamp-2 min-w-0 flex-1">{card.nome || card.telefone}</p>
          {pelaIA && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 shrink-0" title={card.ultimo_movimento?.motivo || "Movido pela IA"}>
              <Bot className="h-3 w-3" /> IA
            </Badge>
          )}
        </div>
        {card.empresa && <p className="text-xs text-muted-foreground truncate">{card.empresa}</p>}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1 truncate">
            {card.responsavel && (<><User className="h-3 w-3" />{card.responsavel}</>)}
          </span>
          <span className={`flex items-center gap-1 ${parado ? "text-orange-500 font-medium" : ""}`} title={parado ? `Parado há ${dias} dias nesta etapa` : undefined}>
            <Clock className="h-3 w-3" />{dias}d
          </span>
        </div>
        {Number(card.valor_potencial) > 0 && (
          <p className="text-xs font-medium text-primary">R$ {Number(card.valor_potencial).toLocaleString("pt-BR")}</p>
        )}
      </div>
    </Card>
  );
}

function Coluna({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`space-y-2 flex-1 min-h-[120px] rounded-lg p-1 transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/30" : ""}`}>
      {children}
    </div>
  );
}

function linhaEvento(ev: EventoFunil): string {
  if (ev.origem === "automacao") return ev.motivo || "Automação da etapa";
  const quem = ev.origem === "ia" ? `IA${ev.agente_nome ? ` (${ev.agente_nome})` : ""}` : ROTULO_ORIGEM[ev.origem];
  const destino = ev.para_nome ? `"${ev.para_nome}"` : "fora do funil";
  if (ev.resultado === "feito") return `${quem} moveu ${ev.de_nome ? `de "${ev.de_nome}" ` : ""}para ${destino}`;
  return `${quem} tentou mover para ${destino}`;
}

export default function FunilPage() {
  const [etapas, setEtapas] = useState<EtapaFunil[]>([]);
  const [cards, setCards] = useState<CardFunil[]>([]);
  const [limite, setLimite] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<CardFunil | null>(null);
  const [eventos, setEventos] = useState<EventoFunil[] | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [adicionarAberto, setAdicionarAberto] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const carregar = async () => {
    try {
      const [e, c] = await Promise.all([listarEtapasFunil(), listarCardsFunil()]);
      setEtapas(e.etapas);
      setCards(c.cards);
      setLimite(c.limite);
    } catch (err: unknown) {
      toast.error(`Erro ao carregar o funil: ${(err as Error).message}`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!selecionado) { setEventos(null); return; }
    eventosDoCard(selecionado.id).then((r) => setEventos(r.eventos)).catch(() => setEventos([]));
  }, [selecionado?.id]);

  const etapaPorId = useMemo(() => new Map(etapas.map((e) => [e.id, e])), [etapas]);

  const mover = async (contatoId: string, etapaId: string | null) => {
    const anterior = cards.find((c) => c.id === contatoId);
    if (!anterior || anterior.funil_estagio_id === etapaId) return;
    setCards((prev) => etapaId
      ? prev.map((c) => (c.id === contatoId ? { ...c, funil_estagio_id: etapaId, funil_entrou_em: new Date().toISOString(), ultimo_movimento: null } : c))
      : prev.filter((c) => c.id !== contatoId));
    try {
      const r = await moverCard(contatoId, etapaId);
      const falhas = (r.automacoes ?? []).filter((a) => !a.ok);
      const nome = etapaId ? etapaPorId.get(etapaId)?.nome : null;
      if (falhas.length) toast.warning(`Movido, mas ${falhas.length} automação(ões) não rodou(aram). Veja o histórico do card.`);
      else toast.success(nome ? `Movido para ${nome}` : "Tirado do funil");
      if ((r.automacoes ?? []).length) carregar();
    } catch (err: unknown) {
      toast.error((err as Error).message);
      carregar();
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setArrastando(null);
    if (e.over) mover(String(e.active.id), String(e.over.id));
  };

  const cardArrastando = arrastando ? cards.find((c) => c.id === arrastando) : null;
  const abertos = cards.filter((c) => etapaPorId.get(c.funil_estagio_id)?.tipo === "aberta").length;

  return (
    <CRMLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Funil de Vendas</h1>
            <p className="text-muted-foreground text-sm">
              Os cards andam pela equipe, pela IA (Agentes → Ações no funil) ou pela API. Tudo fica no histórico do card.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfigAberta(true)}><Settings2 className="h-4 w-4" /> Etapas e automações</Button>
            <Button onClick={() => setAdicionarAberto(true)}><Plus className="h-4 w-4" /> Adicionar ao funil</Button>
          </div>
        </div>

        {!carregando && (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground">
            <span><b className="text-foreground">{abertos}</b> em negociação</span>
            <span>·</span>
            <span><b className="text-foreground">{cards.length}</b> no funil</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Bot className="h-3 w-3" /> selo IA = movido pela IA</span>
            <span>·</span>
            <span className="text-orange-500">laranja = parado há {DIAS_PARADO}+ dias</span>
            {cards.length >= limite && limite > 0 && <span className="text-amber-600">mostrando os {limite} mais recentes</span>}
          </div>
        )}

        {carregando ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setArrastando(String(e.active.id))} onDragEnd={onDragEnd}>
            <div className="flex gap-3 overflow-x-auto pb-4 items-start">
              {etapas.map((etapa) => {
                const daEtapa = cards.filter((c) => c.funil_estagio_id === etapa.id);
                const total = daEtapa.reduce((s, c) => s + (Number(c.valor_potencial) || 0), 0);
                const autos = (etapa.automacoes || []).filter((a) => a.ativo).length;
                return (
                  <div key={etapa.id} className="min-w-[280px] w-[280px] flex-shrink-0 flex flex-col">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: etapa.cor || "#64748b" }} />
                        <h3 className="font-semibold text-sm truncate">{etapa.nome}</h3>
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{daEtapa.length}</Badge>
                        {etapa.tipo !== "aberta" && <Badge variant="outline" className="text-[10px] h-5 px-1.5">{ROTULO_TIPO[etapa.tipo]}</Badge>}
                        {autos > 0 && (
                          <span title={`${autos} automação(ões) ao entrar`} className="flex items-center text-[10px] text-amber-500">
                            <Zap className="h-3 w-3" />{autos}
                          </span>
                        )}
                      </div>
                      {total > 0 && <span className="text-[10px] text-muted-foreground whitespace-nowrap">R$ {(total / 1000).toFixed(1)}k</span>}
                    </div>
                    <Coluna id={etapa.id}>
                      {daEtapa.map((c) => (
                        <CardArrastavel key={c.id} card={c} cor={etapa.cor || "#64748b"} onClick={() => setSelecionado(c)} />
                      ))}
                      {daEtapa.length === 0 && (
                        <div className="border border-dashed rounded-lg p-6 text-center text-[10px] text-muted-foreground uppercase tracking-wider">
                          Nenhum cliente
                        </div>
                      )}
                    </Coluna>
                  </div>
                );
              })}
            </div>
            <DragOverlay>
              {cardArrastando ? (
                <Card className="p-3 border-t-2 shadow-xl cursor-grabbing scale-105" style={{ borderTopColor: etapaPorId.get(cardArrastando.funil_estagio_id)?.cor || undefined }}>
                  <p className="font-medium text-sm">{cardArrastando.nome || cardArrastando.telefone}</p>
                </Card>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <Dialog open={!!selecionado} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent className="sm:max-w-lg">
          {selecionado && (
            <>
              <DialogHeader>
                <DialogTitle>{selecionado.nome || selecionado.telefone}</DialogTitle>
                <DialogDescription>
                  {selecionado.telefone}{selecionado.empresa ? ` · ${selecionado.empresa}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1.5">
                  <Label>Etapa</Label>
                  <Select value={selecionado.funil_estagio_id} onValueChange={(v) => { mover(selecionado.id, v); setSelecionado({ ...selecionado, funil_estagio_id: v }); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {etapas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}{e.tipo !== "aberta" ? ` (${ROTULO_TIPO[e.tipo]})` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Nesta etapa há {diasDesde(selecionado.funil_entrou_em)} dia(s).</p>
                </div>
                <div className="space-y-2">
                  <Label>Histórico</Label>
                  {!eventos ? (
                    <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
                  ) : eventos.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum movimento registrado ainda.</p>
                  ) : (
                    <ul className="max-h-64 overflow-y-auto space-y-2 pr-1">
                      {eventos.map((ev) => (
                        <li key={ev.id} className="rounded-md border p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-medium text-xs">
                              {ev.origem === "ia" && <Bot className="h-3.5 w-3.5 text-primary" />}
                              {ev.origem === "automacao" && <Zap className="h-3.5 w-3.5 text-amber-500" />}
                              {linhaEvento(ev)}
                            </span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{quando(ev.created_at)}</span>
                          </div>
                          {ev.motivo && ev.origem !== "automacao" && (
                            <p className={`text-xs mt-1 ${ev.resultado === "feito" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                              {ev.resultado === "feito" ? `Motivo: ${ev.motivo}` : ev.motivo}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="ghost" className="text-destructive" onClick={() => { mover(selecionado.id, null); setSelecionado(null); }}>
                  <X className="h-4 w-4" /> Tirar do funil
                </Button>
                <Button variant="outline" onClick={() => setSelecionado(null)}>Fechar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfigEtapas aberto={configAberta} onFechar={() => setConfigAberta(false)} etapas={etapas} onMudou={carregar} />
      <AdicionarAoFunil aberto={adicionarAberto} onFechar={() => setAdicionarAberto(false)} etapas={etapas} onAdicionado={carregar} />
    </CRMLayout>
  );
}

// ── Configurar etapas: nome, cor, tipo, ordem e automações de entrada ─────────
function ConfigEtapas({ aberto, onFechar, etapas, onMudou }: { aberto: boolean; onFechar: () => void; etapas: EtapaFunil[]; onMudou: () => void }) {
  const [rascunho, setRascunho] = useState<EtapaFunil[]>([]);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [nova, setNova] = useState("");

  useEffect(() => { if (aberto) setRascunho(etapas.map((e) => ({ ...e, automacoes: [...(e.automacoes || [])] }))); }, [aberto, etapas]);

  const alterar = (id: string, mudanca: Partial<EtapaFunil>) => setRascunho((r) => r.map((e) => (e.id === id ? { ...e, ...mudanca } : e)));

  const salvar = async (e: EtapaFunil) => {
    setSalvando(e.id);
    try {
      await atualizarEtapa(e.id, { nome: e.nome, cor: e.cor || undefined, tipo: e.tipo, automacoes: e.automacoes });
      toast.success(`"${e.nome}" salva.`);
      onMudou();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSalvando(null);
    }
  };

  const mudarOrdem = async (idx: number, dir: -1 | 1) => {
    const lista = [...rascunho];
    const j = idx + dir;
    if (j < 0 || j >= lista.length) return;
    [lista[idx], lista[j]] = [lista[j], lista[idx]];
    setRascunho(lista);
    try { await ordenarEtapas(lista.map((e) => e.id)); onMudou(); } catch (err: unknown) { toast.error((err as Error).message); }
  };

  const remover = async (e: EtapaFunil) => {
    const destino = rascunho.find((x) => x.id !== e.id && x.tipo === "aberta");
    const aviso = e.cards
      ? `Excluir "${e.nome}"? Os ${e.cards} cliente(s) dela vão para "${destino?.nome ?? "fora do funil"}".`
      : `Excluir "${e.nome}"?`;
    if (!window.confirm(aviso)) return;
    try { await excluirEtapa(e.id, destino?.id ?? null); onMudou(); } catch (err: unknown) { toast.error((err as Error).message); }
  };

  const adicionar = async () => {
    if (!nova.trim()) return;
    try { await criarEtapa(nova.trim()); setNova(""); onMudou(); } catch (err: unknown) { toast.error((err as Error).message); }
  };

  const mudarAuto = (e: EtapaFunil, i: number, a: Partial<AutomacaoEtapa>) =>
    alterar(e.id, { automacoes: e.automacoes.map((x, k) => (k === i ? { ...x, ...a } : x)) });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Etapas e automações</DialogTitle>
          <DialogDescription>
            Ganho e Perdido fecham a negociação e nunca são destino da IA. As automações rodam uma vez, quando o
            cliente entra na etapa (pela equipe, pela IA ou pela API). Se uma falhar, o cliente continua na etapa nova e a falha fica no histórico.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rascunho.map((e, idx) => (
            <div key={e.id} className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input type="color" value={e.cor || "#64748b"} onChange={(ev) => alterar(e.id, { cor: ev.target.value })} className="h-8 w-8 rounded cursor-pointer bg-transparent" aria-label={`Cor de ${e.nome}`} />
                <Input value={e.nome} onChange={(ev) => alterar(e.id, { nome: ev.target.value })} className="h-8 flex-1 min-w-[140px]" maxLength={60} />
                <Select value={e.tipo} onValueChange={(v) => alterar(e.id, { tipo: v as TipoEtapa })}>
                  <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROTULO_TIPO) as TipoEtapa[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground w-16 text-right">{e.cards} cliente(s)</span>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => mudarOrdem(idx, -1)} disabled={idx === 0} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => mudarOrdem(idx, 1)} disabled={idx === rascunho.length - 1} aria-label="Descer"><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remover(e)} disabled={rascunho.length <= 1} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>

              <div className="space-y-2 pl-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> Quando um cliente entrar em "{e.nome}":</p>
                {e.automacoes.length === 0 && <p className="text-xs text-muted-foreground italic">Nada acontece sozinho.</p>}
                {e.automacoes.map((a, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Switch checked={a.ativo} onCheckedChange={(v) => mudarAuto(e, i, { ativo: v })} aria-label="Ligar automação" />
                    <span className="text-xs w-36">{a.tipo === "adicionar_etiqueta" ? "Adicionar etiqueta" : "Definir responsável"}</span>
                    <Input
                      className="h-8 flex-1 min-w-[140px]"
                      placeholder={a.tipo === "adicionar_etiqueta" ? "Qual etiqueta?" : "Nome do responsável"}
                      value={(a.tipo === "adicionar_etiqueta" ? a.etiqueta : a.responsavel) || ""}
                      onChange={(ev) => mudarAuto(e, i, a.tipo === "adicionar_etiqueta" ? { etiqueta: ev.target.value } : { responsavel: ev.target.value })}
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => alterar(e.id, { automacoes: e.automacoes.filter((_, k) => k !== i) })} aria-label="Remover automação">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => alterar(e.id, { automacoes: [...e.automacoes, { tipo: "adicionar_etiqueta", ativo: true, etiqueta: "" }] })}>
                    <Plus className="h-3.5 w-3.5" /> Etiqueta
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => alterar(e.id, { automacoes: [...e.automacoes, { tipo: "definir_responsavel", ativo: true, responsavel: "" }] })}>
                    <Plus className="h-3.5 w-3.5" /> Responsável
                  </Button>
                  <span className="grow" />
                  <Button size="sm" onClick={() => salvar(e)} disabled={salvando === e.id}>
                    {salvando === e.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar etapa
                  </Button>
                </div>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova etapa (ex.: Agendado)" maxLength={60}
              onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }} />
            <Button onClick={adicionar} disabled={!nova.trim()}><Plus className="h-4 w-4" /> Adicionar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Adicionar um contato ao funil ─────────────────────────────────────────────
function AdicionarAoFunil({ aberto, onFechar, etapas, onAdicionado }: { aberto: boolean; onFechar: () => void; etapas: EtapaFunil[]; onAdicionado: () => void }) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Array<{ id: string; nome: string | null; telefone: string | null; funil_estagio_id: string | null }>>([]);
  const [buscando, setBuscando] = useState(false);
  const primeiraAberta = etapas.find((e) => e.tipo === "aberta");
  const [etapaId, setEtapaId] = useState<string>("");

  useEffect(() => { if (aberto) { setBusca(""); setResultados([]); setEtapaId(primeiraAberta?.id ?? ""); } }, [aberto]);

  useEffect(() => {
    if (!aberto || busca.trim().length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`${API_URL}/api/contatos?search=${encodeURIComponent(busca.trim())}&limit=20`, { headers: authHeader() });
        const d = await r.json();
        const lista = Array.isArray(d) ? d : d?.data ?? [];
        setResultados(lista.slice(0, 20));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [busca, aberto]);

  const adicionar = async (id: string) => {
    if (!etapaId) return;
    try {
      const r = await moverCard(id, etapaId);
      if (r.ok === false && r.motivo === "ja_estava") toast.info("Este cliente já está nessa etapa.");
      else toast.success("Adicionado ao funil.");
      onAdicionado();
      onFechar();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar ao funil</DialogTitle>
          <DialogDescription>Busque o contato pelo nome ou telefone. Cada cliente tem um card só.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Entra na etapa</Label>
            <Select value={etapaId} onValueChange={setEtapaId}>
              <SelectTrigger><SelectValue placeholder="Escolha a etapa" /></SelectTrigger>
              <SelectContent>{etapas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input autoFocus className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou telefone" />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
            {buscando && <div className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Buscando…</div>}
            {!buscando && busca.trim().length >= 2 && resultados.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhum contato encontrado.</p>}
            {resultados.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.nome || c.telefone}</p>
                  <p className="text-xs text-muted-foreground">{c.telefone}{c.funil_estagio_id ? " · já está no funil" : ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => adicionar(c.id)} disabled={!etapaId}>
                  {c.funil_estagio_id ? "Mover" : "Adicionar"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

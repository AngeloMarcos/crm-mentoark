/**
 * PainelChips.tsx — painel de chips do Aquecimento (2026-10-27, pedido do usuário: "um painel parecido com
 * o do ChipFlow para a maturação e conectar os chips"). Um card por número: conexão, o que está fazendo
 * agora (aquecendo / descansando / em espera / dormindo), fase e progresso, velocidade, confirmação de
 * leitura, proxy, anotação, arquivo de contatos e reconectar (QR ou código de 8 dígitos). O menu "…" abre
 * o resto dos controles.
 *
 * Conectar/reconectar usa o MESMO fluxo da tela de Instâncias (`createInstance` → QR/código → espera
 * conectar), então as travas do backend continuam valendo (mesmo número em 2 instâncias, loop de logout).
 * Backend: GET /api/maturador/painel, PUT /painel/:id/anotacao, POST /painel/:id/contatos.
 */
import { useEffect, useRef, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { createInstance, fetchConnectionStatus, pollQr, LogoutLoopError, CreateInstanceResult } from "@/services/evolutionService";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bot, Moon, Search, RefreshCw, Plus, QrCode, Pencil, ChevronDown, Copy, Check, MoreHorizontal, Loader2, UserPlus, ShieldCheck, Lock,
} from "lucide-react";
import { ListaControles } from "./ControlesMaturador";
import { StatusMaturador } from "./StatusMaturador";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

async function chamar(path: string, opts: { method?: string; body?: any } = {}) {
  const r = await fetch(`${API_URL}/api/maturador${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || `Erro ${r.status}`);
  return d;
}

const VELOCIDADES = [
  { id: "lenta", rotulo: "Lenta", ajuda: "Menos conversas, mais descanso entre elas.", cor: "bg-sky-500" },
  { id: "normal", rotulo: "Normal", ajuda: "O ritmo recomendado. É o padrão de todo chip.", cor: "bg-teal-500" },
  { id: "rapida", rotulo: "Rápida", ajuda: "Mais conversas por dia — mais risco de queda.", cor: "bg-amber-500" },
];

const diasDesde = (s: string | null) => s ? Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000)) : 0;
function emQuanto(s: string | null): string {
  if (!s) return "em instantes";
  const min = Math.round((new Date(s).getTime() - Date.now()) / 60_000);
  if (min <= 1) return "em instantes";
  if (min < 60) return `em ${min} min`;
  return `em ${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

type AlvoConexao = { modo: "novo" } | { modo: "reconectar"; chip: any } | null;

// ── Conectar / reconectar ───────────────────────────────────────────────────────────────────
function ConectarChip({ alvo, onFechar }: { alvo: AlvoConexao; onFechar: (conectou: boolean) => void }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [qr, setQr] = useState<CreateInstanceResult | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const vivo = useRef(false);

  const esperarConectar = async (instancia?: string) => {
    const fim = Date.now() + 2 * 60_000;
    while (vivo.current && Date.now() < fim) {
      await new Promise(r => setTimeout(r, 3000));
      const st = await fetchConnectionStatus(instancia).catch(() => null);
      if (!st || !vivo.current) continue;
      if (st.state === "open") { toast.success("WhatsApp conectado!"); onFechar(true); return; }
      if (st.error) { setErro(st.message || "A Evolution não respondeu."); return; }
    }
    if (vivo.current) setErro("O tempo acabou sem conectar. Gere um código novo e tente de novo.");
  };
  const esperarQr = async (instancia?: string) => {
    for (let i = 0; i < 20 && vivo.current; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const d = await pollQr(instancia).catch(() => null);
      if (!vivo.current) return;
      if (d?.state === "open") { toast.success("WhatsApp conectado!"); onFechar(true); return; }
      if (d?.qrCode || d?.pairingCode) { setQr(d); void esperarConectar(instancia); return; }
    }
  };

  const iniciar = async (instanceName: string, phone: string, instancia?: string) => {
    setOcupado(true); setErro(null);
    try {
      const res = await createInstance(instancia
        ? { instanceName, instancia }
        : { instanceName, phoneNumber: phone.replace(/\D/g, "") || undefined, novaConexao: true });
      const inst = res.instancia || res.instanceName || instancia;
      if (res.state === "open") { toast.success("WhatsApp já está conectado!"); onFechar(true); return; }
      setQr(res);
      if (res.qrCode || res.pairingCode) void esperarConectar(inst);
      else if (res.qrPending) void esperarQr(inst);
      else setErro("A Evolution não devolveu o QR Code. Tente de novo em instantes.");
    } catch (e: any) {
      setErro(e instanceof LogoutLoopError ? e.message : e.message || "Falha ao conectar.");
    } finally {
      setOcupado(false);
    }
  };

  useEffect(() => {
    if (!alvo) { vivo.current = false; return; }
    vivo.current = true;
    setQr(null); setErro(null); setTelefone(""); setNome(alvo.modo === "reconectar" ? alvo.chip.nome : "");
    if (alvo.modo === "reconectar") void iniciar(alvo.chip.nome, "", alvo.chip.instancia);
    return () => { vivo.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  const reconectar = alvo?.modo === "reconectar";
  const instanciaAtual = reconectar ? (alvo as any).chip.instancia : qr?.instancia || qr?.instanceName;
  return (
    <Dialog open={!!alvo} onOpenChange={(v) => !v && onFechar(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{reconectar ? `Reconectar ${nome}` : "Novo WhatsApp"}</DialogTitle>
          <DialogDescription>
            {reconectar ? "O progresso do aquecimento é preservado." : "Dê um nome ao número e conecte pelo QR Code ou pelo código de 8 dígitos."}
          </DialogDescription>
        </DialogHeader>

        {!reconectar && !qr && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Nome</p>
              <Input placeholder="Ex.: Comercial 4" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Número (opcional)</p>
              <Input placeholder="Ex.: 11999999999 — para receber o código de 8 dígitos" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
            <Button type="button" className="w-full" disabled={ocupado || !nome.trim()} onClick={() => iniciar(nome.trim(), telefone)}>
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gerar QR Code"}
            </Button>
          </div>
        )}

        {ocupado && reconectar && !qr && <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}

        {qr && (
          <div className="space-y-4">
            {qr.qrCode?.startsWith("data:image") ? (
              <div className="flex justify-center rounded-lg bg-white p-3"><img src={qr.qrCode} alt="QR Code" className="h-56 w-56" /></div>
            ) : qr.qrPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Preparando o QR Code…</p>
            ) : null}
            {qr.pairingCode && (
              <div className="space-y-1 text-center">
                <p className="text-xs text-muted-foreground">Ou use o código no celular (Aparelhos conectados → Conectar com número)</p>
                <button type="button" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xl tracking-widest"
                  onClick={() => { navigator.clipboard.writeText(qr.pairingCode!.replace(/\s/g, "")); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}>
                  {qr.pairingCode} {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            )}
            {!erro && <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando você conectar no celular…</p>}
          </div>
        )}

        {erro && (
          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            <p>{erro}</p>
            <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => iniciar(nome.trim(), telefone, instanciaAtual)}>
              Tentar de novo
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Card do chip ────────────────────────────────────────────────────────────────────────────
function CardChip({ c, acordaAs, recarregar, onReconectar, onMais }: { c: any; acordaAs: string; recarregar: () => void; onReconectar: () => void; onMais: () => void }) {
  const [nota, setNota] = useState<string>(c.anotacao || "");
  const [notaAberta, setNotaAberta] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => { setNota(c.anotacao || ""); }, [c.anotacao]);

  const acao = async (qual: string, fn: () => Promise<any>) => {
    setOcupado(qual);
    try { await fn(); recarregar(); }
    catch (e: any) { toast.error(e.message); }
    finally { setOcupado(null); }
  };

  const cor = !c.conectado ? "bg-red-500" : c.atividade === "aquecendo" ? "bg-emerald-500" : c.atividade === "parado" ? "bg-amber-500" : "bg-sky-500";
  const vel = VELOCIDADES.find(v => v.id === c.velocidade.efetivo) ?? VELOCIDADES[1];
  const centro: Record<string, { icone: any; texto: string; cls: string }> = {
    desconectado: { icone: Bot, texto: "Em espera", cls: "text-muted-foreground" },
    em_espera: { icone: Bot, texto: "Em espera", cls: "text-muted-foreground" },
    aquecendo: { icone: Bot, texto: "Aquecendo", cls: "text-emerald-500" },
    descansando: { icone: null, texto: `Descansando · volta ${emQuanto(c.volta_em)}`, cls: "text-emerald-500" },
    dormindo: { icone: Moon, texto: `Dormindo · acorda às ${acordaAs}`, cls: "text-sky-400" },
    parado: { icone: Bot, texto: "Pausado", cls: "text-amber-500" },
  };
  const ct = centro[c.atividade] ?? centro.em_espera;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cor}`} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.nome}</p>
          {c.conectado && c.numero ? (
            <button type="button" className="flex items-center gap-1 font-mono text-xs text-sky-500"
              onClick={() => { navigator.clipboard.writeText(c.numero); setCopiado(true); setTimeout(() => setCopiado(false), 1200); }}>
              {c.numero} {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          ) : <p className="text-xs text-muted-foreground">Desconectado</p>}
        </div>
      </div>

      {/* Anotação */}
      <div className="rounded-md bg-amber-600/80 text-amber-50">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium" onClick={() => setNotaAberta(v => !v)}>
          <Pencil className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">{nota.trim() ? nota.split("\n")[0] : "Anotação aqui"}</span>
          <ChevronDown className={`h-4 w-4 transition ${notaAberta ? "rotate-180" : ""}`} />
        </button>
        {notaAberta && (
          <div className="px-2 pb-2">
            <Textarea value={nota} rows={3} maxLength={1000} className="border-amber-300/40 bg-amber-950/30 text-amber-50 placeholder:text-amber-100/60"
              placeholder="Ex.: chip da Ana, comprado em 20/10"
              onChange={(e) => setNota(e.target.value)}
              onBlur={() => { if (nota !== (c.anotacao || "")) void acao("nota", () => chamar(`/painel/${c.agente_id}/anotacao`, { method: "PUT", body: { anotacao: nota } })); }} />
          </div>
        )}
      </div>

      {c.proxy && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Proxy{c.proxy.pais ? ` · ${c.proxy.pais}` : ""}{c.proxy.org ? ` · ${c.proxy.org}` : ""}
        </p>
      )}

      {/* O que está fazendo agora */}
      <div className={`flex flex-col items-center gap-1 py-2 ${ct.cls}`}>
        {ct.icone ? <ct.icone className={`h-9 w-9 ${c.atividade === "aquecendo" ? "animate-pulse" : ""}`} /> : <span className="text-2xl font-bold tracking-widest">zᶻ</span>}
        <p className="text-sm font-medium">{ct.texto}</p>
      </div>

      {/* Fase e progresso */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-current" /> {c.fase_rotulo || "Sem fase"}</span>
          {c.enviadas_hoje > 0 && <span className="font-semibold text-emerald-500">+{c.enviadas_hoje}</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${c.progresso.percentual}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">Dia {c.progresso.dia} de {c.progresso.total_dias} · criado há {diasDesde(c.criado_em)} dias</p>
      </div>

      {/* Velocidade */}
      <div className="space-y-1">
        <div className="grid grid-cols-3 gap-1">
          {VELOCIDADES.map(v => (
            <button key={v.id} type="button" title={v.ajuda} disabled={c.velocidade.travado || !!ocupado}
              onClick={() => { if (v.id !== c.velocidade.escolhido) void acao("vel", () => chamar(`/controles/${c.agente_id}`, { method: "PUT", body: { velocidade: v.id } })); }}
              className="group space-y-1 text-left disabled:cursor-not-allowed">
              <span className={`block h-1.5 rounded-full ${c.velocidade.efetivo === v.id ? v.cor : "bg-muted group-hover:bg-muted-foreground/40"}`} />
              <span className={`block text-[11px] ${c.velocidade.efetivo === v.id ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{v.rotulo}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {c.velocidade.travado ? <span className="inline-flex items-start gap-1"><Lock className="mt-0.5 h-3 w-3 shrink-0" /> {c.velocidade.motivo}</span> : vel.ajuda}
        </p>
      </div>

      {/* Confirmação de leitura */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Confirmação de leitura</p>
          <p className="text-[11px] text-muted-foreground">
            {c.marcar_lida ? "Ligada: as mensagens do aquecimento ficam com o visto azul." : "Desligada: nada vira lido e seu celular continua recebendo as notificações."}
          </p>
        </div>
        <Switch checked={!!c.marcar_lida} disabled={!!ocupado}
          onCheckedChange={(v) => { void acao("lida", () => chamar(`/controles/${c.agente_id}`, { method: "PUT", body: { marcar_lida: v } })); }} />
      </div>

      {/* Aviso do momento */}
      {!c.conectado ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          Seu chip saiu do WhatsApp. Reconecte pelo código QR ou de 8 dígitos — o progresso é preservado.
        </div>
      ) : c.atividade === "descansando" ? (
        <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-xs text-sky-600 dark:text-sky-300">
          <b>Está descansando entre conversas</b> — é assim que o aquecimento imita gente. Volta sozinho {emQuanto(c.volta_em)}.
        </div>
      ) : c.atividade === "em_espera" ? (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          Sem parceiro de aquecimento ainda. Crie um par abaixo ou entre no Aquecimento Global.
        </div>
      ) : c.atividade === "parado" ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          Número em quarentena — o aquecimento está pausado até ele se recuperar.
        </div>
      ) : c.so_recebe ? (
        <div className="rounded-md border p-3 text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Fase de proteção: por enquanto só recebe ({c.so_recebe}).</div>
      ) : null}

      {/* Contatos */}
      {c.conectado && (
        <div className="space-y-1">
          <Button type="button" variant="outline" className="w-full" disabled={!!ocupado}
            onClick={() => void acao("contatos", async () => {
              const r = await chamar(`/painel/${c.agente_id}/contatos`, { method: "POST" });
              toast.success(`${r.enviados} contatos enviados para o próprio WhatsApp do chip — abra a conversa "Você" e salve.`);
            })}>
            {ocupado === "contatos" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><UserPlus className="mr-2 h-4 w-4" /> Receber arquivo de contatos no WhatsApp</>}
          </Button>
          {c.contatos_enviados_em && (
            <p className="flex items-center gap-1 text-[11px] text-emerald-600"><Check className="h-3 w-3" /> Arquivo enviado em {new Date(c.contatos_enviados_em).toLocaleDateString("pt-BR")}</p>
          )}
        </div>
      )}

      {!c.conectado && (
        <Button type="button" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={onReconectar}>
          <QrCode className="mr-2 h-4 w-4" /> Reconectar
        </Button>
      )}

      <button type="button" aria-label="Mais controles" className="mx-auto mt-auto rounded-md px-3 py-1 text-muted-foreground hover:bg-muted" onClick={onMais}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </Card>
  );
}

// ── Painel ──────────────────────────────────────────────────────────────────────────────────
export function PainelChips() {
  const [d, setD] = useState<any>(null);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [conectar, setConectar] = useState<AlvoConexao>(null);
  const [mais, setMais] = useState<any>(null);
  const [controles, setControles] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [statusChip, setStatusChip] = useState<any>(null);

  const carregar = async () => {
    setCarregando(true);
    try { setD(await chamar("/painel")); } catch { /* mantém o último estado */ } finally { setCarregando(false); }
  };
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, []);
  const carregarControles = async (agenteId: string) => {
    const r = await chamar("/controles").catch(() => null);
    setControles(r?.chips?.find((x: any) => x.agente_id === agenteId) ?? null);
  };
  useEffect(() => { if (mais) void carregarControles(mais.agente_id); else setControles(null); }, [mais]);

  if (!d) return null;
  const termo = busca.trim().toLowerCase();
  const chips = d.chips.filter((c: any) => !termo || `${c.nome} ${c.numero ?? ""}`.toLowerCase().includes(termo));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <p className="font-semibold">{d.resumo.total} WhatsApps</p>
          <p className="text-sm text-emerald-600">{d.resumo.de_pe} de pé</p>
          {d.resumo.com_problema > 0 && <p className="text-sm text-red-500">{d.resumo.com_problema} com problema</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 lg:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar WhatsApp…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Button type="button" variant="outline" size="icon" aria-label="Atualizar" onClick={carregar} disabled={carregando}>
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
          </Button>
          <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setConectar({ modo: "novo" })}>
            <Plus className="mr-1 h-4 w-4" /> Novo WhatsApp
          </Button>
        </div>
      </div>

      {chips.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {d.chips.length ? "Nenhum WhatsApp com esse nome." : "Nenhum WhatsApp ainda. Clique em \"Novo WhatsApp\" para conectar o primeiro."}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {chips.map((c: any) => (
            <CardChip key={c.agente_id} c={c} acordaAs={d.resumo.acorda} recarregar={carregar}
              onReconectar={() => setConectar({ modo: "reconectar", chip: c })} onMais={() => setMais(c)} />
          ))}
        </div>
      )}

      <ConectarChip alvo={conectar} onFechar={(ok) => { setConectar(null); if (ok) void carregar(); }} />

      <Dialog open={!!mais} onOpenChange={(v) => !v && setMais(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mais?.nome}</DialogTitle>
            <DialogDescription>Ligue e desligue o que este número faz no aquecimento. Tudo vem ligado.</DialogDescription>
          </DialogHeader>
          {!controles ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
            <ListaControles chip={controles} desabilitado={salvando} ocultar={["marcar_lida"]}
              onGerenciarStatus={() => setStatusChip(controles)}
              alterar={async (m) => {
                setSalvando(true);
                try { await chamar(`/controles/${controles.agente_id}`, { method: "PUT", body: m }); await carregarControles(controles.agente_id); void carregar(); }
                catch (e: any) { toast.error(e.message); }
                finally { setSalvando(false); }
              }} />
          )}
        </DialogContent>
      </Dialog>
      <StatusMaturador chip={statusChip} aberto={!!statusChip} onFechar={(mudou) => { setStatusChip(null); if (mudou && mais) void carregarControles(mais.agente_id); }} />
    </div>
  );
}

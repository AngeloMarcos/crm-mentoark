import { useEffect, useMemo, useRef, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Send, Play, Pause, Square, Trash2, Copy, FileText, RefreshCw, AlertCircle, AlertTriangle,
  Upload, ChevronDown, Plus, X, Settings2, Link2, CheckCircle2, XCircle, Activity, Clock, Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { normalizarTelefoneBR } from "@/lib/phone";

type DisparoStatus = "rascunho" | "em_andamento" | "pausado" | "concluido" | "cancelado";

interface Disparo {
  id: string;
  user_id: string;
  nome: string;
  status: DisparoStatus;
  lista_id: string | null;
  mensagem_template: string | null;
  total_leads: number;
  enviados: number;
  falhas: number;
  intervalo_min: number;
  intervalo_max: number;
  pausa_a_cada: number;
  pausa_duracao: number;
  horario_inicio: string;
  horario_fim: string;
  data_inicio: string | null;
  data_fim: string | null;
  created_at: string;
}

interface Lista { id: string; nome: string; }
interface Contato { id?: string; nome: string; telefone: string | null; empresa?: string | null; }
interface DisparoLog {
  id: string; disparo_id: string; contato_id: string | null; nome: string | null;
  telefone: string; mensagem_enviada: string | null; status: string; tentativas: number;
  erro: string | null; created_at: string; enviado_at: string | null;
}
interface EvolutionCfg { id: string; instancia: string; url: string; api_key: string; status: string; }

const statusConfig: Record<DisparoStatus, { label: string; className: string }> = {
  rascunho:     { label: "Rascunho",     className: "bg-muted text-muted-foreground" },
  em_andamento: { label: "Em andamento", className: "bg-info/20 text-info border-info/30" },
  pausado:      { label: "Pausado",      className: "bg-warning/20 text-warning border-warning/30" },
  concluido:    { label: "Concluído",    className: "bg-success/20 text-success border-success/30" },
  cancelado:    { label: "Cancelado",    className: "bg-destructive/20 text-destructive border-destructive/30" },
};

function formatWhatsappNumber(raw: string | null | undefined): string | null {
  // Mantém compatibilidade com o CSV upload — usa o normalizador BR rigoroso.
  const r = normalizarTelefoneBR(raw);
  return r.valido ? r.jid : null;
}

// Extrai apenas o primeiro nome de forma inteligente:
// - quebra em vírgula / "e" / "&" / "/" (nomes concatenados)
// - ignora partículas (de, da, do, dos, das, e)
// - capitaliza corretamente
const PARTICULAS = new Set(["de", "da", "do", "dos", "das", "e", "del", "la", "y"]);
const capitalizar = (s: string) =>
  s.length <= 2 ? s.toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export const extrairPrimeiroNome = (raw?: string | null): string => {
  if (!raw) return "";
  // Pega só o primeiro "contato" antes de vírgula, "/", "&", " e " ou " E "
  const primeiroContato = raw
    .split(/[,\/&]| (?:e|E|y|Y) /)[0]
    .trim();
  if (!primeiroContato) return "";
  // Pega o primeiro token que não seja partícula
  const tokens = primeiroContato.split(/\s+/).filter(Boolean);
  const primeiro = tokens.find((t) => !PARTICULAS.has(t.toLowerCase())) ?? tokens[0] ?? "";
  return capitalizar(primeiro);
};

const renderTemplate = (tpl: string, c: { nome?: string | null; empresa?: string | null; telefone?: string | null }) => {
  const nomeCompleto = (c.nome ?? "").trim();
  const primeiroNome = extrairPrimeiroNome(nomeCompleto);
  return (tpl || "")
    .split("{{primeiro_nome}}").join(primeiroNome)
    .split("{{nome}}").join(primeiroNome)        // {{nome}} agora também usa só o primeiro nome
    .split("{{nome_completo}}").join(nomeCompleto)
    .split("{{empresa}}").join(c.empresa ?? "")
    .split("{{telefone}}").join(c.telefone ?? "");
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inWindow = (start: string, end: string) => {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
};

/** Editor de intervalo ao vivo — usa estado local para evitar salvar a cada tecla. */
function IntervaloEditor({
  disparoId,
  intervaloMin,
  intervaloMax,
  onUpdate,
}: {
  disparoId: string;
  intervaloMin: number;
  intervaloMax: number;
  onUpdate: (min: number, max: number) => void;
}) {
  const [minStr, setMinStr] = useState(String(intervaloMin));
  const [maxStr, setMaxStr] = useState(String(intervaloMax));
  const [saving, setSaving] = useState(false);

  // Sincroniza quando o disparo carregado muda externamente
  useEffect(() => { setMinStr(String(intervaloMin)); }, [intervaloMin]);
  useEffect(() => { setMaxStr(String(intervaloMax)); }, [intervaloMax]);

  const persistir = async (min: number, max: number) => {
    const minClamp = Math.max(1, Math.min(3600, Math.floor(min) || 1));
    const maxClamp = Math.max(minClamp, Math.min(3600, Math.floor(max) || minClamp));
    setMinStr(String(minClamp));
    setMaxStr(String(maxClamp));
    setSaving(true);
    const { error } = await api
      .from("disparos")
      .update({ intervalo_min: minClamp, intervalo_max: maxClamp })
      .eq("id", disparoId);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar intervalo: " + error.message); return; }
    onUpdate(minClamp, maxClamp);
    toast.success(`Intervalo atualizado: ${minClamp}s – ${maxClamp}s`);
  };

  const aplicarPreset = (min: number, max: number) => persistir(min, max);

  const presets = [
    { label: "30s–1min", min: 30, max: 60 },
    { label: "1–3min", min: 60, max: 180 },
    { label: "3–5min", min: 180, max: 300 },
    { label: "5–10min", min: 300, max: 600 },
  ];

  return (
    <div className="rounded-md border border-border/60 p-3 bg-muted/10 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          Intervalo entre mensagens
        </div>
        {saving && <span className="text-[10px] text-info">salvando...</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Mín (segundos)</Label>
          <Input
            type="number"
            min={1}
            max={3600}
            value={minStr}
            onChange={(e) => setMinStr(e.target.value)}
            onBlur={() => persistir(Number(minStr), Number(maxStr))}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Máx (segundos)</Label>
          <Input
            type="number"
            min={1}
            max={3600}
            value={maxStr}
            onChange={(e) => setMaxStr(e.target.value)}
            onBlur={() => persistir(Number(minStr), Number(maxStr))}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-8"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const ativo = intervaloMin === p.min && intervaloMax === p.max;
          return (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={ativo ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => aplicarPreset(p.min, p.max)}
            >
              {p.label}
            </Button>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Aplica no <strong>próximo envio</strong>. Pressione Enter ou clique fora para salvar.
      </p>
    </div>
  );
}

export default function DisparosPage() {
  const { user } = useAuth();

  // Dados base
  const [listas, setListas] = useState<Lista[]>([]);
  const [disparos, setDisparos] = useState<Disparo[]>([]);
  const [evolution, setEvolution] = useState<EvolutionCfg | null>(null);
  const [loading, setLoading] = useState(true);

  // Form — coluna esquerda
  const [nomeCampanha, setNomeCampanha] = useState("");
  const [origemLeads, setOrigemLeads] = useState<"lista" | "csv">("lista");
  const [listaId, setListaId] = useState<string>("");
  const [listaContatos, setListaContatos] = useState<Contato[]>([]);
  const [csvContatos, setCsvContatos] = useState<Contato[]>([]);
  const [csvFileName, setCsvFileName] = useState<string>("");

  const [variacoes, setVariacoes] = useState<string[]>(["Olá {{nome}}, tudo bem?"]);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const [intervaloMin, setIntervaloMin] = useState(45);
  const [intervaloMax, setIntervaloMax] = useState(90);
  const [pausaACada, setPausaACada] = useState(20);
  const [pausaDuracao, setPausaDuracao] = useState(5);
  const [horarioInicio, setHorarioInicio] = useState("08:00");
  const [horarioFim, setHorarioFim] = useState("20:00");

  // Painel direito — disparo ativo
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeDisparo = useMemo(
    () => disparos.find((d) => d.id === activeId) ?? null,
    [disparos, activeId],
  );
  const [activeLogs, setActiveLogs] = useState<DisparoLog[]>([]);

  // Logs dialog (histórico)
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsDisparo, setLogsDisparo] = useState<Disparo | null>(null);
  const [logs, setLogs] = useState<DisparoLog[]>([]);
  const [logFilter, setLogFilter] = useState<string>("todos");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // Refs do motor de execução (1 disparo ativo por vez)
  const lockRef = useRef(false);                            // trava reentrância
  const pauseFlagRef = useRef<Set<string>>(new Set());      // disparos com pedido de pausa
  const timerRef = useRef<number | null>(null);             // setTimeout do próximo envio
  const countdownRef = useRef<number | null>(null);         // setInterval do contador
  const lotePorDisparoRef = useRef<Record<string, number>>({}); // mensagens desde a última pausa

  // Countdown visível para próximo envio (segundos)
  const [proximoEnvio, setProximoEnvio] = useState(0);

  const FILA_KEY = (id: string) => `disparo_fila_${id}`;
  const lerEstadoLocal = (id: string): { lote: number; nextAt: number | null } => {
    try { return JSON.parse(localStorage.getItem(FILA_KEY(id)) ?? "") || { lote: 0, nextAt: null }; }
    catch { return { lote: 0, nextAt: null }; }
  };
  const salvarEstadoLocal = (id: string, st: { lote: number; nextAt: number | null }) => {
    try { localStorage.setItem(FILA_KEY(id), JSON.stringify(st)); } catch {}
  };
  const limparEstadoLocal = (id: string) => { try { localStorage.removeItem(FILA_KEY(id)); } catch {} };

  const limparTimers = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };
  const iniciarCountdown = (segundos: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    let restante = Math.ceil(segundos);
    setProximoEnvio(restante);
    countdownRef.current = window.setInterval(() => {
      restante -= 1;
      setProximoEnvio(restante > 0 ? restante : 0);
      if (restante <= 0 && countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    }, 1000);
  };

  // -------- Carregamento inicial --------
  const carregar = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: ls }, { data: ds }, { data: ev }] = await Promise.all([
      api.from("listas").select("id, nome").eq("user_id", user.id).order("nome"),
      api.from("disparos").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      api.from("integracoes_config").select("id, instancia, url, api_key, status")
        .eq("user_id", user.id).eq("tipo", "evolution").limit(1).maybeSingle(),
    ]);
    setListas((ls as Lista[]) ?? []);
    setDisparos((ds as Disparo[]) ?? []);
    setEvolution((ev as EvolutionCfg | null) ?? null);
    setLoading(false);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [user?.id]);

  // -------- Lista selecionada → contatos --------
  useEffect(() => {
    const run = async () => {
      if (!user || !listaId) { setListaContatos([]); return; }
      const { data } = await api
        .from("contatos")
        .select("id, nome, telefone, empresa")
        .eq("user_id", user.id).eq("lista_id", listaId)
        .not("telefone", "is", null);
      setListaContatos((data as Contato[]) ?? []);
    };
    run();
  }, [listaId, user?.id]);

  // -------- CSV upload --------
  const handleCsvUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const parsed: Contato[] = rows
        .map((r) => {
          const nome = String(r.nome ?? r.Nome ?? r.NOME ?? r.name ?? "").trim();
          const telRaw = String(r.telefone ?? r.Telefone ?? r.TELEFONE ?? r.phone ?? r.celular ?? "").trim();
          const empresa = String(r.empresa ?? r.Empresa ?? r.company ?? "").trim() || null;
          const tel = formatWhatsappNumber(telRaw);
          return tel ? { nome: nome || tel, telefone: tel, empresa } : null;
        })
        .filter(Boolean) as Contato[];
      setCsvContatos(parsed);
      setCsvFileName(file.name);
      toast.success(`${parsed.length} contatos válidos importados`);
    } catch (err: any) {
      toast.error("Erro ao ler arquivo: " + err.message);
    }
  };

  const contatosSelecionados: Contato[] = origemLeads === "lista" ? listaContatos : csvContatos;

  // -------- Variáveis chip → insere no textarea --------
  const inserirVariavel = (idx: number, varName: string) => {
    const ta = textareaRefs.current[idx];
    if (!ta) {
      setVariacoes((v) => v.map((m, i) => (i === idx ? m + varName : m)));
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const next = ta.value.slice(0, start) + varName + ta.value.slice(end);
    setVariacoes((v) => v.map((m, i) => (i === idx ? next : m)));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + varName.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const addVariacao = () => {
    if (variacoes.length >= 5) { toast.info("Máximo de 5 variações"); return; }
    setVariacoes((v) => [...v, ""]);
  };
  const removerVariacao = (idx: number) => {
    if (variacoes.length === 1) return;
    setVariacoes((v) => v.filter((_, i) => i !== idx));
  };

  // -------- Criar fila e iniciar --------
  const podeIniciar = !!nomeCampanha.trim()
    && contatosSelecionados.length > 0
    && variacoes.some((v) => v.trim().length > 0)
    && intervaloMin <= intervaloMax;

  const criarEIniciar = async () => {
    if (!user || !podeIniciar) return;
    if (!evolution) { toast.error("Configure a Evolution API em Integrações"); return; }

    // 1) cria disparo
    const primeira = variacoes.find((v) => v.trim()) ?? "";
    const { data: created, error } = await api.from("disparos").insert({
      user_id: user.id,
      nome: nomeCampanha,
      lista_id: origemLeads === "lista" ? listaId : null,
      mensagem_template: primeira,
      total_leads: contatosSelecionados.length,
      intervalo_min: intervaloMin,
      intervalo_max: intervaloMax,
      pausa_a_cada: pausaACada,
      pausa_duracao: pausaDuracao,
      horario_inicio: horarioInicio,
      horario_fim: horarioFim,
      status: "rascunho",
    }).select().single();
    if (error || !created) { toast.error(error?.message ?? "Erro ao criar"); return; }

    // 2) gera logs (rodízio aleatório de variações) — pré-valida telefones
    //    + deduplica por telefone normalizado (mantém apenas a 1ª ocorrência)
    const ativas = variacoes.filter((v) => v.trim());
    let invalidos = 0;
    let duplicados = 0;
    const vistos = new Set<string>();
    const rows: any[] = [];

    for (const c of contatosSelecionados) {
      const tpl = ativas[Math.floor(Math.random() * ativas.length)];
      const norm = normalizarTelefoneBR(c.telefone);

      if (!norm.valido) {
        invalidos++;
        rows.push({
          disparo_id: created.id,
          contato_id: c.id ?? null,
          user_id: user.id,
          nome: c.nome,
          telefone: (c.telefone ?? "").toString(),
          mensagem_enviada: renderTemplate(tpl, c),
          status: "invalido",
          erro: norm.motivo ?? "Telefone inválido",
        });
        continue;
      }

      // Dedupe — se o mesmo telefone já entrou na fila, marca como duplicado
      if (vistos.has(norm.jid!)) {
        duplicados++;
        rows.push({
          disparo_id: created.id,
          contato_id: c.id ?? null,
          user_id: user.id,
          nome: c.nome,
          telefone: norm.jid!,
          mensagem_enviada: null,
          status: "duplicado",
          erro: "Telefone duplicado — já existe na fila",
        });
        continue;
      }
      vistos.add(norm.jid!);

      rows.push({
        disparo_id: created.id,
        contato_id: c.id ?? null,
        user_id: user.id,
        nome: c.nome,
        telefone: norm.jid!,
        mensagem_enviada: renderTemplate(tpl, { ...c, telefone: norm.jid }),
        status: "pending",
      });
    }

    if (rows.length) await api.from("disparo_logs").insert(rows);
    // Pré-contabiliza inválidos + duplicados como falhas no agregado
    const preFalhas = invalidos + duplicados;
    if (preFalhas > 0) {
      await api.from("disparos").update({ falhas: preFalhas }).eq("id", created.id);
    }

    const validos = rows.length - invalidos - duplicados;
    const partes: string[] = [`🚀 ${validos} enviados para fila`];
    if (duplicados > 0) partes.push(`${duplicados} duplicados ignorados`);
    if (invalidos > 0) partes.push(`${invalidos} telefones inválidos`);
    toast.success(partes.join(" · "));
    await carregar();
    setActiveId(created.id);
    iniciar(created as Disparo);
  };

  // -------- Execução --------
  const enviarMensagem = async (cfg: EvolutionCfg, telefone: string, texto: string) => {
    const baseUrl = cfg.url.replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/message/sendText/${cfg.instancia}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.api_key,
      },
      body: JSON.stringify({ number: telefone, text: texto }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "sem detalhe");
      throw new Error(`Evolution API ${res.status}: ${body}`);
    }
  };

  const setStatus = async (id: string, status: DisparoStatus, extras: Record<string, unknown> = {}) => {
    await api.from("disparos").update({ status, ...extras }).eq("id", id);
  };

  // Processa o próximo log pendente do disparo (recursivo via setTimeout)
  const processarProximo = async (dIn: Disparo) => {
    if (lockRef.current) return;
    if (pauseFlagRef.current.has(dIn.id)) return;
    if (!evolution) { toast.error("Evolution API não configurada"); return; }

    // 🔄 Sempre recarrega configuração mais recente do disparo (intervalos ao vivo)
    const { data: live } = await api
      .from("disparos")
      .select("*")
      .eq("id", dIn.id)
      .maybeSingle();
    const d: Disparo = (live as Disparo) ?? dIn;

    // Se foi cancelado/pausado/concluído via UI ou outra aba, para aqui
    if (d.status === "cancelado" || d.status === "pausado" || d.status === "concluido") {
      limparTimers();
      setProximoEnvio(0);
      return;
    }

    // Janela de horário
    if (!inWindow(d.horario_inicio, d.horario_fim)) {
      toast.info("Fora da janela de horário — aguardando 1 min");
      iniciarCountdown(60);
      timerRef.current = window.setTimeout(() => processarProximo(d), 60_000);
      return;
    }

    // Pausa anti-bloqueio (a cada N mensagens)
    const lote = lotePorDisparoRef.current[d.id] ?? lerEstadoLocal(d.id).lote ?? 0;
    if (d.pausa_a_cada > 0 && lote >= d.pausa_a_cada) {
      lotePorDisparoRef.current[d.id] = 0;
      const ms = Math.max(1, d.pausa_duracao) * 60_000;
      salvarEstadoLocal(d.id, { lote: 0, nextAt: Date.now() + ms });
      toast.info(`⏸️ Pausa anti-bloqueio: ${d.pausa_duracao} min`);
      iniciarCountdown(ms / 1000);
      timerRef.current = window.setTimeout(() => processarProximo(d), ms);
      return;
    }

    // Próximo pendente
    const { data: pendings } = await api
      .from("disparo_logs").select("*")
      .eq("disparo_id", d.id).eq("status", "pending")
      .order("created_at").limit(1);
    const log = pendings?.[0] as DisparoLog | undefined;
    if (!log) {
      limparTimers();
      limparEstadoLocal(d.id);
      await setStatus(d.id, "concluido", { data_fim: new Date().toISOString() });
      toast.success(`✅ Disparo "${d.nome}" concluído`);
      carregar(); refreshActive(d.id);
      return;
    }

    // Trava + envio
    lockRef.current = true;
    await api.from("disparo_logs").update({ status: "sending", tentativas: log.tentativas + 1 }).eq("id", log.id);
    let sucesso = false;
    let erroMsg: string | null = null;
    try {
      await enviarMensagem(evolution, log.telefone, log.mensagem_enviada ?? "");
      sucesso = true;
    } catch (err: any) {
      erroMsg = err?.message ?? "erro";
    }

    if (sucesso) {
      await api.from("disparo_logs").update({ status: "sent", enviado_at: new Date().toISOString() }).eq("id", log.id);
      const { data: cur } = await api.from("disparos").select("enviados").eq("id", d.id).single();
      await api.from("disparos").update({ enviados: ((cur as any)?.enviados ?? 0) + 1 }).eq("id", d.id);
    } else {
      await api.from("disparo_logs").update({ status: "failed", erro: erroMsg }).eq("id", log.id);
      const { data: cur } = await api.from("disparos").select("falhas").eq("id", d.id).single();
      await api.from("disparos").update({ falhas: ((cur as any)?.falhas ?? 0) + 1 }).eq("id", d.id);
    }
    lockRef.current = false;

    lotePorDisparoRef.current[d.id] = (lotePorDisparoRef.current[d.id] ?? 0) + 1;
    refreshActive(d.id);

    if (pauseFlagRef.current.has(d.id)) return;

    // Sortear intervalo e agendar próximo (clamp defensivo: min>=1, max>=min)
    const minS = Math.max(1, Number(d.intervalo_min) || 1);
    const maxS = Math.max(minS, Number(d.intervalo_max) || minS);
    const intervalo = Math.floor(Math.random() * (maxS - minS + 1)) + minS;
    const ms = intervalo * 1000;
    salvarEstadoLocal(d.id, { lote: lotePorDisparoRef.current[d.id] ?? 0, nextAt: Date.now() + ms });
    iniciarCountdown(intervalo);
    timerRef.current = window.setTimeout(() => processarProximo(d), ms);
  };

  const iniciar = async (d: Disparo) => {
    if (!user) return;
    if (!evolution) { toast.error("Configure a Evolution API em Integrações"); return; }

    limparTimers();
    pauseFlagRef.current.delete(d.id);
    lockRef.current = false;
    if (lotePorDisparoRef.current[d.id] === undefined) {
      lotePorDisparoRef.current[d.id] = lerEstadoLocal(d.id).lote ?? 0;
    }

    await setStatus(d.id, "em_andamento", { data_inicio: d.data_inicio ?? new Date().toISOString() });
    setActiveId(d.id);
    await carregar();
    // dispara imediatamente o primeiro
    processarProximo({ ...d, status: "em_andamento" });
  };

  const refreshActive = async (id: string) => {
    const [{ data: dsp }, { data: lgs }] = await Promise.all([
      api.from("disparos").select("*").eq("id", id).single(),
      api.from("disparo_logs").select("*").eq("disparo_id", id).order("created_at", { ascending: true }),
    ]);
    if (dsp) setDisparos((arr) => arr.map((x) => (x.id === id ? (dsp as Disparo) : x)));
    setActiveLogs((lgs as DisparoLog[]) ?? []);
  };

  // Auto-refresh do painel ativo enquanto rodando
  useEffect(() => {
    if (!activeId || !activeDisparo || activeDisparo.status !== "em_andamento") return;
    const t = setInterval(() => refreshActive(activeId), 4000);
    return () => clearInterval(t);
  }, [activeId, activeDisparo?.status]);

  useEffect(() => { if (activeId) refreshActive(activeId); /* eslint-disable-next-line */ }, [activeId]);

  const pausar = async (d: Disparo) => {
    pauseFlagRef.current.add(d.id);
    limparTimers();
    setProximoEnvio(0);
    await setStatus(d.id, "pausado");
    toast.info("Disparo pausado");
    carregar();
  };
  const cancelar = async (d: Disparo) => {
    pauseFlagRef.current.add(d.id);
    limparTimers();
    setProximoEnvio(0);
    limparEstadoLocal(d.id);
    await setStatus(d.id, "cancelado", { data_fim: new Date().toISOString() });
    toast.info("Disparo cancelado");
    carregar();
  };

  // Limpa timers ao desmontar
  useEffect(() => () => { limparTimers(); }, []);
  const excluir = async (id: string) => {
    const { error } = await api.from("disparos").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Campanha excluída");
    setConfirmDeleteId(null);
    if (activeId === id) setActiveId(null);
    carregar();
  };
  const duplicar = async (d: Disparo) => {
    if (!user) return;
    const { error } = await api.from("disparos").insert({
      user_id: user.id, nome: `${d.nome} (cópia)`, lista_id: d.lista_id,
      mensagem_template: d.mensagem_template, intervalo_min: d.intervalo_min, intervalo_max: d.intervalo_max,
      pausa_a_cada: d.pausa_a_cada, pausa_duracao: d.pausa_duracao,
      horario_inicio: d.horario_inicio, horario_fim: d.horario_fim, total_leads: d.total_leads,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Campanha duplicada");
    carregar();
  };

  // -------- Logs dialog --------
  const carregarLogs = async (disparoId: string) => {
    const { data } = await api.from("disparo_logs").select("*").eq("disparo_id", disparoId).order("created_at");
    setLogs((data as DisparoLog[]) ?? []);
  };
  const abrirLogs = async (d: Disparo) => {
    setLogsDisparo(d); setLogFilter("todos");
    await carregarLogs(d.id);
    setLogsOpen(true);
  };
  const reenviarFalhas = async () => {
    if (!logsDisparo) return;
    const { error } = await api.from("disparo_logs")
      .update({ status: "pending", erro: null }).eq("disparo_id", logsDisparo.id).eq("status", "failed");
    if (error) { toast.error(error.message); return; }
    toast.success("Falhas resetadas para pending");
    await carregarLogs(logsDisparo.id);
  };
  const filteredLogs = useMemo(
    () => (logFilter === "todos" ? logs : logs.filter((l) => l.status === logFilter)),
    [logs, logFilter],
  );
  const logStatusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-muted text-muted-foreground",
      sending: "bg-info/20 text-info border-info/30",
      sent: "bg-success/20 text-success border-success/30",
      failed: "bg-destructive/20 text-destructive border-destructive/30",
      invalido: "bg-warning/20 text-warning border-warning/30",
      duplicado: "bg-warning/20 text-warning border-warning/30",
      skipped: "bg-warning/20 text-warning border-warning/30",
    };
    const label: Record<string, string> = { invalido: "inválido", duplicado: "duplicado" };
    return <Badge variant="outline" className={map[s] ?? ""}>{label[s] ?? s}</Badge>;
  };

  const previewContato = contatosSelecionados[0];
  const previewMensagem = previewContato ? renderTemplate(variacoes[0] ?? "", previewContato) : (variacoes[0] ?? "");

  const evoOk = !!evolution && (evolution.status === "ativo" || evolution.status === "conectado");

  // -------- Render --------
  return (
    <CRMLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Disparos em Massa</h1>
              <p className="text-sm text-muted-foreground">
                Envie mensagens WhatsApp em lote com proteção anti-ban
              </p>
            </div>
          </div>
        </div>

        {/* Histórico colapsável */}
        <Accordion type="single" collapsible defaultValue={disparos.length === 0 ? undefined : ""}>
          <AccordionItem value="hist" className="border border-border/60 rounded-lg">
            <AccordionTrigger className="px-4 hover:no-underline">
              <span className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" /> Disparos anteriores
                <Badge variant="outline" className="ml-2">{disparos.length}</Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-0">
              {loading ? (
                <div className="px-4 pb-4 text-sm text-muted-foreground">Carregando…</div>
              ) : disparos.length === 0 ? (
                <div className="px-4 pb-4 text-sm text-muted-foreground">Nenhum disparo ainda.</div>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Progresso</TableHead>
                        <TableHead>Falhas</TableHead>
                        <TableHead>Criada</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {disparos.map((d) => {
                        const sc = statusConfig[d.status];
                        const total = d.total_leads || 0;
                        const done = d.enviados + d.falhas;
                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.nome}</TableCell>
                            <TableCell><Badge variant="outline" className={sc.className}>{sc.label}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{done}/{total}</TableCell>
                            <TableCell className="text-xs text-destructive">{d.falhas || 0}</TableCell>
                            <TableCell className="text-xs">{new Date(d.created_at).toLocaleDateString("pt-BR")}</TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex gap-1">
                                {(d.status === "pausado" || d.status === "rascunho") && (
                                  <Button size="sm" variant="ghost" onClick={() => iniciar(d)} title="Iniciar/Retomar"><Play className="h-4 w-4" /></Button>
                                )}
                                {d.status === "em_andamento" && (
                                  <Button size="sm" variant="ghost" onClick={() => pausar(d)} title="Pausar"><Pause className="h-4 w-4" /></Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => { setActiveId(d.id); }} title="Monitorar"><Activity className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => abrirLogs(d)} title="Logs"><FileText className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => duplicar(d)} title="Duplicar"><Copy className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(d.id)} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Grid 2 colunas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* COLUNA ESQUERDA — FORMULÁRIO */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Nova campanha de disparo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Nome */}
              <div className="space-y-2">
                <Label>Nome da campanha *</Label>
                <Input value={nomeCampanha} onChange={(e) => setNomeCampanha(e.target.value)} placeholder="Ex: Promoção Black Friday" />
              </div>

              {/* 4a. Origem dos leads */}
              <div className="space-y-3">
                <Label>Origem dos leads *</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={origemLeads === "lista" ? "default" : "outline"} onClick={() => setOrigemLeads("lista")}>Usar lista</Button>
                  <Button type="button" size="sm" variant={origemLeads === "csv" ? "default" : "outline"} onClick={() => setOrigemLeads("csv")}>Importar CSV</Button>
                </div>

                {origemLeads === "lista" ? (
                  <div className="space-y-2">
                    <Select value={listaId} onValueChange={setListaId}>
                      <SelectTrigger><SelectValue placeholder="Selecione uma lista de contatos" /></SelectTrigger>
                      <SelectContent>
                        {listas.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">Nenhuma lista cadastrada</div>
                        ) : listas.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {listaId && (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                        {listaContatos.length} contatos encontrados
                      </Badge>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="flex items-center justify-center gap-2 border border-dashed border-border/60 rounded-md p-4 cursor-pointer hover:border-primary/40 transition-colors">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {csvFileName ? `${csvFileName} — ${csvContatos.length} contatos` : "Clique para enviar CSV/XLSX (colunas: nome, telefone, empresa)"}
                      </span>
                      <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])} />
                    </label>
                  </div>
                )}

                {/* Preview 5 primeiros */}
                {contatosSelecionados.length > 0 && (
                  <div className="border border-border/60 rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-9">Nome</TableHead>
                          <TableHead className="h-9">Telefone</TableHead>
                          <TableHead className="h-9">Empresa</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contatosSelecionados.slice(0, 5).map((c, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-2">{c.nome}</TableCell>
                            <TableCell className="py-2 font-mono text-xs">{c.telefone}</TableCell>
                            <TableCell className="py-2 text-xs text-muted-foreground">{c.empresa ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {contatosSelecionados.length > 5 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30">
                        +{contatosSelecionados.length - 5} contatos adicionais
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 4b. Mensagem + variações */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label>Mensagem * {variacoes.length > 1 && <span className="text-xs text-muted-foreground ml-2">({variacoes.length} variações)</span>}</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addVariacao} disabled={variacoes.length >= 5}>
                    <Plus className="h-3.5 w-3.5" /> Adicionar variação
                  </Button>
                </div>

                {variacoes.map((msg, idx) => (
                  <Card key={idx} className="border-border/60">
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Versão {idx + 1}</span>
                        {variacoes.length > 1 && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => removerVariacao(idx)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <Textarea
                        ref={(el) => { textareaRefs.current[idx] = el; }}
                        value={msg}
                        onChange={(e) => setVariacoes((v) => v.map((m, i) => (i === idx ? e.target.value : m)))}
                        placeholder="Use {{nome}}, {{empresa}} como variáveis"
                        rows={4}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {["{{nome}}", "{{nome_completo}}", "{{empresa}}", "{{telefone}}"].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => inserirVariavel(idx, v)}
                            className="text-xs px-2 py-0.5 rounded-md border border-border/60 bg-muted/40 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-colors font-mono"
                          >
                            {v}
                          </button>
                        ))}
                        <span className="ml-auto text-xs text-muted-foreground">{msg.length} caracteres</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {previewContato && (
                  <div className="border border-border/60 rounded-md p-3 bg-muted/20">
                    <p className="text-xs text-muted-foreground mb-1">Preview com {previewContato.nome}:</p>
                    <p className="text-sm whitespace-pre-wrap">{previewMensagem}</p>
                  </div>
                )}
              </div>

              {/* 4c. Anti-bloqueio */}
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between p-3 rounded-md border border-border/60 hover:bg-muted/40 transition-colors group">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Settings2 className="h-4 w-4" /> Configurações Anti-Bloqueio
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  {/* Intervalos */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Intervalo mínimo entre mensagens</Label>
                      <Input type="number" min={10} max={300} value={intervaloMin}
                        onChange={(e) => setIntervaloMin(Math.max(10, Math.min(300, Number(e.target.value) || 10)))}
                        className="w-20 h-8 text-right" />
                    </div>
                    <Slider min={10} max={300} step={5} value={[intervaloMin]} onValueChange={(v) => setIntervaloMin(v[0])} />
                    <p className="text-xs text-muted-foreground">{intervaloMin} segundos</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Intervalo máximo entre mensagens</Label>
                      <Input type="number" min={10} max={600} value={intervaloMax}
                        onChange={(e) => setIntervaloMax(Math.max(10, Math.min(600, Number(e.target.value) || 10)))}
                        className="w-20 h-8 text-right" />
                    </div>
                    <Slider min={10} max={600} step={5} value={[intervaloMax]} onValueChange={(v) => setIntervaloMax(v[0])} />
                    <p className="text-xs text-muted-foreground">{intervaloMax} segundos</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs">Pausar a cada (mensagens)</Label>
                      <Input type="number" min={0} value={pausaACada} onChange={(e) => setPausaACada(Number(e.target.value) || 0)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Duração da pausa (min)</Label>
                      <Input type="number" min={0} value={pausaDuracao} onChange={(e) => setPausaDuracao(Number(e.target.value) || 0)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Horário início</Label>
                      <Input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Horário fim</Label>
                      <Input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* 4d. Credenciais Evolution */}
              {evolution ? (
                <div className="flex items-center justify-between p-3 rounded-md border border-border/60 bg-muted/20">
                  <div className="flex items-center gap-2 text-sm">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    <span>Usando instância: <span className="font-mono text-xs">{evolution.instancia}</span></span>
                  </div>
                  <Badge variant="outline" className={evoOk ? "bg-success/20 text-success border-success/30" : "bg-destructive/20 text-destructive border-destructive/30"}>
                    {evoOk ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    {evolution.status}
                  </Badge>
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Evolution API não configurada</AlertTitle>
                  <AlertDescription>
                    Configure a integração para começar a disparar.{" "}
                    <Link to="/integracoes" className="underline font-medium">Ir para Integrações →</Link>
                  </AlertDescription>
                </Alert>
              )}

              {/* 4e. Botão */}
              <Button className="w-full" size="lg" disabled={!podeIniciar || !evolution} onClick={criarEIniciar}>
                <Play className="h-4 w-4" /> Criar Fila e Iniciar
              </Button>
              {!podeIniciar && (
                <p className="text-xs text-muted-foreground text-center">
                  Preencha nome, selecione leads e escreva ao menos uma mensagem.
                </p>
              )}
            </CardContent>
          </Card>

          {/* COLUNA DIREITA — MONITORAMENTO */}
          <Card className="border-border/60 lg:sticky lg:top-4 self-start">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" /> Monitoramento em tempo real
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeDisparo ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Nenhum disparo selecionado.</p>
                  <p className="text-xs mt-1">Crie uma campanha ou clique em <Activity className="inline h-3 w-3" /> num histórico.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{activeDisparo.nome}</h3>
                      <p className="text-xs text-muted-foreground">
                        Iniciada em {activeDisparo.data_inicio ? new Date(activeDisparo.data_inicio).toLocaleString("pt-BR") : "—"}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusConfig[activeDisparo.status].className}>
                      {statusConfig[activeDisparo.status].label}
                    </Badge>
                  </div>

                  {(() => {
                    const total = activeDisparo.total_leads || 0;
                    const done = activeDisparo.enviados + activeDisparo.falhas;
                    const pct = total ? Math.round((done / total) * 100) : 0;
                    return (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{done} / {total} processados</span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border/60 p-3 text-center">
                      <div className="text-xs text-muted-foreground">Pendentes</div>
                      <div className="text-lg font-semibold">{Math.max(0, activeDisparo.total_leads - activeDisparo.enviados - activeDisparo.falhas)}</div>
                    </div>
                    <div className="rounded-md border border-success/30 bg-success/10 p-3 text-center">
                      <div className="text-xs text-success">Enviados</div>
                      <div className="text-lg font-semibold text-success">{activeDisparo.enviados}</div>
                    </div>
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-center">
                      <div className="text-xs text-destructive">Falhas</div>
                      <div className="text-lg font-semibold text-destructive">{activeDisparo.falhas}</div>
                    </div>
                  </div>

                  {/* Badge de fase */}
                  {(() => {
                    const st = activeDisparo.status;
                    if (st !== "em_andamento" && st !== "pausado") return null;
                    let label = "Aguardando intervalo";
                    let cls = "bg-info/20 text-info border-info/30";
                    let Icon = Clock;
                    if (st === "pausado") { label = "Pausado"; cls = "bg-warning/20 text-warning border-warning/30"; Icon = Pause; }
                    else if (lockRef.current) { label = "Enviando..."; cls = "bg-info/20 text-info border-info/30"; Icon = Send; }
                    else if (!inWindow(activeDisparo.horario_inicio, activeDisparo.horario_fim)) { label = "Fora do horário"; cls = "bg-warning/20 text-warning border-warning/30"; Icon = AlertTriangle; }
                    else if (proximoEnvio > 60) { label = "Em pausa anti-bloqueio"; cls = "bg-warning/20 text-warning border-warning/30"; Icon = Pause; }
                    return (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-3 bg-muted/20">
                        <Badge variant="outline" className={cls}>
                          <Icon className="h-3 w-3 mr-1" /> {label}
                        </Badge>
                        {proximoEnvio > 0 && (
                          <span className="font-mono text-sm font-semibold text-primary tabular-nums">
                            {Math.floor(proximoEnvio / 60)}:{String(proximoEnvio % 60).padStart(2, "0")}
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* ⚙️ Editor ao vivo de intervalos — aplica no próximo envio */}
                  {(activeDisparo.status === "em_andamento" || activeDisparo.status === "pausado") && (
                    <IntervaloEditor
                      key={activeDisparo.id}
                      disparoId={activeDisparo.id}
                      intervaloMin={activeDisparo.intervalo_min}
                      intervaloMax={activeDisparo.intervalo_max}
                      onUpdate={(min, max) => {
                        setDisparos((arr) => arr.map((x) => x.id === activeDisparo.id ? { ...x, intervalo_min: min, intervalo_max: max } : x));
                      }}
                    />
                  )}

                  {activeDisparo.status === "em_andamento" && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-xs">Mantenha esta aba aberta durante o disparo.</AlertDescription>
                    </Alert>
                  )}

                  {/* Três botões padronizados */}
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      size="sm"
                      onClick={() => iniciar(activeDisparo)}
                      disabled={activeDisparo.status === "em_andamento" || activeDisparo.status === "concluido" || activeDisparo.status === "cancelado"}
                      className="bg-success hover:bg-success/90 text-success-foreground"
                    >
                      <Play className="h-4 w-4" /> {activeDisparo.status === "pausado" ? "Retomar" : "Iniciar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => pausar(activeDisparo)}
                      disabled={activeDisparo.status !== "em_andamento"}
                      className="border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
                    >
                      <Pause className="h-4 w-4" /> Pausar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmCancelId(activeDisparo.id)}
                      disabled={activeDisparo.status !== "em_andamento" && activeDisparo.status !== "pausado"}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Square className="h-4 w-4" /> Cancelar
                    </Button>
                  </div>

                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => abrirLogs(activeDisparo)}>
                      <FileText className="h-4 w-4" /> Logs completos
                    </Button>
                  </div>

                  {/* Tabela completa de leads (scrollável) */}
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" /> Leads desta campanha ({activeLogs.length})
                    </Label>
                    <div className="border border-border/60 rounded-md max-h-96 overflow-y-auto">
                      {activeLogs.length === 0 ? (
                        <div className="p-4 text-xs text-muted-foreground text-center">Sem leads ainda</div>
                      ) : (
                        <Table>
                          <TableHeader className="sticky top-0 bg-card z-10">
                            <TableRow>
                              <TableHead className="h-9">Nome</TableHead>
                              <TableHead className="h-9">Telefone</TableHead>
                              <TableHead className="h-9">Status</TableHead>
                              <TableHead className="h-9 text-right">Tent.</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {activeLogs.map((l) => (
                              <TableRow key={l.id}>
                                <TableCell className="py-2 max-w-[140px] truncate">{l.nome ?? "—"}</TableCell>
                                <TableCell className="py-2 font-mono text-xs">{l.telefone}</TableCell>
                                <TableCell className="py-2">{logStatusBadge(l.status)}</TableCell>
                                <TableCell className="py-2 text-right text-xs">{l.tentativas}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog Logs */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="w-[95vw] max-w-4xl">
          <DialogHeader>
            <DialogTitle>Logs do Disparo {logsDisparo ? `— ${logsDisparo.nome}` : ""}</DialogTitle>
            <DialogDescription>Histórico individual de envios.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Select value={logFilter} onValueChange={setLogFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="sending">Enviando</SelectItem>
                <SelectItem value="sent">Enviados</SelectItem>
                <SelectItem value="failed">Falhas reais</SelectItem>
                <SelectItem value="invalido">Inválidos</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => logsDisparo && carregarLogs(logsDisparo.id)}>
                <RefreshCw className="h-4 w-4" /> Atualizar
              </Button>
              <Button size="sm" variant="outline" onClick={reenviarFalhas} title="Reprocessa apenas falhas reais — ignora telefones inválidos">
                Reenviar falhas reais
              </Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-auto border border-border/60 rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead>Enviado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem logs</TableCell></TableRow>
                ) : filteredLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.nome ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.telefone}</TableCell>
                    <TableCell>{logStatusBadge(l.status)}</TableCell>
                    <TableCell>{l.tentativas}</TableCell>
                    <TableCell>{l.enviado_at ? new Date(l.enviado_at).toLocaleString("pt-BR") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLogsOpen(false); carregar(); }}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita. Os logs também serão removidos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDeleteId && excluir(confirmDeleteId)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmCancelId} onOpenChange={(o) => !o && setConfirmCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar disparo?</AlertDialogTitle>
            <AlertDialogDescription>
              Os envios pendentes serão interrompidos. Os logs já enviados permanecerão no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const d = disparos.find((x) => x.id === confirmCancelId);
                if (d) cancelar(d);
                setConfirmCancelId(null);
              }}
            >
              Sim, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CRMLayout>
  );
}

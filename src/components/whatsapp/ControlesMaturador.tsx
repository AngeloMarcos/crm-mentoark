/**
 * ControlesMaturador.tsx — Sprint 7 do maturador v5 (2026-10-18, modelo ChipFlow — ver
 * docs/maturador/SPRINTS_MATURADOR_V5.md): um card por número com progresso do aquecimento,
 * velocidade (travada no início) e os controles liga/desliga de cada chip.
 * Backend: GET /api/maturador/controles, PUT /api/maturador/controles/:agenteId.
 */
import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { SlidersHorizontal, Moon, Sun, Image as ImageIcon, Lock } from "lucide-react";
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

const CONTROLES: { campo: string; titulo: string; descricao: string }[] = [
  { campo: "conversas", titulo: "Conversas", descricao: "Desligado, o chip para de puxar conversa — mas continua respondendo quem falar com ele." },
  { campo: "grupos", titulo: "Grupos", descricao: "Entrar e conversar em grupos (máx. 2 grupos por dia, com 2h de intervalo)." },
  { campo: "midia", titulo: "Fotos e áudios", descricao: "Fotos, áudios e figurinhas nas conversas. Desligado, manda só texto." },
  { campo: "canais", titulo: "Canais", descricao: "Seguir canais do WhatsApp." },
  { campo: "status", titulo: "Publicar status", descricao: "Um status por dia, entre 14h e 20h — das suas imagens e textos, ou escrito pelo sistema." },
  { campo: "contatos", titulo: "Salvar contatos", descricao: "Salvar os parceiros de aquecimento na agenda do chip." },
];

const VELOCIDADES = [
  { id: "lenta", rotulo: "Lenta", ajuda: "Menos conversas, mais espaço entre elas" },
  { id: "normal", rotulo: "Normal", ajuda: "Ritmo recomendado" },
  { id: "rapida", rotulo: "Rápida", ajuda: "Mais conversas — mais risco de queda" },
];

export function ControlesMaturador() {
  const [d, setD] = useState<any>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [statusChip, setStatusChip] = useState<any>(null);
  const carregar = () => chamar("/controles").then(setD).catch(() => {});
  useEffect(() => { carregar(); }, []);
  if (!d?.chips?.length) return null;

  const alterar = async (chip: any, mudanca: Record<string, any>) => {
    setSalvando(chip.agente_id);
    try { await chamar(`/controles/${chip.agente_id}`, { method: "PUT", body: mudanca }); await carregar(); }
    catch (e: any) { toast.error(e.message); }
    finally { setSalvando(null); }
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-5 w-5 text-orange-500" /> Controles</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ligue e desligue o que cada WhatsApp faz no aquecimento. Tudo vem ligado — desligue só o que você não quer.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
          <Badge variant="outline" className="gap-1"><Moon className="h-3 w-3" /> Dorme {d.rotina.dorme}</Badge>
          <Badge variant="outline" className="gap-1"><Sun className="h-3 w-3" /> Conversa {d.rotina.conversa}</Badge>
          <Badge variant="outline" className="gap-1"><ImageIcon className="h-3 w-3" /> Status {d.rotina.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {d.chips.map((c: any) => (
          <div key={c.agente_id} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.nome}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{c.numero || "sem número conectado"}</p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px]">{c.fase_rotulo}</Badge>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Aquecimento: dia {c.progresso.dia} de {c.progresso.total_dias}</span>
                <span>{c.progresso.percentual}%</span>
              </div>
              <Progress value={c.progresso.percentual} className="h-1.5" />
              <p className="text-[11px] text-muted-foreground">
                {c.contadores.enviadas} enviadas · {c.contadores.recebidas} recebidas · {c.contadores.status} status · {c.contadores.ultimas_24h} nas últimas 24h
              </p>
            </div>

            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1">
                {VELOCIDADES.map(v => {
                  const ativo = c.velocidade.escolhido === v.id;
                  return (
                    <button key={v.id} type="button" title={v.ajuda}
                      disabled={c.velocidade.travado || salvando === c.agente_id}
                      onClick={() => alterar(c, { velocidade: v.id })}
                      className={`rounded-md border px-2 py-1 text-xs transition ${ativo ? "border-orange-500 bg-orange-500/10 font-semibold" : "hover:bg-muted"} disabled:cursor-not-allowed disabled:opacity-60`}>
                      {v.rotulo}
                    </button>
                  );
                })}
              </div>
              {c.velocidade.travado && (
                <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <Lock className="mt-px h-3 w-3 shrink-0" /> Velocidade travada em Lenta: {c.velocidade.motivo}
                </p>
              )}
            </div>

            <div className="divide-y rounded-md border">
              {CONTROLES.map(ct => {
                const e = c.estado[ct.campo];
                return (
                  <div key={ct.campo} className="flex items-start justify-between gap-3 p-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{ct.titulo}</p>
                      <p className="text-[11px] text-muted-foreground">{ct.descricao}</p>
                      <p className={`text-[11px] ${e.ativo_agora ? "font-semibold text-emerald-600" : "text-muted-foreground"}`}>{e.situacao}</p>
                      {ct.campo === "status" && (
                        <button type="button" onClick={() => setStatusChip(c)}
                          className="mt-1 text-[11px] font-medium text-orange-600 underline-offset-2 hover:underline">
                          Gerenciar status ({c.contadores.status_imagens ?? 0} imagens · {c.contadores.status_textos ?? 0} textos)
                        </button>
                      )}
                    </div>
                    <Switch checked={!!c.controles[ct.campo]} disabled={salvando === c.agente_id}
                      onCheckedChange={v => alterar(c, { [ct.campo]: v })} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
      <StatusMaturador chip={statusChip} aberto={!!statusChip}
        onFechar={(mudou) => { setStatusChip(null); if (mudou) carregar(); }} />
    </Card>
  );
}

/**
 * PainelMaturacao.tsx — visão da plataforma (admin MentoArk) da maturação de números: fases,
 * Maturador, restrições/bans por fase e tempo médio até "madura" (Sprint 8 = Sprint 3 / H10).
 * Backend: GET /api/admin/maturacao. Serve para recalibrar os limites das fases.
 */
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Flame } from "lucide-react";

const FASE: Record<string, string> = {
  perfil: "Perfil", aquecimento_1: "Aquecimento 1", aquecimento_2: "Aquecimento 2", aquecimento_3: "Aquecimento 3",
  pre_oficial: "Pré-oficial", madura: "Madura", quarentena: "Quarentena", banida: "Banida", sem_fase: "Sem fase", sem_registro: "Sem registro",
};
const EVENTO: Record<string, string> = { ban_suspeito: "Queda suspeita", ban_confirmado: "Ban confirmado", rate_limit: "Limite (429)", em_revisao: "Em revisão" };

export function PainelMaturacao() {
  const [d, setD] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<any>("/api/admin/maturacao", { silent: true }).then(setD).catch((e: any) => setErro(e?.message || "Erro"));
  }, []);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Aquecimento de números (todas as contas)</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {erro && <p className="text-red-600">{erro}</p>}
        {!d && !erro && <Loader2 className="h-4 w-4 animate-spin" />}
        {d && (
          <>
            <div>
              <div className="font-medium mb-1">Números por fase</div>
              <div className="flex flex-wrap gap-2">
                {d.numeros_por_fase.map((f: any) => (
                  <span key={f.fase} className="rounded-md border px-2 py-1 text-xs">{FASE[f.fase] ?? f.fase}: <b>{f.numeros}</b></span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Tempo médio da 1ª conexão até "Madura": <b>{d.tempo_ate_madura?.dias_medios ?? "—"} dias</b> ({d.tempo_ate_madura?.numeros ?? 0} número(s) chegaram lá).
              </p>
            </div>
            <div>
              <div className="font-medium mb-1">Aquecimento (pares por conta)</div>
              <p className="text-xs">
                {d.maturador.ativos} pares ativos em {d.maturador.contas} conta(s) · {d.maturador.pausados} pausados ·
                {" "}{d.maturador.pares_pausados_por_falha} pausados por falha nos últimos 30 dias
              </p>
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-muted-foreground text-left"><th>Dia</th><th>Mensagens</th><th>Pares</th><th>Status/enquete/reação</th></tr></thead>
                <tbody>
                  {d.maturador.sessoes_por_dia.map((x: any) => (
                    <tr key={x.dia}><td>{new Date(x.dia).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td><td>{x.mensagens}</td><td>{x.pares}</td><td>{x.extras}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="font-medium mb-1">Restrições e bans em 30 dias, pela fase em que o número estava</div>
              {!d.restricoes_30d_por_fase.length && <p className="text-xs text-muted-foreground">Nenhum evento em 30 dias.</p>}
              <table className="w-full text-xs">
                <tbody>
                  {d.restricoes_30d_por_fase.map((x: any, i: number) => (
                    <tr key={i}><td>{FASE[x.fase] ?? x.fase}</td><td>{EVENTO[x.tipo] ?? x.tipo}</td><td className="text-right font-medium">{x.total}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Pool global entre contas e "mentores" dependem da Etapa B (não construída: exige proxy por instância e consentimento).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const PAPEL_ADMIN: Record<string, string> = { receptor: "Só recebem (números novos)", conversador: "Conversam", mentor: "Mentores" };

/** Liga/desliga geral do Maturador Global (Sprint 9) + situação da rede. */
export function AdminMaturadorGlobal() {
  const [d, setD] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const carregar = () => adminFetch<any>("/api/admin/maturador-global", { silent: true }).then(setD).catch(() => {});
  useEffect(() => { carregar(); }, []);
  const alternar = async () => {
    const ligar = !d?.ativo;
    if (ligar && !confirm("Ligar o Aquecimento Global? Os números das contas que aderiram (com proxy próprio) passam a conversar entre si.")) return;
    setSalvando(true);
    try { await adminFetch("/api/admin/maturador-global", { method: "PUT", body: { ativo: ligar } }); await carregar(); }
    finally { setSalvando(false); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" /> Aquecimento Global</CardTitle>
        {d && (
          <button onClick={alternar} disabled={salvando}
            className={`rounded-md px-3 py-1 text-sm font-medium text-white ${d.ativo ? "bg-red-600" : "bg-emerald-600"}`}>
            {salvando ? "…" : d.ativo ? "Desligar" : "Ligar"}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!d ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            <p>Status: <b>{d.ativo ? "LIGADO" : "desligado"}</b>{d.atualizado_por ? ` (por ${d.atualizado_por} em ${new Date(d.atualizado_em).toLocaleString("pt-BR")})` : ""}</p>
            <p className="text-xs text-muted-foreground">Contas que aderiram: {d.contas_aderidas}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(d.por_papel || {}).map(([p, n]) => <span key={p} className="rounded-md border px-2 py-1">{PAPEL_ADMIN[p] ?? p}: <b>{String(n)}</b></span>)}
            </div>
            {Object.keys(d.fora || {}).length > 0 && (
              <p className="text-xs text-muted-foreground">De fora: {Object.entries(d.fora).map(([m, n]) => `${m} (${n})`).join(" · ")}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Vínculos ativos: {(d.vinculos || []).map((v: any) => `${v.tipo} ${v.ativos}`).join(" · ") || "0"} ·
              Mensagens 24h: conversa {d.mensagens_24h?.conversa ?? 0}, mentoria {d.mensagens_24h?.mentoria ?? 0}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * GruposMaturador.tsx — Sprint 11 do maturador v5 (2026-10-23, modelo ChipFlow): "Seus grupos".
 * Até 5 convites por conta; os chips da conta entram aos poucos (máx. 2 grupos/dia por chip, ≥ 2 h
 * entre entradas, a partir do Aquecimento 2) e conversam entre si no grupo.
 * Backend: GET/POST /api/maturador/grupos, DELETE /api/maturador/grupos/:id.
 */
import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Users, Trash2, Link as LinkIcon } from "lucide-react";

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

const ESTADO: Record<string, { rotulo: string; cor: string }> = {
  pendente: { rotulo: "Aguardando entrada", cor: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  ativo: { rotulo: "Ativo", cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  cheio: { rotulo: "Cheio", cor: "bg-muted text-muted-foreground" },
  invalido: { rotulo: "Link inválido", cor: "bg-red-500/15 text-red-700 dark:text-red-400" },
  comunidade: { rotulo: "Comunidade (descartado)", cor: "bg-muted text-muted-foreground" },
};
const MEMBRO: Record<string, string> = { entrou: "dentro", aguardando_aprovacao: "aguardando o admin aprovar", falhou: "não conseguiu entrar ainda" };

function ListaGrupos({ grupos, removivel, ocupado, remover }: { grupos: any[]; removivel: boolean; ocupado: boolean; remover: (id: string) => void }) {
  if (!grupos.length) return null;
  return (
    <ul className="divide-y rounded-md border">
      {grupos.map((g: any) => {
        const e = ESTADO[g.estado] ?? ESTADO.pendente;
        return (
          <li key={g.id} className="flex items-start justify-between gap-3 p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{g.nome || "Grupo ainda não lido"}</p>
                <Badge variant="secondary" className={`text-[10px] ${e.cor}`}>{e.rotulo}</Badge>
              </div>
              {removivel && <p className="truncate font-mono text-[11px] text-muted-foreground">{g.link}</p>}
              <p className="text-[11px] text-muted-foreground">
                {g.participantes != null ? `${g.participantes} participantes · ` : ""}{g.mensagens_hoje} mensagens dos chips hoje
                {g.motivo ? ` · ${g.motivo}` : ""}
              </p>
              {g.membros.length > 0 && (
                <p className="text-[11px]">
                  {g.membros.map((m: any) => `${m.nome}: ${MEMBRO[m.estado] ?? m.estado}`).join(" · ")}
                </p>
              )}
            </div>
            {removivel && (
              <Button type="button" variant="ghost" size="icon" aria-label="Remover grupo" disabled={ocupado} onClick={() => remover(g.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function GruposMaturador() {
  const [d, setD] = useState<any>(null);
  const [link, setLink] = useState("");
  const [linkMentoark, setLinkMentoark] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const carregar = () => chamar("/grupos").then(setD).catch(() => {});
  useEffect(() => { carregar(); }, []);
  if (!d) return null;

  const executar = async (fn: () => Promise<any>) => {
    setOcupado(true);
    try { await fn(); await carregar(); }
    catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  };
  const cheio = d.grupos.length >= d.limites.grupos;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base"><Users className="h-5 w-5 text-orange-500" /> Seus grupos</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cole convites de grupos seus. Os números desta conta entram aos poucos — no máximo {d.limites.entradas_dia_chip} grupos por dia
          cada, com {d.limites.horas_entre_entradas}h de intervalo, a partir do Aquecimento 2 — e conversam entre si lá dentro.
          Comunidades e grupos cheios são descartados.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="https://chat.whatsapp.com/..." value={link} disabled={ocupado || cheio}
              onChange={(e) => setLink(e.target.value)} />
          </div>
          <Button type="button" disabled={ocupado || cheio || !link.trim()}
            onClick={() => executar(async () => { await chamar("/grupos", { method: "POST", body: { link } }); setLink(""); })}>
            Adicionar grupo
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{d.grupos.length}/{d.limites.grupos} grupos</p>

        <ListaGrupos grupos={d.grupos} removivel ocupado={ocupado}
          remover={(id) => executar(() => chamar(`/grupos/${id}`, { method: "DELETE" }))} />
        {d.grupos.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Remover daqui só para o aquecimento nesse grupo — os números continuam no grupo. Para sair, saia pelo celular.
          </p>
        )}

        {/* Sprint 13: grupos da MentoArk — chips de todas as contas do Aquecimento Global conversam lá. */}
        {(d.grupos_mentoark?.length > 0 || d.pode_gerenciar_mentoark) && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Grupos da MentoArk</p>
            <p className="text-[11px] text-muted-foreground">
              Para números no Aquecimento Global: entram aqui também (mesmos limites) e conversam com números de outras contas.
              Só aparecem os seus números.
            </p>
            {d.pode_gerenciar_mentoark && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="Link de grupo da MentoArk (só admin)" value={linkMentoark} disabled={ocupado}
                  onChange={(e) => setLinkMentoark(e.target.value)} />
                <Button type="button" variant="secondary" disabled={ocupado || !linkMentoark.trim()}
                  onClick={() => executar(async () => { await chamar("/grupos", { method: "POST", body: { link: linkMentoark, global: true } }); setLinkMentoark(""); })}>
                  Adicionar
                </Button>
              </div>
            )}
            <ListaGrupos grupos={d.grupos_mentoark ?? []} removivel={!!d.pode_gerenciar_mentoark} ocupado={ocupado}
              remover={(id) => executar(() => chamar(`/grupos/${id}`, { method: "DELETE" }))} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

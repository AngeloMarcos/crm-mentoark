/**
 * ConversasMaturador.tsx — Sprint 12 do maturador v5 (2026-10-24, modelo ChipFlow): pulso do dia
 * (conversa × grupo, áudios, fotos, status, chips ativos) e visualizador SÓ LEITURA das conversas
 * do aquecimento — entre os chips (P2P) e nos grupos.
 * Backend: GET /api/maturador/conversas, GET /api/maturador/conversas/:tipo/:id.
 */
import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity, MessagesSquare, Users, Mic, Image as ImageIcon, CircleDot, Smartphone, Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

async function chamar(path: string) {
  const r = await fetch(`${API_URL}/api/maturador${path}`, { headers: authHeader() });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || `Erro ${r.status}`);
  return d;
}

const ROTULO_TIPO: Record<string, string> = {
  audio: "🎤 Áudio", foto: "📷 Foto", figurinha: "Figurinha", reacao: "Reação", enquete: "📊 Enquete", status: "Status publicado",
};
const quando = (s: string | null) => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

function Bloco({ icone: Icone, rotulo, valor }: { icone: any; rotulo: string; valor: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Icone className="h-3.5 w-3.5" /> {rotulo}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

export function ConversasMaturador() {
  const [d, setD] = useState<any>(null);
  const [aberta, setAberta] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[] | null>(null);

  useEffect(() => {
    const carregar = () => chamar("/conversas").then(setD).catch(() => {});
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!aberta) return;
    setMsgs(null);
    chamar(`/conversas/${aberta.tipo}/${aberta.id}`).then(r => setMsgs(r.mensagens)).catch(() => setMsgs([]));
  }, [aberta]);
  if (!d) return null;
  const p = d.pulso;
  // Primeiro chip que aparece na conversa fica à esquerda; os outros à direita.
  const esquerda = msgs?.[0]?.de_agente_id;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5 text-orange-500" /> Pulso de hoje</CardTitle>
        <p className="text-xs text-muted-foreground">O que o aquecimento fez hoje. As conversas abaixo são só para ver — nada é enviado por aqui.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Bloco icone={MessagesSquare} rotulo="Conversa" valor={p.conversa} />
          <Bloco icone={Users} rotulo="Grupos" valor={p.grupo} />
          <Bloco icone={Mic} rotulo="Áudios" valor={p.audios} />
          <Bloco icone={ImageIcon} rotulo="Fotos" valor={p.fotos} />
          <Bloco icone={CircleDot} rotulo="Status" valor={p.status} />
          <Bloco icone={Smartphone} rotulo="Chips ativos" valor={`${p.chips_ativos}/${p.chips_total}`} />
        </div>

        {d.conversas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conversa ainda. Crie um par de aquecimento ou cadastre um grupo.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {d.conversas.map((c: any) => (
              <li key={`${c.tipo}-${c.id}`}>
                <button type="button" onClick={() => setAberta(c)} className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {c.tipo === "grupo" ? <Users className="h-3.5 w-3.5 shrink-0" /> : <MessagesSquare className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{c.titulo}</span>
                      {c.global && <Badge variant="outline" className="text-[10px]">Global</Badge>}
                      {!c.ativo && <Badge variant="secondary" className="text-[10px]">Pausado</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{c.ultima || "sem mensagens ainda"}</p>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    <p>{quando(c.ultima_em)}</p>
                    {c.hoje > 0 && <p className="font-semibold text-emerald-600">{c.hoje} hoje</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{aberta?.titulo}</DialogTitle>
            <DialogDescription>Últimas 150 mensagens do aquecimento — só leitura.</DialogDescription>
          </DialogHeader>
          {!msgs ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
            : msgs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
            : (
              <div className="space-y-2">
                {msgs.map((m, i) => {
                  const dir = m.de_agente_id !== esquerda;
                  const especial = m.tipo !== "texto";
                  return (
                    <div key={i} className={`flex ${dir ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${dir ? "bg-orange-500/15" : "bg-muted"}`}>
                        <p className="text-[10px] font-semibold text-muted-foreground">
                          {m.de_nome}{m.mentoria ? " · mentoria" : ""}{especial ? ` · ${ROTULO_TIPO[m.tipo] ?? m.tipo}` : ""}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                        <p className="text-right text-[10px] text-muted-foreground">{quando(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

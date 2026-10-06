/**
 * BackupsInstancia.tsx — backups diários (CSV compactado) de contatos e conversas da instância
 * (Sprint 8 = Sprint 3 / H10): se o número for banido, o cliente não perde os leads.
 * Backend: GET/POST /api/whatsapp/backups/:agenteId[/gerar|/:arquivo].
 */
import { useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Archive, Download } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export function BackupsInstancia({ agenteId, nome }: { agenteId: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<{ arquivo: string; bytes: number }[] | null>(null);
  const [gerando, setGerando] = useState(false);
  const base = `${API_URL}/api/whatsapp/backups/${agenteId}`;

  const carregar = async () => {
    const r = await fetch(base, { headers: authHeader() });
    setLista(r.ok ? await r.json() : []);
  };
  const abrir = () => { setAberto(true); carregar(); };
  const gerar = async () => {
    setGerando(true);
    try {
      const r = await fetch(`${base}/gerar`, { method: "POST", headers: authHeader() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message || "Erro ao gerar");
      toast.success(`Backup gerado: ${d.contatos} contatos, ${d.mensagens} mensagens`);
      carregar();
    } catch (e: any) { toast.error(e.message); } finally { setGerando(false); }
  };
  const baixar = async (arquivo: string) => {
    const r = await fetch(`${base}/${encodeURIComponent(arquivo)}`, { headers: authHeader() });
    if (!r.ok) { toast.error("Não foi possível baixar"); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = arquivo; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={abrir}>
        <Archive className="h-3 w-3" /> Backups
      </Button>
      {aberto && (
        <Dialog open onOpenChange={() => setAberto(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Backups — {nome}</DialogTitle>
              <DialogDescription>
                Todo dia de madrugada o CRM salva os contatos e as conversas dos últimos 30 dias desta instância
                (planilha CSV compactada). Ficam as 3 cópias mais recentes.
              </DialogDescription>
            </DialogHeader>
            {lista === null ? <p className="text-sm text-muted-foreground">Carregando…</p>
              : !lista.length ? <p className="text-sm text-muted-foreground">Nenhum backup ainda.</p>
              : (
                <ul className="space-y-1 text-sm">
                  {lista.map(f => (
                    <li key={f.arquivo} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{f.arquivo} <span className="text-muted-foreground">({Math.max(1, Math.round(f.bytes / 1024))} KB)</span></span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => baixar(f.arquivo)}><Download className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            <Button size="sm" variant="outline" onClick={gerar} disabled={gerando}>{gerando ? "Gerando…" : "Gerar backup agora"}</Button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

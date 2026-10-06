/**
 * ChecklistApiOficial.tsx — checklist "Apto para API oficial" de uma instância conectada por QR
 * Code (Sprint 3 / H2, entregue na Sprint 7 em 2026-10-06). Um item por linha, verde/vermelho; os
 * dois últimos dependem de confirmação manual do cliente (data e, no portfólio, link do print).
 * Backend: GET/PUT /api/whatsapp/saude/:agenteId/checklist-oficial.
 */
import { useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, XCircle, ClipboardCheck } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

interface Checklist {
  apto: boolean;
  recomendacao: string | null;
  itens: { item: string; ok: boolean; detalhe: string; manual?: boolean }[];
  confirmacoes: { app_business_desde: string | null; portfolio_verificado_em: string | null; portfolio_prova: string | null };
}

const soData = (v: string | null) => (v ? String(v).slice(0, 10) : "");

export function ChecklistApiOficial({ agenteId, apto }: { agenteId: string; apto: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [c, setC] = useState<Checklist | null>(null);
  const [form, setForm] = useState({ app_business_desde: "", portfolio_verificado_em: "", portfolio_prova: "" });
  const [salvando, setSalvando] = useState(false);
  const url = `${API_URL}/api/whatsapp/saude/${agenteId}/checklist-oficial`;

  const aplicar = (d: Checklist) => {
    setC(d);
    setForm({
      app_business_desde: soData(d.confirmacoes.app_business_desde),
      portfolio_verificado_em: soData(d.confirmacoes.portfolio_verificado_em),
      portfolio_prova: d.confirmacoes.portfolio_prova || "",
    });
  };
  const abrir = async () => {
    setAberto(true);
    const res = await fetch(url, { headers: authHeader() });
    const d = await res.json().catch(() => null);
    if (!res.ok) { toast.error(d?.message || "Não foi possível carregar o checklist"); setAberto(false); return; }
    aplicar(d);
  };
  const salvar = async () => {
    setSalvando(true);
    try {
      const res = await fetch(url, {
        method: "PUT", headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          app_business_desde: form.app_business_desde || null,
          portfolio_verificado_em: form.portfolio_verificado_em || null,
          portfolio_prova: form.portfolio_prova || null,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.message || "Erro ao salvar");
      aplicar(d);
      toast.success("Confirmações salvas");
    } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={abrir}>
        <ClipboardCheck className="h-3 w-3" /> {apto ? "Apto para API oficial" : "Checklist API oficial"}
      </Button>
      {aberto && (
        <Dialog open onOpenChange={() => setAberto(false)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Apto para API oficial?
                {c && (c.apto ? <Badge className="bg-emerald-600">Apto</Badge> : <Badge variant="secondary">Ainda não</Badge>)}
              </DialogTitle>
              <DialogDescription>O que a Meta e o histórico do número precisam mostrar antes de migrar.</DialogDescription>
            </DialogHeader>
            {!c ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
              <div className="space-y-3">
                {c.recomendacao && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">{c.recomendacao}</p>
                )}
                <ul className="space-y-1.5">
                  {c.itens.map((i, k) => (
                    <li key={k} className="flex items-start gap-2 text-sm">
                      {i.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />}
                      <div>
                        <div className="font-medium">{i.item}{i.manual ? " (confirmação manual)" : ""}</div>
                        <div className="text-xs text-muted-foreground">{i.detalhe}</div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="space-y-2 border-t pt-3">
                  <div className="text-sm font-medium">Confirmações do cliente</div>
                  <div><Label>Usando o app WhatsApp Business desde</Label>
                    <Input type="date" value={form.app_business_desde} onChange={e => setForm({ ...form, app_business_desde: e.target.value })} /></div>
                  <div><Label>Empresa verificada no portfólio Meta em</Label>
                    <Input type="date" value={form.portfolio_verificado_em} onChange={e => setForm({ ...form, portfolio_verificado_em: e.target.value })} /></div>
                  <div><Label>Link do print da verificação</Label>
                    <Input placeholder="https://" value={form.portfolio_prova} onChange={e => setForm({ ...form, portfolio_prova: e.target.value })} /></div>
                </div>
              </div>
            )}
            <DialogFooter><Button onClick={salvar} disabled={!c || salvando}>{salvando ? "Salvando…" : "Salvar confirmações"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

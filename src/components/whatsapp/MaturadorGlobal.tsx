/**
 * MaturadorGlobal.tsx — adesão da conta ao Maturador Global, situação de cada número (papel ou
 * motivo de estar de fora) e proxy próprio por número (Sprint 9, 2026-10-06).
 * Backend: GET /api/maturador/global, PUT /api/maturador/global/adesao, PUT|DELETE /api/maturador/proxy/:id.
 */
import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Globe2, ShieldCheck, AlertTriangle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const BASE = `${API_URL}/api/maturador`;

async function chamar(path: string, opts: { method?: string; body?: any } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || `Erro ${r.status}`);
  return d;
}

const PAPEL: Record<string, { label: string; cls: string; desc: string }> = {
  receptor: { label: "Só recebe", cls: "bg-sky-500/15 text-sky-600 border-sky-500/30", desc: "Número novo: recebe ~1 mensagem a cada 2h, não envia nada." },
  conversador: { label: "Conversa", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", desc: "Troca mensagens nos dois sentidos com parceiros de outras contas." },
  mentor: { label: "Mentor", cls: "bg-violet-500/15 text-violet-600 border-violet-500/30", desc: "Número maduro: conversa e escreve para números novos." },
};

export function MaturadorGlobal() {
  const [d, setD] = useState<any>(null);
  const [termoAberto, setTermoAberto] = useState(false);
  const [proxyDe, setProxyDe] = useState<any>(null);
  const carregar = () => chamar("/global").then(setD).catch(() => {});
  useEffect(() => { carregar(); }, []);
  if (!d) return null;

  const aderir = async (ativo: boolean) => {
    try {
      await chamar("/global/adesao", { method: "PUT", body: { ativo, aceito: ativo } });
      toast.success(ativo ? "Conta participando do Maturador Global" : "Conta saiu do Maturador Global");
      setTermoAberto(false);
      carregar();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-5 w-5 text-primary" /> Maturador Global</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Seus números conversam com números de outras contas MentoArk para ganhar histórico e score.
            Números novos só recebem mensagens até a liberação.
          </p>
        </div>
        {d.adesao?.ativo
          ? <Button size="sm" variant="outline" onClick={() => aderir(false)}>Sair</Button>
          : <Button size="sm" onClick={() => setTermoAberto(true)}>Participar</Button>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!d.ligado && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" /> O Maturador Global está desligado pela MentoArk no momento — nada é enviado.
          </p>
        )}
        {d.adesao?.ativo && (
          <p className="text-xs text-muted-foreground">
            Participando desde {new Date(d.adesao.aceito_em).toLocaleDateString("pt-BR")} (termo {d.adesao.termo_versao}).
          </p>
        )}
        <div className="space-y-2">
          {d.numeros.map((n: any) => (
            <div key={n.agenteId} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{n.nome || n.instancia}</div>
                <div className="text-xs text-muted-foreground">
                  {n.papel ? PAPEL[n.papel].desc : n.fora}
                  {n.so_recebe && n.papel ? ` (${n.so_recebe})` : ""}
                </div>
                {n.papel && (
                  <div className="text-[11px] text-muted-foreground">
                    {n.vinculos} parceiro(s) · 24h: {n.enviadas_24h} enviada(s), {n.recebidas_24h} recebida(s)
                  </div>
                )}
              </div>
              {n.papel && <Badge variant="outline" className={PAPEL[n.papel].cls}>{PAPEL[n.papel].label}</Badge>}
              {n.proxy
                ? <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Proxy {n.proxy.host}</Badge>
                : <Badge variant="secondary">Sem proxy</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setProxyDe(n)}>{n.proxy ? "Proxy" : "Configurar proxy"}</Button>
            </div>
          ))}
        </div>
      </CardContent>

      {termoAberto && (
        <Dialog open onOpenChange={() => setTermoAberto(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Participar do Maturador Global</DialogTitle>
              <DialogDescription>Leia antes de aceitar.</DialogDescription>
            </DialogHeader>
            <p className="text-sm whitespace-pre-wrap">{d.termo.texto}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTermoAberto(false)}>Cancelar</Button>
              <Button onClick={() => aderir(true)}>Li e aceito</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {proxyDe && <ProxyDialog numero={proxyDe} onFechar={() => { setProxyDe(null); carregar(); }} />}
    </Card>
  );
}

function ProxyDialog({ numero, onFechar }: { numero: any; onFechar: () => void }) {
  const [f, setF] = useState({
    host: numero.proxy?.host || "", port: numero.proxy?.port ? String(numero.proxy.port) : "",
    protocolo: numero.proxy?.protocolo || "http", usuario: "", senha: "",
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      await chamar(`/proxy/${numero.agenteId}`, { method: "PUT", body: { ...f, port: Number(f.port) } });
      toast.success("Proxy aplicado e confirmado pela Evolution");
      onFechar();
    } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  };
  const remover = async () => {
    if (!confirm("Remover o proxy deste número? Ele sai do Maturador Global.")) return;
    try { await chamar(`/proxy/${numero.agenteId}`, { method: "DELETE" }); toast.success("Proxy removido"); onFechar(); }
    catch (e: any) { toast.error(e.message); }
  };
  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Proxy de {numero.nome || numero.instancia}</DialogTitle>
          <DialogDescription>
            Use um proxy residencial do Brasil, só deste número (dois números no mesmo proxy são recusados).
            Configure antes de conectar o número e evite trocar depois: mudar o IP de um número já conectado também é sinal de risco.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2"><Label>Host</Label><Input value={f.host} onChange={e => setF({ ...f, host: e.target.value })} placeholder="br.proxy.exemplo.com" /></div>
          <div><Label>Porta</Label><Input inputMode="numeric" value={f.port} onChange={e => setF({ ...f, port: e.target.value.replace(/\D/g, "") })} /></div>
          <div>
            <Label>Protocolo</Label>
            <Select value={f.protocolo} onValueChange={v => setF({ ...f, protocolo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["http", "https", "socks5", "socks4"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Usuário</Label><Input value={f.usuario} onChange={e => setF({ ...f, usuario: e.target.value })} /></div>
          <div><Label>Senha</Label><Input type="password" autoComplete="off" value={f.senha} onChange={e => setF({ ...f, senha: e.target.value })} placeholder={numero.proxy ? "•••• (mantém a atual)" : ""} /></div>
        </div>
        <DialogFooter className="gap-2">
          {numero.proxy && <Button variant="outline" onClick={remover}>Remover</Button>}
          <Button onClick={salvar} disabled={salvando || !f.host || !f.port}>{salvando ? "Aplicando…" : "Aplicar proxy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

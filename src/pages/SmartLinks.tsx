/**
 * SmartLinks.tsx — Smart Links & QR Code (Sprint 3 / H7, 2026-10-05).
 *
 * [AUDITORIA] BUG CORRIGIDO: a página era só maquete (botão sem ação, link e contadores fixos).
 * Agora cria links curtos de verdade (`/l/:codigo` na API) que abrem o WhatsApp da instância com
 * mensagem pré-preenchida + código; a 1ª mensagem com o código marca o contato como inbound com a
 * origem (backend/src/routes/smartLinks.ts). Mostra cliques, leads e o KPI inbound × outbound por
 * instância (meta: inbound ≥ 50%). QR Code gerado como imagem por api.qrserver.com (o conteúdo é
 * só o link público) — evita adicionar dependência nova ao build.
 */
import { useEffect, useState } from "react";
import { CRMLayout } from "@/components/CRMLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2, QrCode, Plus, Copy, Trash2, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/database/client";
import { getAuthToken } from "@/lib/api-token";
import { useAuth } from "@/hooks/useAuth";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3000";

interface SmartLink {
  id: string;
  codigo: string;
  nome: string;
  agente_nome: string | null;
  numero: string;
  mensagem: string;
  origem: string;
  campanha: string | null;
  cliques: number;
  leads: number;
  ativo: boolean;
  criado_em: string;
}
interface Kpi { instancia: string; inbound: number; outbound: number; pct_inbound: number | null }

const ORIGENS = [
  { v: "campanha", r: "Campanha" }, { v: "anuncio", r: "Anúncio" }, { v: "bio", r: "Bio / perfil" },
  { v: "qr", r: "QR impresso" }, { v: "outro", r: "Outro" },
];

async function apiFetch(path: string, options: RequestInit = {}) {
  const t = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Falha na requisição (${res.status})`);
  return json;
}

const urlPublica = (codigo: string) => `${API_BASE}/l/${codigo}`;

export default function SmartLinksPage() {
  const { user } = useAuth();
  const [links, setLinks] = useState<SmartLink[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [agentes, setAgentes] = useState<{ id: string; nome: string; numero_conectado: string | null }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [qrDe, setQrDe] = useState<SmartLink | null>(null);
  const [form, setForm] = useState({ nome: "", agente_id: "", mensagem: "Olá! Quero saber mais.", origem: "campanha", campanha: "" });

  const carregar = async () => {
    try {
      const [l, k] = await Promise.all([apiFetch("/api/smart-links"), apiFetch("/api/smart-links/kpi")]);
      setLinks(l ?? []);
      setKpis(k ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    carregar();
    api.from("agentes").select("id,nome,numero_conectado,evolution_instancia").eq("user_id", user.id).then(({ data }) => {
      setAgentes(((data ?? []) as { id: string; nome: string; numero_conectado: string | null; evolution_instancia: string | null }[])
        .filter(a => !!a.evolution_instancia && !!a.numero_conectado));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const criar = async () => {
    if (!form.nome.trim()) { toast.error("Dê um nome ao link"); return; }
    if (!form.agente_id) { toast.error("Escolha o número de destino"); return; }
    setCriando(true);
    try {
      const novo = await apiFetch("/api/smart-links", { method: "POST", body: JSON.stringify(form) });
      toast.success("Smart Link criado");
      setForm(f => ({ ...f, nome: "", campanha: "" }));
      setQrDe(novo);
      carregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCriando(false);
    }
  };

  const alternar = async (l: SmartLink, ativo: boolean) => {
    try {
      await apiFetch(`/api/smart-links/${l.id}`, { method: "PATCH", body: JSON.stringify({ ativo }) });
      setLinks(ls => ls.map(x => x.id === l.id ? { ...x, ativo } : x));
    } catch (e) { toast.error((e as Error).message); }
  };

  const excluir = async (l: SmartLink) => {
    if (!confirm(`Excluir o link "${l.nome}"? Quem tiver o link/QR antigo vai cair em "link não encontrado".`)) return;
    try {
      await apiFetch(`/api/smart-links/${l.id}`, { method: "DELETE" });
      setLinks(ls => ls.filter(x => x.id !== l.id));
      if (qrDe?.id === l.id) setQrDe(null);
    } catch (e) { toast.error((e as Error).message); }
  };

  const copiar = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast.success("Link copiado");
  };

  return (
    <CRMLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-fuchsia-500/15 text-fuchsia-500 flex items-center justify-center">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Smart Links & QR Code</h1>
            <p className="text-sm text-muted-foreground">
              Faça o cliente chamar primeiro: links e QR Codes que abrem seu WhatsApp e registram de onde o lead veio.
            </p>
          </div>
        </div>

        {kpis.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {kpis.map(k => (
              <Card key={k.instancia} className="p-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> {k.instancia} · 30 dias</p>
                <p className={`text-2xl font-bold ${k.pct_inbound !== null && k.pct_inbound >= 50 ? "text-emerald-600" : "text-amber-600"}`}>
                  {k.pct_inbound ?? 0}% inbound
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {k.inbound} conversas iniciadas pelo cliente · {k.outbound} pela empresa · meta: 50% ou mais
                </p>
              </Card>
            ))}
          </div>
        )}

        <Card className="p-5 space-y-3">
          <h2 className="text-base font-semibold">Novo Smart Link</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Bio do Instagram" />
            </div>
            <div className="space-y-1.5">
              <Label>Número de destino</Label>
              <Select value={form.agente_id} onValueChange={v => setForm({ ...form, agente_id: v })}>
                <SelectTrigger><SelectValue placeholder={agentes.length ? "Escolha a instância" : "Nenhuma instância conectada"} /></SelectTrigger>
                <SelectContent>
                  {agentes.map(a => <SelectItem key={a.id} value={a.id}>{a.nome} (+{a.numero_conectado})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Mensagem que o cliente envia</Label>
              <Input value={form.mensagem} onChange={e => setForm({ ...form, mensagem: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">O código do link é adicionado no fim, ex.: "… (cód. AB12CD)". É ele que identifica a origem.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Origem</Label>
              <Select value={form.origem} onValueChange={v => setForm({ ...form, origem: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ORIGENS.map(o => <SelectItem key={o.v} value={o.v}>{o.r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Campanha (opcional)</Label>
              <Input value={form.campanha} onChange={e => setForm({ ...form, campanha: e.target.value })} placeholder="Ex: Lançamento outubro" />
            </div>
          </div>
          <Button onClick={criar} disabled={criando} className="gap-2">
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Gerar link
          </Button>
        </Card>

        {qrDe && (
          <Card className="p-5 flex flex-col sm:flex-row items-center gap-5">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(urlPublica(qrDe.codigo))}`}
              alt={`QR Code do link ${qrDe.nome}`}
              className="w-44 h-44 rounded-lg border bg-white p-1"
            />
            <div className="space-y-2 min-w-0">
              <p className="text-sm font-semibold flex items-center gap-2"><QrCode className="h-4 w-4" /> {qrDe.nome}</p>
              <p className="font-mono text-xs break-all">{urlPublica(qrDe.codigo)}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => copiar(urlPublica(qrDe.codigo))} className="gap-1.5"><Copy className="h-3.5 w-3.5" /> Copiar link</Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=${encodeURIComponent(urlPublica(qrDe.codigo))}`} target="_blank" rel="noreferrer">Baixar QR</a>
                </Button>
              </div>
            </div>
          </Card>
        )}

        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
        ) : links.length === 0 ? (
          <Card className="p-10 text-center border-dashed">
            <p className="text-muted-foreground text-sm">Nenhum Smart Link ainda. Crie o primeiro acima.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {links.map(l => (
              <Card key={l.id} className={`p-4 space-y-2 ${l.ativo ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{l.nome}</p>
                    <p className="font-mono text-[11px] text-muted-foreground truncate">{urlPublica(l.codigo)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch checked={l.ativo} onCheckedChange={v => alternar(l, v)} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copiar(urlPublica(l.codigo))} title="Copiar"><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQrDe(l)} title="QR Code"><QrCode className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => excluir(l)} title="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">{ORIGENS.find(o => o.v === l.origem)?.r ?? l.origem}</Badge>
                  {l.campanha && <Badge variant="outline" className="text-[10px]">{l.campanha}</Badge>}
                  <Badge variant="outline" className="text-[10px]">{l.agente_nome ?? `+${l.numero}`}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{l.cliques} clique(s) · <b className="text-foreground">{l.leads} lead(s)</b></p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </CRMLayout>
  );
}

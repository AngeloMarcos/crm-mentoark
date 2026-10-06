/**
 * NumerosOficiais.tsx — números da WhatsApp API Oficial (Meta Cloud API, integração DIRETA) na aba
 * WhatsApp → Instâncias. Sprint 6 (2026-10-05):
 *   - H3: um cartão por número (badge "API Oficial", qualidade, limite do portfólio e uso, alerta);
 *   - H2: cadastro com URL do webhook + Verify Token pra copiar (e regenerar), passo a passo dos
 *     campos a assinar no app da Meta, teste em 4 etapas com botão "Inscrever app na WABA";
 *   - H4: templates da WABA (`TemplatesMeta`, também usado em /disparos/templates);
 *   - H5: campanha oficial — template aprovado + audiência + estimativa (elegíveis, bloqueados por
 *     motivo, custo) antes de criar; a fila é montada no servidor.
 * Segredos (Access Token / App Secret) nunca voltam do servidor — só "salvo"/"não salvo".
 */
import { useEffect, useState } from "react";
import { authHeader } from "@/lib/api-token";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { BadgeCheck, Copy, RefreshCw, Plus, Trash2, PlugZap, Send, FileText, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";
const BASE = `${API_URL}/api/meta-oficial`;

async function chamar(path: string, opts: { method?: string; body?: any } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: { ...authHeader(), ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message || `Erro ${res.status}`), { status: res.status, data });
  return data;
}

const copiar = (texto: string, rotulo: string) =>
  navigator.clipboard.writeText(texto).then(() => toast.success(`${rotulo} copiado`), () => toast.error("Não foi possível copiar"));

const QUALIDADE: Record<string, { label: string; cls: string }> = {
  GREEN: { label: "Alta", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  YELLOW: { label: "Média", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  RED: { label: "Baixa", cls: "bg-red-500/15 text-red-500 border-red-500/30" },
};

const CAMPOS_WEBHOOK = ["messages", "account_update", "phone_number_quality_update", "message_template_status_update",
  "template_category_update", "user_preferences"];

export interface ConfigOficial {
  id: string; nome: string | null; numero_exibicao: string | null; phone_number_id: string | null; waba_id: string | null;
  verify_token: string | null; ativo: boolean; quality_rating: string | null; limite_mensagens_valor: number | null;
  limite_mensagens_label: string; conta_status: string | null; alerta: string | null; ultimo_webhook_em: string | null;
  webhook_url: string; temAccessToken: boolean; temAppSecret: boolean; ultimo_erro: string | null;
}

export function NumerosOficiais() {
  const [configs, setConfigs] = useState<ConfigOficial[]>([]);
  const [editando, setEditando] = useState<ConfigOficial | "novo" | null>(null);
  const [templatesDe, setTemplatesDe] = useState<ConfigOficial | null>(null);
  const [campanhaDe, setCampanhaDe] = useState<ConfigOficial | null>(null);

  const carregar = () => chamar("/configs").then(setConfigs).catch(() => {});
  useEffect(() => { carregar(); }, []);

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><BadgeCheck className="h-5 w-5 text-sky-500" /> API Oficial da Meta</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Números conectados direto na Meta (sem QR Code). Disparo só com template aprovado e contato com consentimento.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditando("novo")}><Plus className="h-4 w-4 mr-1" /> Número oficial</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configs.length && <p className="text-sm text-muted-foreground">Nenhum número oficial cadastrado.</p>}
        {configs.map(c => (
          <CartaoOficial key={c.id} cfg={c} onEditar={() => setEditando(c)} onTemplates={() => setTemplatesDe(c)}
            onCampanha={() => setCampanhaDe(c)} onMudou={carregar} />
        ))}
      </CardContent>
      {editando && <FormOficial cfg={editando === "novo" ? null : editando} onFechar={() => { setEditando(null); carregar(); }} />}
      {templatesDe && (
        <Dialog open onOpenChange={() => setTemplatesDe(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Templates Meta — {templatesDe.nome || templatesDe.numero_exibicao}</DialogTitle></DialogHeader>
            <TemplatesMeta configId={templatesDe.id} />
          </DialogContent>
        </Dialog>
      )}
      {campanhaDe && <CampanhaOficial cfg={campanhaDe} onFechar={() => setCampanhaDe(null)} />}
    </Card>
  );
}

function CartaoOficial({ cfg, onEditar, onTemplates, onCampanha, onMudou }: {
  cfg: ConfigOficial; onEditar: () => void; onTemplates: () => void; onCampanha: () => void; onMudou: () => void;
}) {
  const [uso, setUso] = useState<any>(null);
  const [eventos, setEventos] = useState<any[]>([]);
  useEffect(() => {
    chamar(`/configs/${cfg.id}/uso`).then(setUso).catch(() => {});
    chamar(`/configs/${cfg.id}/eventos`).then(setEventos).catch(() => {});
  }, [cfg.id]);
  const q = QUALIDADE[String(cfg.quality_rating || "").toUpperCase()];
  const limite = cfg.limite_mensagens_valor;
  const pct = limite && uso ? Math.min(100, Math.round((uso.portfolio_hoje / limite) * 100)) : 0;

  const remover = async () => {
    if (!confirm("Remover este número oficial do CRM? (não apaga nada na Meta)")) return;
    await chamar(`/configs/${cfg.id}`, { method: "DELETE" }).catch(e => toast.error(e.message));
    onMudou();
  };

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{cfg.nome || cfg.numero_exibicao || cfg.phone_number_id}</span>
        <Badge variant="outline" className="border-sky-500/40 text-sky-500 gap-1"><BadgeCheck className="h-3 w-3" /> API Oficial</Badge>
        {q ? <Badge variant="outline" className={q.cls}>Qualidade {q.label}</Badge> : <Badge variant="outline">Qualidade —</Badge>}
        {!cfg.ativo && <Badge variant="secondary">Inativo</Badge>}
        {cfg.conta_status && cfg.conta_status !== "ok" && <Badge variant="destructive">{cfg.conta_status}</Badge>}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" onClick={onTemplates}><FileText className="h-4 w-4 mr-1" /> Templates</Button>
          <Button size="sm" variant="outline" onClick={onCampanha} disabled={!cfg.ativo}><Send className="h-4 w-4 mr-1" /> Campanha</Button>
          <Button size="sm" variant="outline" onClick={onEditar}>Configurar</Button>
          <Button size="icon" variant="ghost" onClick={remover} aria-label="Remover"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{cfg.numero_exibicao} · Phone Number ID {cfg.phone_number_id || "—"}</div>
      {cfg.alerta && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {cfg.alerta}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3 text-xs">
        <div>
          <div className="text-muted-foreground">Limite do portfólio (24h)</div>
          <div className="font-medium">{uso?.portfolio_hoje ?? 0} / {cfg.limite_mensagens_label || "—"}</div>
          {limite ? <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-sky-500" style={{ width: `${pct}%` }} /></div> : null}
          <div className="text-[11px] text-muted-foreground mt-1">O limite vale para o portfólio inteiro (todos os números da mesma WABA).</div>
        </div>
        <div>
          <div className="text-muted-foreground">Contatos únicos</div>
          <div className="font-medium">hoje {uso?.hoje ?? 0} · semana {uso?.semana ?? 0}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Mensagens cobradas (30 dias): {uso?.cobradas_30d ?? 0}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Último webhook</div>
          <div className="font-medium">{cfg.ultimo_webhook_em ? new Date(cfg.ultimo_webhook_em).toLocaleString("pt-BR") : "nenhum ainda"}</div>
          {uso?.erros_7d?.length ? (
            <div className="text-[11px] text-muted-foreground mt-1">Erros 7d: {uso.erros_7d.map((e: any) => `${e.codigo} (${e.total})`).join(", ")}</div>
          ) : null}
        </div>
      </div>
      {eventos.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Eventos recentes ({eventos.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {eventos.slice(0, 10).map((e, i) => (
              <li key={i}>{new Date(e.criado_em).toLocaleString("pt-BR")} — {e.tipo}{e.status_reason ? ` (${e.status_reason})` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FormOficial({ cfg, onFechar }: { cfg: ConfigOficial | null; onFechar: () => void }) {
  const [atual, setAtual] = useState<ConfigOficial | null>(cfg);
  const [form, setForm] = useState({
    nome: cfg?.nome ?? "", numero_exibicao: cfg?.numero_exibicao ?? "", phone_number_id: cfg?.phone_number_id ?? "",
    waba_id: cfg?.waba_id ?? "", access_token: "", app_secret: "", ativo: cfg?.ativo ?? true,
  });
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<any>(null);
  const [testando, setTestando] = useState(false);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = atual
        ? await chamar(`/configs/${atual.id}`, { method: "PUT", body: form })
        : await chamar("/configs", { method: "POST", body: form });
      setAtual(r);
      setForm(f => ({ ...f, access_token: "", app_secret: "" }));
      toast.success("Número oficial salvo. Agora configure o webhook no app da Meta (abaixo).");
    } catch (e: any) { toast.error(e.message); } finally { setSalvando(false); }
  };
  const regenerar = async () => {
    if (!atual || !confirm("Gerar um novo Verify Token? O antigo deixa de funcionar — atualize no app da Meta.")) return;
    setAtual(await chamar(`/configs/${atual.id}/regenerar-token`, { method: "POST" }));
  };
  const testar = async () => {
    if (!atual) return;
    setTestando(true);
    try { setTeste(await chamar(`/configs/${atual.id}/testar`, { method: "POST" })); }
    catch (e: any) { toast.error(e.message); } finally { setTestando(false); }
  };
  const inscrever = async () => {
    if (!atual) return;
    try { await chamar(`/configs/${atual.id}/inscrever`, { method: "POST" }); toast.success("App inscrito na WABA"); testar(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{atual ? "Configurar número oficial" : "Novo número oficial"}</DialogTitle>
          <DialogDescription>Dados do Gerenciador do WhatsApp (business.facebook.com) e do app em developers.facebook.com.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Nome interno</Label><Input value={form.nome} onChange={e => set("nome", e.target.value)} placeholder="Ex.: Vendas oficial" /></div>
          <div><Label>Número (exibição)</Label><Input value={form.numero_exibicao} onChange={e => set("numero_exibicao", e.target.value)} placeholder="+55 11 9…" /></div>
          <div><Label>Phone Number ID</Label><Input value={form.phone_number_id} onChange={e => set("phone_number_id", e.target.value)} /></div>
          <div><Label>WABA ID (conta do WhatsApp Business)</Label><Input value={form.waba_id} onChange={e => set("waba_id", e.target.value)} /></div>
          <div>
            <Label>Access Token (permanente, de usuário do sistema)</Label>
            <Input type="password" autoComplete="off" value={form.access_token} onChange={e => set("access_token", e.target.value)}
              placeholder={atual?.temAccessToken ? "•••••• salvo — preencha só para trocar" : ""} />
          </div>
          <div>
            <Label>App Secret</Label>
            <Input type="password" autoComplete="off" value={form.app_secret} onChange={e => set("app_secret", e.target.value)}
              placeholder={atual?.temAppSecret ? "•••••• salvo — preencha só para trocar" : ""} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.ativo} onChange={e => set("ativo", e.target.checked)} /> Número ativo
          </label>
        </div>
        <DialogFooter><Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button></DialogFooter>

        {atual && (
          <div className="space-y-3 border-t pt-3 text-sm">
            <div className="font-medium">Webhook no app da Meta</div>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
              <li>No app (developers.facebook.com) → WhatsApp → Configuração → Webhook → Editar.</li>
              <li>Cole a URL de retorno e o Verify Token abaixo e clique em "Verificar e salvar".</li>
              <li>Em "Campos do webhook", assine: {CAMPOS_WEBHOOK.join(", ")}.</li>
              <li>Clique em "Testar conexão" aqui; se o app não estiver inscrito na WABA, use "Inscrever".</li>
            </ol>
            <div className="flex gap-2">
              <Input readOnly value={atual.webhook_url} className="text-xs" />
              <Button size="icon" variant="outline" onClick={() => copiar(atual.webhook_url, "URL")}><Copy className="h-4 w-4" /></Button>
            </div>
            <div className="flex gap-2">
              <Input readOnly value={atual.verify_token || ""} className="text-xs font-mono" />
              <Button size="icon" variant="outline" onClick={() => copiar(atual.verify_token || "", "Verify Token")}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="outline" onClick={regenerar} title="Gerar novo token"><RefreshCw className="h-4 w-4" /></Button>
            </div>
            <Button variant="secondary" onClick={testar} disabled={testando}><PlugZap className="h-4 w-4 mr-1" /> {testando ? "Testando…" : "Testar conexão"}</Button>
            {teste?.etapas && (
              <ul className="space-y-1.5">
                {teste.etapas.map((e: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {e.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    <div className="flex-1"><span className="font-medium">{e.etapa}</span> — {e.detalhe}</div>
                    {e.acao === "inscrever" && <Button size="sm" variant="outline" onClick={inscrever}>Inscrever</Button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Templates Meta (H4) ──────────────────────────────────────────────────────────────────────
const STATUS_TPL: Record<string, string> = {
  APPROVED: "Aprovado", PENDING: "Em análise", REJECTED: "Rejeitado", PAUSED: "Pausado", DISABLED: "Desativado", IN_APPEAL: "Em recurso",
};
const CATEGORIA_PT: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" };

export function TemplatesMeta({ configId }: { configId: string }) {
  const [lista, setLista] = useState<any[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [criando, setCriando] = useState(false);
  const carregar = () => chamar(`/configs/${configId}/templates`).then(setLista).catch(() => {});
  useEffect(() => { carregar(); }, [configId]);

  const sincronizar = async () => {
    setSincronizando(true);
    try { const r = await chamar(`/configs/${configId}/templates/sincronizar`, { method: "POST" }); toast.success(`${r.sincronizados} template(s) sincronizado(s)`); carregar(); }
    catch (e: any) { toast.error(e.message); } finally { setSincronizando(false); }
  };
  const excluir = async (nome: string) => {
    if (!confirm(`Excluir o template "${nome}" na Meta?`)) return;
    await chamar(`/configs/${configId}/templates/${encodeURIComponent(nome)}`, { method: "DELETE" }).catch(e => toast.error(e.message));
    carregar();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={sincronizar} disabled={sincronizando}><RefreshCw className="h-4 w-4 mr-1" /> Sincronizar com a Meta</Button>
        <Button size="sm" onClick={() => setCriando(true)}><Plus className="h-4 w-4 mr-1" /> Novo template</Button>
      </div>
      {!lista.length && <p className="text-sm text-muted-foreground">Nenhum template. Sincronize ou crie um novo.</p>}
      {lista.map(t => {
        const corpo = (t.componentes || []).find((c: any) => c.type === "BODY")?.text;
        return (
          <div key={t.id} className="rounded-md border p-2 text-sm space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{t.nome}</span>
              <Badge variant="outline">{t.idioma}</Badge>
              <Badge variant="outline">{CATEGORIA_PT[t.categoria] || t.categoria}</Badge>
              <Badge variant={t.status === "APPROVED" ? "default" : t.status === "REJECTED" ? "destructive" : "secondary"}>{STATUS_TPL[t.status] || t.status}</Badge>
              <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => excluir(t.nome)}><Trash2 className="h-4 w-4" /></Button>
            </div>
            {corpo && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{corpo}</p>}
            {t.motivo_rejeicao_pt && <p className="text-xs text-red-500">Motivo: {t.motivo_rejeicao_pt}</p>}
          </div>
        );
      })}
      {criando && <NovoTemplate configId={configId} onFechar={() => { setCriando(false); carregar(); }} />}
    </div>
  );
}

function NovoTemplate({ configId, onFechar }: { configId: string; onFechar: () => void }) {
  const [f, setF] = useState({ nome: "", categoria: "MARKETING", idioma: "pt_BR", cabecalho: "", corpo: "", rodape: "", botoes: "" });
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const nVars = new Set([...f.corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1])).size;

  const enviar = async (confirmar = false) => {
    setEnviando(true);
    try {
      await chamar(`/configs/${configId}/templates`, {
        method: "POST",
        body: { ...f, botoes: f.botoes.split("\n").filter(Boolean), exemplos: exemplos.slice(0, nVars), confirmar_categoria: confirmar },
      });
      toast.success("Template enviado para análise da Meta");
      onFechar();
    } catch (e: any) {
      if (e.data?.code === "CATEGORIA_SUSPEITA" && confirm(`${e.message}\n\nEnviar mesmo assim como Utilidade?`)) return enviar(true);
      toast.error(e.message);
    } finally { setEnviando(false); }
  };

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo template Meta</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Nome (minúsculas, números e _)</Label><Input value={f.nome} onChange={e => setF({ ...f, nome: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></div>
          <div>
            <Label>Categoria</Label>
            <Select value={f.categoria} onValueChange={v => setF({ ...f, categoria: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKETING">Marketing (promoção, novidade)</SelectItem>
                <SelectItem value="UTILITY">Utilidade (pedido, agendamento, cobrança)</SelectItem>
                <SelectItem value="AUTHENTICATION">Autenticação (código)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Cabeçalho (opcional)</Label><Input maxLength={60} value={f.cabecalho} onChange={e => setF({ ...f, cabecalho: e.target.value })} /></div>
          <div><Label>Corpo — use {"{{1}}"}, {"{{2}}"}… para variáveis</Label><Textarea rows={5} maxLength={1024} value={f.corpo} onChange={e => setF({ ...f, corpo: e.target.value })} /></div>
          {Array.from({ length: nVars }, (_, i) => (
            <div key={i}><Label>Exemplo para {`{{${i + 1}}}`} (obrigatório)</Label>
              <Input value={exemplos[i] || ""} onChange={e => { const x = [...exemplos]; x[i] = e.target.value; setExemplos(x); }} /></div>
          ))}
          <div><Label>Rodapé (opcional)</Label><Input maxLength={60} value={f.rodape} onChange={e => setF({ ...f, rodape: e.target.value })} /></div>
          <div><Label>Botões de resposta rápida (um por linha)</Label><Textarea rows={2} value={f.botoes} onChange={e => setF({ ...f, botoes: e.target.value })} /></div>
          {f.categoria === "MARKETING" && <p className="text-xs text-muted-foreground">O botão "Parar promoções" é adicionado automaticamente em Marketing.</p>}
        </div>
        <DialogFooter><Button onClick={() => enviar()} disabled={enviando}>{enviando ? "Enviando…" : "Enviar para aprovação"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Campanha oficial (H5) ────────────────────────────────────────────────────────────────────
const CAMPOS_VAR = [
  { v: "primeiro_nome", l: "Primeiro nome" }, { v: "nome", l: "Nome completo" }, { v: "empresa", l: "Empresa" },
  { v: "cidade", l: "Cidade" }, { v: "estado", l: "Estado" }, { v: "interesse", l: "Interesse" },
];

function CampanhaOficial({ cfg, onFechar }: { cfg: ConfigOficial; onFechar: () => void }) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [listas, setListas] = useState<{ id: string; nome: string }[]>([]);
  const [tplKey, setTplKey] = useState("");
  const [nome, setNome] = useState("");
  const [audiencia, setAudiencia] = useState<{ tipo: "lista" | "tag" | "optin"; valor: string }>({ tipo: "optin", valor: "" });
  const [variaveis, setVariaveis] = useState<Record<string, string>>({});
  const [estimativa, setEstimativa] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    chamar(`/configs/${cfg.id}/templates`).then((t: any[]) => setTemplates(t.filter(x => x.status === "APPROVED"))).catch(() => {});
    if (user) api.from("listas").select("id, nome").eq("user_id", user.id).then(({ data }: any) => setListas(data || []));
  }, [cfg.id, user?.id]);

  const tpl = templates.find(t => `${t.nome}|${t.idioma}` === tplKey);
  const corpo: string = (tpl?.componentes || []).find((c: any) => c.type === "BODY")?.text || "";
  const nVars = new Set([...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1])).size;

  const corpoReq = () => ({
    nome, template_nome: tpl?.nome, idioma: tpl?.idioma,
    variaveis: Object.fromEntries(Array.from({ length: nVars }, (_, i) => [String(i + 1), variaveis[String(i + 1)] || "primeiro_nome"])),
    ...(audiencia.tipo === "lista" ? { lista_id: audiencia.valor } : audiencia.tipo === "tag" ? { tag: audiencia.valor } : { todos_com_optin: true }),
  });

  const estimar = async () => {
    setOcupado(true);
    try { setEstimativa(await chamar(`/configs/${cfg.id}/campanhas/estimar`, { method: "POST", body: corpoReq() })); }
    catch (e: any) { toast.error(e.message); setEstimativa(null); } finally { setOcupado(false); }
  };
  const criar = async () => {
    setOcupado(true);
    try {
      const r = await chamar(`/configs/${cfg.id}/campanhas`, { method: "POST", body: corpoReq() });
      toast.success(`Campanha criada com ${r.elegiveis} contato(s). Acompanhe em Disparos.`);
      onFechar();
    } catch (e: any) { toast.error(e.message); } finally { setOcupado(false); }
  };

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Campanha pela API Oficial</DialogTitle>
          <DialogDescription>Só contatos com consentimento (opt-in) recebem. Grupos minerados e contatos frios ficam de fora.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div><Label>Nome da campanha</Label><Input value={nome} onChange={e => setNome(e.target.value)} /></div>
          <div>
            <Label>Template aprovado</Label>
            <Select value={tplKey} onValueChange={v => { setTplKey(v); setEstimativa(null); }}>
              <SelectTrigger><SelectValue placeholder={templates.length ? "Escolha" : "Nenhum template aprovado"} /></SelectTrigger>
              <SelectContent>
                {templates.map(t => <SelectItem key={t.id} value={`${t.nome}|${t.idioma}`}>{t.nome} ({CATEGORIA_PT[t.categoria] || t.categoria})</SelectItem>)}
              </SelectContent>
            </Select>
            {corpo && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{corpo}</p>}
          </div>
          {Array.from({ length: nVars }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Label className="w-14">{`{{${i + 1}}}`}</Label>
              <Select value={variaveis[String(i + 1)] || "primeiro_nome"} onValueChange={v => setVariaveis({ ...variaveis, [String(i + 1)]: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CAMPOS_VAR.map(c => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          <div>
            <Label>Audiência</Label>
            <Select value={audiencia.tipo} onValueChange={(v: any) => { setAudiencia({ tipo: v, valor: "" }); setEstimativa(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="optin">Todos com consentimento</SelectItem>
                <SelectItem value="lista">Uma lista</SelectItem>
                <SelectItem value="tag">Uma etiqueta</SelectItem>
              </SelectContent>
            </Select>
            {audiencia.tipo === "lista" && (
              <Select value={audiencia.valor} onValueChange={v => { setAudiencia({ tipo: "lista", valor: v }); setEstimativa(null); }}>
                <SelectTrigger className="mt-2"><SelectValue placeholder="Escolha a lista" /></SelectTrigger>
                <SelectContent>{listas.map(l => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {audiencia.tipo === "tag" && <Input className="mt-2" placeholder="Etiqueta" value={audiencia.valor} onChange={e => { setAudiencia({ tipo: "tag", valor: e.target.value }); setEstimativa(null); }} />}
          </div>
          {estimativa && (
            <div className="rounded-md border p-2 text-xs space-y-1">
              <div>Selecionados: <b>{estimativa.selecionados}</b> · Elegíveis: <b>{estimativa.elegiveis}</b> · Com opt-in: {estimativa.pct_optin}%</div>
              {Object.entries(estimativa.bloqueados || {}).map(([k, n]) => (
                <div key={k} className="text-muted-foreground">Bloqueados — {estimativa.rotulos?.[k] || k}: {String(n)}</div>
              ))}
              <div>
                Custo estimado: {estimativa.custo_estimado_usd === null ? "preço desta categoria não cadastrado" : `US$ ${Number(estimativa.custo_estimado_usd).toFixed(2)}`}
                {estimativa.gratis ? ` (${estimativa.gratis} grátis por janela aberta)` : ""}
              </div>
              {estimativa.erro && <div className="text-red-500">{estimativa.erro}</div>}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={estimar} disabled={!tpl || ocupado || (audiencia.tipo !== "optin" && !audiencia.valor)}>Calcular</Button>
          <Button onClick={criar} disabled={!estimativa || !estimativa.elegiveis || ocupado}>Criar campanha</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Seção "Templates Meta" da página /disparos/templates (H4): escolhe o número oficial e lista os templates da WABA. */
export function TemplatesMetaSecao() {
  const [configs, setConfigs] = useState<ConfigOficial[]>([]);
  const [sel, setSel] = useState("");
  useEffect(() => {
    chamar("/configs").then((c: ConfigOficial[]) => { setConfigs(c); if (c[0]) setSel(c[0].id); }).catch(() => {});
  }, []);
  if (!configs.length) return null;
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base"><BadgeCheck className="h-5 w-5 text-sky-500" /> Templates Meta (API Oficial)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Estes passam pela aprovação da Meta e são os únicos que a API Oficial aceita para iniciar conversa. As
          "Mensagens do CRM" acima são para os números conectados por QR Code — não viram template oficial.
        </p>
        {configs.length > 1 && (
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{configs.map(c => <SelectItem key={c.id} value={c.id}>{c.nome || c.numero_exibicao || c.phone_number_id}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>{sel && <TemplatesMeta configId={sel} />}</CardContent>
    </Card>
  );
}

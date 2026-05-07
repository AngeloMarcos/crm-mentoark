import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Search, Loader2, ChevronDown, UserPlus, CheckSquare, Square,
  Flame, Thermometer, Snowflake, Phone, Mail, MapPin, Hash, Send,
} from "lucide-react";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:3000";

const SEGMENTOS = [
  { label: "Academia / Fitness",        cnae: "9313100" },
  { label: "Advocacia",                  cnae: "6911701" },
  { label: "Bar / Lanchonete",           cnae: "5611203" },
  { label: "Clínica Médica",             cnae: "8630504" },
  { label: "Clínica Odontológica",       cnae: "8630506" },
  { label: "Construção Civil",           cnae: "4120400" },
  { label: "Contabilidade",              cnae: "6920601" },
  { label: "E-commerce / Loja Virtual",  cnae: "4791100" },
  { label: "Escola / Cursinho",          cnae: "8541400" },
  { label: "Farmácia / Drogaria",        cnae: "4771701" },
  { label: "Fisioterapia",               cnae: "8650004" },
  { label: "Hotel / Pousada",            cnae: "5510801" },
  { label: "Imobiliária",               cnae: "6810201" },
  { label: "Oficina Mecânica",           cnae: "4520001" },
  { label: "Pet Shop / Veterinário",     cnae: "7500100" },
  { label: "Psicólogo / Psiquiatra",     cnae: "8621601" },
  { label: "Restaurante",               cnae: "5611201" },
  { label: "Salão de Beleza",            cnae: "9602501" },
  { label: "Supermercado / Mercado",     cnae: "4711301" },
  { label: "Tecnologia / TI",            cnae: "6201501" },
  { label: "Transportadora / Logística", cnae: "4930202" },
];

const ESTADOS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA",
  "MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN",
  "RS","RO","RR","SC","SP","SE","TO",
];

interface LeadResultado {
  nome: string;
  cnpj: string | null;
  cidade: string | null;
  estado: string | null;
  segmento: string | null;
  telefone: string | null;
  email: string | null;
  score_ia: number;
  temperatura: "frio" | "morno" | "quente";
  resumo_ia: string | null;
  origem: string;
}

interface BuscarLeadsModalProps {
  open: boolean;
  onClose: () => void;
}

const tempConfig = {
  quente: { icon: Flame,       className: "text-orange-400 bg-orange-400/10" },
  morno:  { icon: Thermometer, className: "text-yellow-400 bg-yellow-400/10" },
  frio:   { icon: Snowflake,   className: "text-blue-400 bg-blue-400/10" },
};

function fmtCNPJ(cnpj: string) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function fmtTel(tel: string) {
  const d = tel.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return tel;
}

function renderTpl(tpl: string, lead: LeadResultado) {
  const nome = lead.nome ?? "";
  const primeiroNome = nome.split(/\s+/)[0] ?? nome;
  return tpl
    .replace(/\{\{primeiro_nome\}\}/g, primeiroNome)
    .replace(/\{\{nome\}\}/g, primeiroNome)
    .replace(/\{\{nome_completo\}\}/g, nome)
    .replace(/\{\{empresa\}\}/g, lead.nome ?? "")
    .replace(/\{\{telefone\}\}/g, lead.telefone ?? "");
}

export function BuscarLeadsModal({ open, onClose }: BuscarLeadsModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Filtros
  const [segmento, setSegmento] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("todos");
  const [limite, setLimite] = useState("30");
  const [comEmail, setComEmail] = useState(true);
  const [comTelefone, setComTelefone] = useState(false);

  // Busca
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<LeadResultado[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());

  // Importar para leads
  const [importando, setImportando] = useState(false);

  // Criar disparo
  const [disparoAberto, setDisparoAberto] = useState(false);
  const [nomeDisparo, setNomeDisparo] = useState("");
  const [mensagemTemplate, setMensagemTemplate] = useState(
    "Olá {{primeiro_nome}}, tudo bem?\n\nSomos da [SUA EMPRESA] e identificamos que a {{empresa}} pode se interessar pela nossa solução.\n\nPosso te apresentar em 2 minutos?"
  );
  const [mostrarPreview, setMostrarPreview] = useState(false);
  const [criandoDisparo, setCriandoDisparo] = useState(false);

  const segSelecionado = SEGMENTOS.find((s) => s.cnae === segmento);

  const buscar = async () => {
    if (!segmento) { toast.error("Selecione um segmento"); return; }
    setBuscando(true);
    setResultados(null);
    setSelecionados(new Set());
    setDisparoAberto(false);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_BASE}/api/leads/buscar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          segmento: segSelecionado?.label ?? segmento,
          cnae: segmento,
          cidade: cidade.trim() || undefined,
          estado: estado !== "todos" ? estado : undefined,
          limite: Number(limite),
          com_email: comEmail,
          com_telefone: comTelefone,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

      const json = await res.json();
      const leads: LeadResultado[] = Array.isArray(json) ? json : (json.leads ?? json.data ?? []);

      if (leads.length === 0) {
        toast.info("Nenhum lead encontrado. Tente remover filtros ou trocar cidade.");
      } else {
        toast.success(`${leads.length} leads encontrados`);
        setSelecionados(new Set(leads.map((l, i) => l.temperatura !== "frio" ? i : -1).filter(i => i >= 0)));
      }

      setResultados(leads);
      // pré-preenche nome do disparo
      const data = new Date().toLocaleDateString("pt-BR");
      setNomeDisparo(`Prospecção ${segSelecionado?.label ?? segmento}${cidade ? " - " + cidade : ""} - ${data}`);
    } catch (err: unknown) {
      toast.error(`Erro na busca: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuscando(false);
    }
  };

  const leadsComTelefone = resultados
    ? [...selecionados].map(i => resultados[i]).filter(l => !!l?.telefone)
    : [];

  const toggleSelecionado = (i: number) =>
    setSelecionados(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const toggleTodos = () => {
    if (!resultados) return;
    setSelecionados(selecionados.size === resultados.length ? new Set() : new Set(resultados.map((_, i) => i)));
  };

  // ── Salvar em Leads (sem disparo) ──────────────────────────────────────────
  const importarContatos = async (listaId?: string) => {
    if (!user || !resultados || selecionados.size === 0) return;
    setImportando(true);

    const rows = [...selecionados].map(i => {
      const l = resultados[i];
      return {
        user_id: user.id,
        nome: l.nome,
        telefone: l.telefone ? l.telefone.replace(/\D/g, "") : null,
        email: l.email ?? null,
        empresa: l.nome,
        cargo: l.segmento ?? null,
        origem: l.origem ?? "casa_dos_dados",
        status: "novo",
        tags: l.temperatura ? [l.temperatura] : [],
        lista_id: listaId ?? null,
        notas: [
          l.cnpj ? `CNPJ: ${fmtCNPJ(l.cnpj)}` : null,
          l.cidade && l.estado ? `Local: ${l.cidade} - ${l.estado}` : l.cidade ?? null,
          `Score IA: ${l.score_ia}/100`,
          l.resumo_ia ?? null,
        ].filter(Boolean).join("\n"),
      };
    });

    const { error } = await supabase.from("contatos").insert(rows);
    setImportando(false);

    if (error) { toast.error(`Erro ao importar: ${error.message}`); return; }
    return rows.length;
  };

  const salvarEmLeads = async () => {
    const n = await importarContatos();
    if (n) toast.success(`${n} contatos salvos em Leads`);
  };

  // ── Criar disparo ──────────────────────────────────────────────────────────
  const criarDisparo = async () => {
    if (!user) return;
    if (!nomeDisparo.trim()) { toast.error("Informe o nome do disparo"); return; }
    if (!mensagemTemplate.trim()) { toast.error("Informe a mensagem"); return; }
    if (leadsComTelefone.length === 0) {
      toast.error("Nenhum lead selecionado tem telefone. Ative 'Com telefone' na busca.");
      return;
    }

    setCriandoDisparo(true);
    try {
      // 1. Criar lista
      const { data: lista, error: errLista } = await supabase
        .from("listas")
        .insert({ user_id: user.id, nome: nomeDisparo, descricao: `Gerado via busca de leads — ${segSelecionado?.label ?? segmento}` })
        .select("id")
        .single();

      if (errLista || !lista) throw new Error(errLista?.message ?? "Erro ao criar lista");

      // 2. Importar contatos nessa lista
      const total = await importarContatos(lista.id);
      if (!total) throw new Error("Nenhum contato importado");

      // 3. Criar disparo (rascunho)
      const { data: disparo, error: errDisparo } = await supabase
        .from("disparos")
        .insert({
          user_id: user.id,
          nome: nomeDisparo,
          lista_id: lista.id,
          mensagem_template: mensagemTemplate,
          total_leads: total,
          enviados: 0,
          falhas: 0,
          intervalo_min: 45,
          intervalo_max: 90,
          pausa_a_cada: 20,
          pausa_duracao: 300,
          horario_inicio: "08:00",
          horario_fim: "20:00",
          status: "rascunho",
        })
        .select("id")
        .single();

      if (errDisparo || !disparo) throw new Error(errDisparo?.message ?? "Erro ao criar disparo");

      toast.success(`Disparo criado com ${total} leads — redirecionando…`);
      onClose();
      navigate("/disparos");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCriandoDisparo(false);
    }
  };

  const fechar = () => {
    setResultados(null);
    setSelecionados(new Set());
    setDisparoAberto(false);
    onClose();
  };

  const primeiroLeadComTel = resultados ? [...selecionados].map(i => resultados[i]).find(l => l?.telefone) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Buscar Leads por Segmento
          </DialogTitle>
          <DialogDescription>
            Busca automática via Google Places + pontuação por IA. Máx. 20 resultados por busca.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Filtros */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Segmento *</Label>
              <Select value={segmento} onValueChange={setSegmento}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o segmento que deseja prospectar" />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENTOS.map((s) => (
                    <SelectItem key={s.cnae} value={s.cnae}>
                      {s.label}
                      <span className="ml-2 text-xs text-muted-foreground font-mono">CNAE {s.cnae}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Cidade</Label>
              <Input placeholder="Ex: São Paulo" value={cidade} onChange={(e) => setCidade(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Estado</Label>
              <Select value={estado} onValueChange={setEstado}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {ESTADOS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Limite</Label>
              <Input type="number" min={5} max={50} value={limite} onChange={(e) => setLimite(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Filtros de contato</Label>
              <div className="flex items-center gap-4 h-10">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox checked={comEmail} onCheckedChange={(v) => setComEmail(!!v)} />
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Com e-mail
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox checked={comTelefone} onCheckedChange={(v) => setComTelefone(!!v)} />
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Com telefone
                </label>
              </div>
            </div>
          </div>

          <Button onClick={buscar} disabled={buscando || !segmento} className="w-full gap-2">
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {buscando ? "Buscando no Google Places e pontuando com IA…" : "Buscar Leads"}
          </Button>

          {/* Resultados */}
          {resultados !== null && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-medium">
                  {resultados.length} leads encontrados
                  {selecionados.size > 0 && <span className="text-muted-foreground font-normal ml-1">· {selecionados.size} selecionados</span>}
                  {leadsComTelefone.length > 0 && <span className="text-muted-foreground font-normal ml-1">· {leadsComTelefone.length} com telefone</span>}
                </p>
                {resultados.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={toggleTodos}>
                    {selecionados.size === resultados.length ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    {selecionados.size === resultados.length ? "Desmarcar todos" : "Selecionar todos"}
                  </Button>
                )}
              </div>

              {resultados.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Empresa</TableHead>
                        <TableHead>Contato</TableHead>
                        <TableHead><div className="flex items-center gap-1"><MapPin className="h-3 w-3" />Local</div></TableHead>
                        <TableHead className="text-center">Score</TableHead>
                        <TableHead className="text-center">Temp.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultados.map((lead, i) => {
                        const temp = tempConfig[lead.temperatura] ?? tempConfig.frio;
                        const TempIcon = temp.icon;
                        return (
                          <TableRow key={i} className={`cursor-pointer transition-colors ${selecionados.has(i) ? "bg-primary/5" : ""}`} onClick={() => toggleSelecionado(i)}>
                            <TableCell>
                              {selecionados.has(i) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-sm">{lead.nome}</p>
                              {lead.cnpj && (
                                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Hash className="h-3 w-3" />{fmtCNPJ(lead.cnpj)}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5">
                                {lead.telefone && <p className="flex items-center gap-1 text-xs"><Phone className="h-3 w-3 text-muted-foreground" />{fmtTel(lead.telefone)}</p>}
                                {lead.email && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" /><span className="truncate max-w-[140px]">{lead.email}</span></p>}
                                {!lead.telefone && !lead.email && <span className="text-xs text-muted-foreground">—</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {[lead.cidade, lead.estado].filter(Boolean).join(" - ") || "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`text-sm font-bold ${lead.score_ia >= 70 ? "text-orange-400" : lead.score_ia >= 40 ? "text-yellow-400" : "text-blue-400"}`}>
                                {lead.score_ia}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${temp.className}`}>
                                <TempIcon className="h-3.5 w-3.5" />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Ações */}
              {selecionados.size > 0 && (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={importando} onClick={salvarEmLeads}>
                    {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Salvar em Leads ({selecionados.size})
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => setDisparoAberto(!disparoAberto)}>
                    <Send className="h-4 w-4" />
                    Criar Disparo WhatsApp
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${disparoAberto ? "rotate-180" : ""}`} />
                  </Button>
                </div>
              )}

              {/* Painel criar disparo */}
              {disparoAberto && selecionados.size > 0 && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Send className="h-4 w-4 text-primary" />
                      Configurar Disparo WhatsApp
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {leadsComTelefone.length} leads com telefone
                    </Badge>
                  </div>

                  {leadsComTelefone.length === 0 && (
                    <p className="text-xs text-destructive bg-destructive/10 rounded p-2">
                      Nenhum lead selecionado tem telefone. Refaça a busca com "Com telefone" ativado.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome do disparo *</Label>
                    <Input value={nomeDisparo} onChange={(e) => setNomeDisparo(e.target.value)} placeholder="Ex: Prospecção Clínicas SP - Mai/2026" />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Mensagem *
                      <span className="text-muted-foreground ml-2 font-normal">
                        Variáveis: <code className="bg-muted px-1 rounded text-[11px]">{"{{primeiro_nome}}"}</code> <code className="bg-muted px-1 rounded text-[11px]">{"{{empresa}}"}</code> <code className="bg-muted px-1 rounded text-[11px]">{"{{telefone}}"}</code>
                      </span>
                    </Label>
                    <Textarea
                      rows={5}
                      value={mensagemTemplate}
                      onChange={(e) => setMensagemTemplate(e.target.value)}
                      className="text-sm font-mono resize-none"
                    />
                  </div>

                  {/* Preview */}
                  {primeiroLeadComTel && (
                    <Collapsible open={mostrarPreview} onOpenChange={setMostrarPreview}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 px-2">
                          <Eye className="h-3.5 w-3.5" />
                          {mostrarPreview ? "Ocultar preview" : "Ver preview com primeiro lead"}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 rounded-lg bg-[#075E54]/10 border border-[#075E54]/20 p-3">
                          <p className="text-[10px] text-muted-foreground mb-1">Mensagem para: {primeiroLeadComTel.nome}</p>
                          <p className="text-sm whitespace-pre-wrap">
                            {renderTpl(mensagemTemplate, primeiroLeadComTel)}
                          </p>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => setDisparoAberto(false)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5 flex-1"
                      disabled={criandoDisparo || leadsComTelefone.length === 0}
                      onClick={criarDisparo}
                    >
                      {criandoDisparo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {criandoDisparo ? "Criando…" : `Criar Rascunho com ${leadsComTelefone.length} leads → ir para Disparos`}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t">
          <Button variant="outline" onClick={fechar} className="w-full">Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useCallback } from "react";
import {
  Zap, Phone, User, Calendar, MessageCircle, RefreshCw, ExternalLink, AlertCircle, CheckCircle2, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// Ícones manuais para evitar erros de importação da lucide-react
const Facebook = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const Instagram = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

interface LeadAds {
  id: string;
  nome: string;
  telefone: string;
  email?: string;
  campanha: string;
  campanha_id: string;
  plataforma: "facebook" | "instagram";
  capturado_em: string;
  status_crm: "novo" | "no_crm" | "cris_ativada" | "em_atendimento";
  origem: "real" | "mock";
}

const MOCK_LEADS: LeadAds[] = [
  { id: "l1", nome: "Ana Paula Souza", telefone: "5511991234567", email: "ana@email.com",
    campanha: "Lançamento Imóveis Junho", campanha_id: "mock-1", plataforma: "facebook",
    capturado_em: new Date(Date.now() - 2 * 60 * 60000).toISOString(), status_crm: "cris_ativada", origem: "mock" },
  { id: "l2", nome: "Carlos Mendes", telefone: "5511982345678",
    campanha: "WhatsApp Click-to-Chat", campanha_id: "mock-2", plataforma: "facebook",
    capturado_em: new Date(Date.now() - 5 * 60 * 60000).toISOString(), status_crm: "no_crm", origem: "mock" },
  { id: "l3", nome: "Fernanda Lima", telefone: "5511973456789", email: "fer@email.com",
    campanha: "Lançamento Imóveis Junho", campanha_id: "mock-1", plataforma: "instagram",
    capturado_em: new Date(Date.now() - 12 * 60 * 60000).toISOString(), status_crm: "novo", origem: "mock" },
  { id: "l4", nome: "Roberto Dias", telefone: "5511964567890",
    campanha: "WhatsApp Click-to-Chat", campanha_id: "mock-2", plataforma: "facebook",
    capturado_em: new Date(Date.now() - 24 * 60 * 60000).toISOString(), status_crm: "em_atendimento", origem: "mock" },
];

const STATUS_CONFIG: Record<LeadAds["status_crm"], { cor: string; label: string; icon: React.ElementType }> = {
  novo:           { cor: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "Novo", icon: Clock },
  no_crm:         { cor: "bg-blue-100 text-blue-700 border-blue-300",       label: "No CRM", icon: CheckCircle2 },
  cris_ativada:   { cor: "bg-green-100 text-green-700 border-green-300",    label: "Cris Ativada", icon: Zap },
  em_atendimento: { cor: "bg-purple-100 text-purple-700 border-purple-300", label: "Em atendimento", icon: MessageCircle },
};

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (h >= 24) return `há ${Math.floor(h / 24)}d`;
  if (h > 0) return `há ${h}h`;
  return `há ${m}min`;
}

interface Props { metaConectado: boolean; }

export function LeadsCaptados({ metaConectado }: Props) {
  const [leads, setLeads] = useState<LeadAds[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [ativando, setAtivando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    if (!metaConectado) {
      await new Promise((r) => setTimeout(r, 500));
      setLeads(MOCK_LEADS);
      setIsMock(true);
      setLoading(false);
      return;
    }
    try {
      const token = localStorage.getItem("crm_access_token") || "";
      const r = await fetch(`${BASE}/api/marketing/leads?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setLeads(data.leads ?? []);
      setIsMock(false);
    } catch {
      setLeads(MOCK_LEADS);
      setIsMock(true);
    } finally {
      setLoading(false);
    }
  }, [metaConectado]);

  useEffect(() => { carregar(); }, [carregar]);

  const ativarCris = async (lead: LeadAds) => {
    if (isMock) {
      toast.info("Conecte a conta Meta e o CRM para ativar a Cris com leads reais.");
      return;
    }
    setAtivando(lead.id);
    try {
      const token = localStorage.getItem("crm_access_token") || "";
      const r = await fetch(`${BASE}/api/marketing/leads/${lead.id}/ativar-cris`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ telefone: lead.telefone, nome: lead.nome, campanha: lead.campanha }),
      });
      if (!r.ok) throw new Error();
      toast.success(`✅ Cris ativada para ${lead.nome}!`);
      setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, status_crm: "cris_ativada" } : l));
    } catch {
      toast.error("Erro ao ativar a Cris. Tente novamente.");
    } finally {
      setAtivando(null);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      {isMock && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Leads de demonstração.</strong> Conecte Meta Ads na aba <strong>Conta Meta</strong> e configure o webhook de Lead Ads para receber leads reais.
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{leads.length} leads capturados</p>
        <Button size="sm" variant="ghost" onClick={carregar} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <Zap className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p>Nenhum lead capturado ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => {
            const scfg = STATUS_CONFIG[lead.status_crm];
            const StatusIcon = scfg.icon;
            return (
              <Card key={lead.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-sm font-bold">
                        {lead.nome.charAt(0)}
                      </div>
                      {/* Info */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{lead.nome}</p>
                          <Badge className={`text-xs border flex items-center gap-1 ${scfg.cor}`}>
                            <StatusIcon className="h-2.5 w-2.5" /> {scfg.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {lead.telefone}
                          </span>
                          {lead.email && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />{lead.email}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            {lead.plataforma === "facebook"
                              ? <Facebook className="h-3 w-3 text-blue-600" />
                              : <Instagram className="h-3 w-3 text-pink-600" />}
                            {lead.campanha}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {tempoRelativo(lead.capturado_em)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Ações */}
                    <div className="flex gap-2 shrink-0">
                      {lead.status_crm === "novo" || lead.status_crm === "no_crm" ? (
                        <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700"
                          onClick={() => ativarCris(lead)}
                          disabled={ativando === lead.id}>
                          <Zap className="h-3.5 w-3.5" />
                          {ativando === lead.id ? "Ativando..." : "Ativar Cris"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="gap-1.5"
                        onClick={() => window.open(`https://wa.me/${lead.telefone}`, "_blank")}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

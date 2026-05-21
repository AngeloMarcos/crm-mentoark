# Prompt Lovable 4 — Marketing Digital: Dashboard de Campanhas Reais (Meta API Ready)

## Objetivo
Construir a aba **Campanhas** com dashboard completo que exibe campanhas reais da conta Meta Ads quando conectada, ou dados de demonstração quando não conectada — preparado para receber dados reais sem alteração de código.

---

## Contexto técnico
- Endpoint: `GET /api/marketing/campanhas?status=ACTIVE|PAUSED|ALL`
- Retorna array de campanhas com métricas do período (padrão: últimos 30 dias)
- Quando Meta não conectado (401), componente exibe dados mock com banner de aviso
- Quando Meta conectado, exibe dados reais com botões de ação (pausar/reativar)

---

## 1. Criar `src/components/marketing/useCampanhas.ts`

```ts
import { useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.VITE_API_URL || "https://api.mentoark.com.br";

export interface Campanha {
  id: string;
  nome: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
  objetivo: string;
  plataforma: "facebook" | "instagram" | "ambos";
  orcamentoDiario: number;
  orcamentoTotal: number;
  inicio: string;
  fim?: string;
  // Métricas
  impressoes: number;
  alcance: number;
  cliques: number;
  ctr: number;
  cpc: number;
  gastoTotal: number;
  leads: number;
  cpl: number;
  origem: "real" | "mock";
}

const MOCK_CAMPANHAS: Campanha[] = [
  {
    id: "mock-1", nome: "Lançamento Imóveis Junho", status: "ACTIVE", objetivo: "Leads",
    plataforma: "ambos", orcamentoDiario: 80, orcamentoTotal: 2400, inicio: "2025-06-01",
    impressoes: 48200, alcance: 22300, cliques: 867, ctr: 1.8, cpc: 2.77,
    gastoTotal: 1240, leads: 213, cpl: 5.82, origem: "mock",
  },
  {
    id: "mock-2", nome: "WhatsApp Click-to-Chat", status: "ACTIVE", objetivo: "Mensagens",
    plataforma: "facebook", orcamentoDiario: 40, orcamentoTotal: 1200, inicio: "2025-06-10",
    impressoes: 31500, alcance: 14800, cliques: 756, ctr: 2.4, cpc: 1.59,
    gastoTotal: 620, leads: 189, cpl: 3.28, origem: "mock",
  },
  {
    id: "mock-3", nome: "Branding Instagram Stories", status: "PAUSED", objetivo: "Alcance",
    plataforma: "instagram", orcamentoDiario: 30, orcamentoTotal: 900, inicio: "2025-05-15", fim: "2025-05-30",
    impressoes: 92000, alcance: 61000, cliques: 460, ctr: 0.5, cpc: 1.96,
    gastoTotal: 900, leads: 14, cpl: 64.29, origem: "mock",
  },
];

export function useCampanhas(metaConectado: boolean) {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");

  const carregar = useCallback(async () => {
    setLoading(true);
    if (!metaConectado) {
      await new Promise((r) => setTimeout(r, 600));
      setCampanhas(MOCK_CAMPANHAS);
      setIsMock(true);
      setLoading(false);
      return;
    }
    try {
      const token = localStorage.getItem("crm_access_token") || "";
      const r = await fetch(`${BASE}/api/marketing/campanhas?status=${filtroStatus}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setCampanhas(data.campanhas ?? []);
      setIsMock(false);
    } catch {
      setCampanhas(MOCK_CAMPANHAS);
      setIsMock(true);
    } finally {
      setLoading(false);
    }
  }, [metaConectado, filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);

  const pausar = async (id: string) => {
    if (isMock) return;
    const token = localStorage.getItem("crm_access_token") || "";
    await fetch(`${BASE}/api/marketing/campanhas/${id}/pausar`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    carregar();
  };

  const reativar = async (id: string) => {
    if (isMock) return;
    const token = localStorage.getItem("crm_access_token") || "";
    await fetch(`${BASE}/api/marketing/campanhas/${id}/reativar`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    carregar();
  };

  return { campanhas, loading, isMock, filtroStatus, setFiltroStatus, recarregar: carregar, pausar, reativar };
}
```

---

## 2. Criar `src/components/marketing/CampanhasDashboard.tsx`

```tsx
import { Facebook, Instagram, Megaphone, Pause, Play, RefreshCw, AlertCircle, TrendingUp, MousePointer, DollarSign, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useCampanhas, type Campanha } from "./useCampanhas";

const STATUS_CONFIG: Record<string, { cor: string; label: string }> = {
  ACTIVE:   { cor: "bg-green-100 text-green-700 border-green-300",  label: "Ativa" },
  PAUSED:   { cor: "bg-yellow-100 text-yellow-700 border-yellow-300", label: "Pausada" },
  ARCHIVED: { cor: "bg-gray-100 text-gray-600 border-gray-300",     label: "Arquivada" },
  DELETED:  { cor: "bg-red-100 text-red-600 border-red-300",        label: "Removida" },
};

const PLATAFORMA_ICON = {
  facebook: <Facebook className="h-3.5 w-3.5 text-blue-600" />,
  instagram: <Instagram className="h-3.5 w-3.5 text-pink-600" />,
  ambos: <span className="text-xs">FB+IG</span>,
};

function CampanhaCard({ campanha, isMock, onPausar, onReativar }: {
  campanha: Campanha; isMock: boolean;
  onPausar: () => void; onReativar: () => void;
}) {
  const cfg = STATUS_CONFIG[campanha.status];
  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="pt-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {PLATAFORMA_ICON[campanha.plataforma]}
              <Badge className={`text-xs border ${cfg.cor}`}>{cfg.label}</Badge>
              <span className="text-xs text-muted-foreground">{campanha.objetivo}</span>
            </div>
            <p className="font-semibold text-sm truncate">{campanha.nome}</p>
            <p className="text-xs text-muted-foreground">
              Desde {new Date(campanha.inicio).toLocaleDateString("pt-BR")}
              {campanha.fim ? ` até ${new Date(campanha.fim).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
          {/* Ações */}
          {!isMock && (
            <div className="flex gap-1 shrink-0">
              {campanha.status === "ACTIVE" ? (
                <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-yellow-600"
                  onClick={() => { onPausar(); toast.success("Campanha pausada."); }}
                  title="Pausar">
                  <Pause className="h-3.5 w-3.5" />
                </Button>
              ) : campanha.status === "PAUSED" ? (
                <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-green-600"
                  onClick={() => { onReativar(); toast.success("Campanha reativada."); }}
                  title="Reativar">
                  <Play className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          {[
            { icon: Users,        label: "Alcance",    valor: campanha.alcance.toLocaleString("pt-BR") },
            { icon: MousePointer, label: "Cliques",    valor: campanha.cliques.toLocaleString("pt-BR") },
            { icon: TrendingUp,   label: "Leads",      valor: campanha.leads.toLocaleString("pt-BR"), destaque: true },
          ].map(({ icon: Icon, label, valor, destaque }) => (
            <div key={label} className={`rounded-lg p-2 text-center ${destaque ? "bg-blue-50 dark:bg-blue-950/20" : "bg-muted/50"}`}>
              <Icon className={`h-3.5 w-3.5 mx-auto mb-0.5 ${destaque ? "text-blue-600" : "text-muted-foreground"}`} />
              <p className={`font-bold text-sm ${destaque ? "text-blue-600" : ""}`}>{valor}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* CPL e gasto */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            Gasto: <strong>R$ {campanha.gastoTotal.toLocaleString("pt-BR")}</strong>
          </span>
          <span className="text-muted-foreground">
            CPL: <strong className={campanha.cpl < 30 ? "text-green-600" : "text-yellow-600"}>
              R$ {campanha.cpl.toFixed(2)}
            </strong>
          </span>
          <span className="text-muted-foreground">CTR: <strong>{campanha.ctr.toFixed(2)}%</strong></span>
        </div>
      </CardContent>
    </Card>
  );
}

// Totalizadores
function TotaisResumo({ campanhas }: { campanhas: Campanha[] }) {
  const ativas = campanhas.filter((c) => c.status === "ACTIVE");
  const totalLeads = campanhas.reduce((a, c) => a + c.leads, 0);
  const totalGasto = campanhas.reduce((a, c) => a + c.gastoTotal, 0);
  const cplMedio = totalLeads > 0 ? totalGasto / totalLeads : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[
        { label: "Campanhas ativas", valor: String(ativas.length), icon: Megaphone, cor: "text-green-600" },
        { label: "Total de leads",   valor: totalLeads.toLocaleString("pt-BR"), icon: TrendingUp, cor: "text-blue-600" },
        { label: "Gasto total",      valor: `R$ ${totalGasto.toLocaleString("pt-BR")}`, icon: DollarSign, cor: "text-muted-foreground" },
        { label: "CPL médio",        valor: `R$ ${cplMedio.toFixed(2)}`, icon: MousePointer, cor: cplMedio < 40 ? "text-green-600" : "text-yellow-600" },
      ].map(({ label, valor, icon: Icon, cor }) => (
        <Card key={label}>
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-bold mt-0.5 ${cor}`}>{valor}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface Props { metaConectado: boolean; }

export function CampanhasDashboard({ metaConectado }: Props) {
  const { campanhas, loading, isMock, filtroStatus, setFiltroStatus, recarregar, pausar, reativar } = useCampanhas(metaConectado);

  const filtradas = filtroStatus === "ALL" ? campanhas : campanhas.filter((c) => c.status === filtroStatus);

  return (
    <div className="mt-6 space-y-4">

      {/* Banner mock */}
      {isMock && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Dados de demonstração.</strong> Conecte sua conta Meta Ads na aba <strong>Conta Meta</strong> para ver campanhas reais.
          </div>
        </div>
      )}

      {/* Filtros + reload */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {(["ALL", "ACTIVE", "PAUSED"] as const).map((s) => (
            <Button key={s} size="sm" variant={filtroStatus === s ? "default" : "outline"}
              onClick={() => setFiltroStatus(s)}>
              {s === "ALL" ? "Todas" : s === "ACTIVE" ? "Ativas" : "Pausadas"}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={recarregar} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {/* Totais */}
      {!loading && <TotaisResumo campanhas={campanhas} />}

      {/* Grid de campanhas */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p>Nenhuma campanha encontrada.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtradas.map((c) => (
            <CampanhaCard key={c.id} campanha={c} isMock={isMock}
              onPausar={() => pausar(c.id)} onReativar={() => reativar(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 3. Atualizar `src/pages/MarketingDigital.tsx`

Substituir placeholder da aba `campanhas`:

```tsx
import { CampanhasDashboard } from "@/components/marketing/CampanhasDashboard";

// Na aba campanhas:
<TabsContent value="campanhas">
  <CampanhasDashboard metaConectado={meta.conectado} />
</TabsContent>
```

---

## Não alterar
Nenhum outro arquivo.

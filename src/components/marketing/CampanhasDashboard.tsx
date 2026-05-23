import { Megaphone, Pause, Play, RefreshCw, AlertCircle, TrendingUp, MousePointer, DollarSign, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useCampanhas, type Campanha } from "./useCampanhas";

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

function CampanhaCard({ campanha, onPausar, onReativar }: {
  campanha: Campanha;
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
  const { campanhas, loading, erro, filtroStatus, setFiltroStatus, recarregar, pausar, reativar } = useCampanhas(metaConectado);

  const filtradas = filtroStatus === "ALL" ? campanhas : campanhas.filter((c) => c.status === filtroStatus);

  return (
    <div className="mt-6 space-y-4">

      {/* Banner Meta não conectado */}
      {!metaConectado && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 p-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Conta Meta não conectada.</strong> Acesse a aba <strong>Conta Meta</strong> para conectar e visualizar suas campanhas reais.
          </div>
        </div>
      )}

      {/* Banner erro */}
      {erro && metaConectado && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-800 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div><strong>Falha ao carregar:</strong> {erro}</div>
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

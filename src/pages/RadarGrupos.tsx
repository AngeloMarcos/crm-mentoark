import { useQuery } from "@tanstack/react-query";
import { CRMLayout } from "@/components/CRMLayout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/integrations/database/client";
import { AbaBuscar } from "@/components/radar/AbaBuscar";
import { AbaCatalogo } from "@/components/radar/AbaCatalogo";
import { AbaConfig } from "@/components/radar/AbaConfig";
import { StatusRadar } from "@/components/radar/tipos";

export default function RadarGruposPage() {
  const status = useQuery({
    queryKey: ["radar-status"],
    queryFn: async () => (await api.get("/api/radar/status")).data as StatusRadar,
    refetchInterval: 15000,
  });
  const s = status.data;

  return (
    <CRMLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Radar de Grupos</h1>
          <p className="text-muted-foreground">
            Encontre e avalie grupos de WhatsApp por nicho. Nesta etapa o Radar só pesquisa e lê convites: não entra em grupos.
          </p>
        </div>

        {s && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={s.busca_real ? "default" : "destructive"}>{s.busca_real ? `Busca ativa · ${s.provider}` : "Busca real desligada"}</Badge>
            <Badge variant="outline">Hoje: {s.consultas_hoje}/{s.limite_consultas_dia} chamadas</Badge>
            <Badge variant="outline">Fila: {s.fila === "redis" ? "Redis" : "inline"}</Badge>
            {s.redis && <Badge variant={s.redis.alerta ? "destructive" : "outline"}>Redis {s.redis.usadoMb}/{s.redis.maxMb} MB</Badge>}
            <Badge variant={s.leitura_convites.configurada ? "outline" : "secondary"}>
              Leitura de convites: {s.leitura_convites.configurada ? s.leitura_convites.instancia : "desligada"}
            </Badge>
          </div>
        )}

        {(s?.pausas?.busca || s?.pausas?.verificacao_links) && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
            {s.pausas?.busca && <div><strong>Buscas</strong> {s.pausas.busca}. O Radar espera sozinho para não agravar o bloqueio.</div>}
            {s.pausas?.verificacao_links && <div><strong>Verificação de links</strong> {s.pausas.verificacao_links}.</div>}
          </div>
        )}

        <Tabs defaultValue="buscar" className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="buscar">Buscar</TabsTrigger>
            <TabsTrigger value="catalogo">Catálogo</TabsTrigger>
            <TabsTrigger value="config">Configurações e pesos</TabsTrigger>
          </TabsList>
          <TabsContent value="buscar"><AbaBuscar status={s} /></TabsContent>
          <TabsContent value="catalogo"><AbaCatalogo status={s} /></TabsContent>
          <TabsContent value="config"><AbaConfig /></TabsContent>
        </Tabs>
      </div>
    </CRMLayout>
  );
}

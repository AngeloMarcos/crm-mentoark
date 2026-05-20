import { Trash2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type ProjecaoResultado, type ProjecaoInputs } from "./tipos";

export interface SimulacaoSalva {
  id: string;
  nome: string;
  inputs: ProjecaoInputs;
  resultado: ProjecaoResultado;
  criadaEm: string;
}

const OBJETIVO_LABEL: Record<string, string> = {
  leads: "Leads", mensagens_whatsapp: "Msg WA", trafego: "Tráfego",
  conversoes: "Conversões", alcance: "Alcance", engajamento: "Engajamento",
};
const PLATAFORMA_EMOJI: Record<string, string> = { facebook: "🔵", instagram: "🟣", ambos: "🟡" };
const VIA_COR: Record<string, string> = {
  excelente: "bg-green-100 text-green-700", boa: "bg-green-100 text-green-700",
  moderada: "bg-yellow-100 text-yellow-700", baixa: "bg-red-100 text-red-700",
};

interface Props { historico: SimulacaoSalva[]; onRemover: (id: string) => void; }

export function ProjecaoComparativo({ historico, onRemover }: Props) {
  if (historico.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <TrendingUp className="h-4 w-4 text-blue-600" />
          Comparativo de Simulações ({historico.length}/5)
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium">Simulação</th>
              <th className="text-right py-2 px-2 font-medium">Investimento</th>
              <th className="text-right py-2 px-2 font-medium">Resultado</th>
              <th className="text-right py-2 px-2 font-medium">CPL</th>
              <th className="text-right py-2 px-2 font-medium">Alcance</th>
              <th className="text-right py-2 px-2 font-medium">Viabilidade</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {historico.map((item) => {
              const r = item.resultado;
              return (
                <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-3 pr-4">
                    <p className="font-medium">{item.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {PLATAFORMA_EMOJI[item.inputs.plataforma]} {OBJETIVO_LABEL[item.inputs.objetivo]} · {item.inputs.duracaoDias}d · {item.criadaEm}
                    </p>
                  </td>
                  <td className="text-right px-2 font-medium">R$ {r.orcamentoTotal.toLocaleString("pt-BR")}</td>
                  <td className="text-right px-2 font-bold text-blue-600">{r.leadsTotal.toLocaleString("pt-BR")}</td>
                  <td className="text-right px-2">R$ {r.cpl.toFixed(2)}</td>
                  <td className="text-right px-2 text-muted-foreground">{r.alcanceTotal.toLocaleString("pt-BR")}</td>
                  <td className="text-right px-2">
                    <Badge className={`text-xs ${VIA_COR[r.viabilidade]}`}>{r.viabilidade}</Badge>
                  </td>
                  <td className="pl-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-500"
                      onClick={() => onRemover(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

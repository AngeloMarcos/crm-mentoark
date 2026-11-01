/**
 * O que o agente sabe (2026-11-01, modelo Cubo: bases de conhecimento ligadas ao agente, com status
 * de indexação). Resumo dos itens deste agente + os compartilhados, direto na página do agente; a
 * edição completa abre em Bases de conhecimento já filtrada por ele.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Brain, Database, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/integrations/database/client";
import { useAuth } from "@/hooks/useAuth";
import { indexarConhecimentoAgora } from "@/lib/baseConhecimento";

interface Item {
  id: string;
  tipo: string;
  campo: string | null;
  conteudo: string;
  agente_id: string | null;
  status_indexacao: string | null;
  erro_indexacao: string | null;
}

const ROTULO_TIPO: Record<string, string> = {
  personalidade: "Persona", negocio: "Negócio", faq: "FAQ", objecao: "Objeção", script: "Script",
};

const ESTILO_STATUS: Record<string, { rotulo: string; classe: string }> = {
  indexado: { rotulo: "Indexado", classe: "bg-success/15 text-success" },
  erro: { rotulo: "Erro", classe: "bg-destructive/15 text-destructive" },
  indexando: { rotulo: "Indexando", classe: "bg-primary/15 text-primary" },
  pendente: { rotulo: "Aguardando", classe: "bg-warning/15 text-warning" },
};

export function ConhecimentoDoAgente({ agenteId, ragAtivo }: { agenteId: string; ragAtivo: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [indexando, setIndexando] = useState(false);

  const carregar = useCallback(async () => {
    if (!user) return;
    const { data } = await (api as any)
      .from("conhecimento")
      .select("id, tipo, campo, conteudo, agente_id, status_indexacao, erro_indexacao")
      .eq("user_id", user.id);
    setItens(((data ?? []) as Item[]).filter((i) => !i.agente_id || i.agente_id === agenteId));
  }, [user, agenteId]);

  useEffect(() => { carregar(); }, [carregar]);

  const resumo = useMemo(() => {
    const lista = itens ?? [];
    const st = (i: Item) => i.status_indexacao ?? "pendente";
    return {
      total: lista.length,
      proprios: lista.filter((i) => i.agente_id === agenteId).length,
      indexados: lista.filter((i) => st(i) === "indexado").length,
      aguardando: lista.filter((i) => st(i) === "pendente" || st(i) === "indexando").length,
      erros: lista.filter((i) => st(i) === "erro").length,
    };
  }, [itens, agenteId]);

  const indexar = async () => {
    setIndexando(true);
    try {
      const r = await indexarConhecimentoAgora();
      if (r.erros) toast.error(`${r.erros} ${r.erros === 1 ? "item não foi indexado" : "itens não foram indexados"}. Confira a integração OpenAI.`);
      else toast.success(r.indexados ? `${r.indexados} itens indexados.` : "Nada pendente.");
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setIndexando(false);
      carregar();
    }
  };

  const abrirBase = () => navigate(`/cerebro?agente=${agenteId}`);

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Brain className="h-5 w-5" />
            <h3 className="font-semibold">O que este agente sabe</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Itens só deste agente + os compartilhados com todos. A IA consulta o que estiver indexado.
          </p>
        </div>
        <div className="flex gap-2">
          {resumo.aguardando > 0 && (
            <Button size="sm" variant="outline" onClick={indexar} disabled={indexando}>
              {indexando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />} Indexar agora
            </Button>
          )}
          <Button size="sm" onClick={abrirBase}><Plus className="h-3.5 w-3.5" /> Adicionar / editar</Button>
        </div>
      </div>

      {itens === null ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span><strong>{resumo.total}</strong> itens ({resumo.proprios} só dele)</span>
            <span className="text-success"><strong>{resumo.indexados}</strong> indexados</span>
            {resumo.aguardando > 0 && <span className="text-warning"><strong>{resumo.aguardando}</strong> aguardando</span>}
            {resumo.erros > 0 && <span className="text-destructive"><strong>{resumo.erros}</strong> com erro</span>}
          </div>

          {!ragAtivo && (
            <p className="text-xs text-warning flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              A busca na base está desligada para este agente (configuração abaixo): a IA não consulta estes itens.
            </p>
          )}
          {ragAtivo && resumo.indexados === 0 && (
            <p className="text-xs text-warning flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {resumo.total === 0
                ? "A base está vazia: o agente responde só com o prompt. Adicione FAQs, objeções e informações do negócio."
                : "Nenhum item indexado ainda: a IA ainda não consegue consultar a base."}
            </p>
          )}

          {(itens ?? []).length > 0 && (
            <div className="divide-y rounded-md border">
              {(itens ?? []).slice(0, 8).map((i) => {
                const st = ESTILO_STATUS[i.status_indexacao ?? "pendente"] ?? ESTILO_STATUS.pendente;
                return (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Badge variant="outline" className="text-xs shrink-0">{ROTULO_TIPO[i.tipo] ?? i.tipo}</Badge>
                    <span className="truncate flex-1">{i.campo || i.conteudo}</span>
                    {!i.agente_id && <span className="text-xs text-muted-foreground shrink-0">compartilhado</span>}
                    <Badge className={`border-0 text-xs shrink-0 ${st.classe}`} title={i.erro_indexacao ?? undefined}>{st.rotulo}</Badge>
                  </div>
                );
              })}
              {(itens ?? []).length > 8 && (
                <button className="w-full px-3 py-2 text-xs text-primary text-left hover:bg-muted/40" onClick={abrirBase}>
                  Ver todos os {(itens ?? []).length} itens →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Integração de IA + modelo do agente (2026-10-29, modelo Cubo): o agente escolhe QUAL chave usa
 * (integração em /integracoes) e o modelo entre os que essa chave libera — lista ao vivo do
 * provedor. "Padrão da conta" mantém o comportamento antigo: primeira integração ativa, com o
 * modelo gravado nela (o motor ignora o modelo do agente nesse caso).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IntegracaoIA, ModeloIA, listarIntegracoesIA, modelosDaIntegracao } from "@/lib/integracoes";

const PADRAO = "__padrao";

interface Props {
  providerId: string;
  modelo: string;
  onChange: (v: { providerId: string; modelo: string; slug: string | null }) => void;
}

export function SeletorIntegracaoModelo({ providerId, modelo, onChange }: Props) {
  const [ias, setIas] = useState<IntegracaoIA[] | null>(null);
  const [modelos, setModelos] = useState<ModeloIA[]>([]);
  const [carregandoModelos, setCarregandoModelos] = useState(false);
  const [erroModelos, setErroModelos] = useState<string | null>(null);

  useEffect(() => {
    listarIntegracoesIA().then(setIas).catch(() => setIas([]));
  }, []);

  useEffect(() => {
    if (!providerId) { setModelos([]); setErroModelos(null); return; }
    let vivo = true;
    setCarregandoModelos(true);
    setErroModelos(null);
    modelosDaIntegracao(providerId)
      .then((r) => { if (vivo) setModelos(r.modelos); })
      .catch((e: Error) => { if (vivo) { setModelos([]); setErroModelos(e.message); } })
      .finally(() => { if (vivo) setCarregandoModelos(false); });
    return () => { vivo = false; };
  }, [providerId]);

  const selecionada = ias?.find((i) => i.id === providerId) ?? null;
  const padraoDaConta = ias?.find((i) => i.ativo) ?? null;

  const trocarIntegracao = (v: string) => {
    if (v === PADRAO) { onChange({ providerId: "", modelo, slug: null }); return; }
    const ia = ias?.find((i) => i.id === v);
    // Começa no modelo padrão da integração; a lista ao vivo chega em seguida.
    onChange({ providerId: v, modelo: ia?.modelo || modelo, slug: ia?.slug ?? null });
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Integração de IA</Label>
          <Select value={providerId || PADRAO} onValueChange={trocarIntegracao} disabled={ias === null}>
            <SelectTrigger><SelectValue placeholder="Carregando..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PADRAO}>Padrão da conta{padraoDaConta ? ` (${padraoDaConta.nome})` : ""}</SelectItem>
              {(ias ?? []).map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.nome}{!i.ativo ? " (desligada)" : i.ultimo_status === "erro" ? " (chave recusada)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Modelo</Label>
          {!providerId ? (
            <div className="h-10 px-3 rounded-md border bg-muted/30 text-sm flex items-center text-muted-foreground">
              {padraoDaConta ? `${padraoDaConta.modelo} (definido na integração)` : "—"}
            </div>
          ) : (
            <Select value={modelo} onValueChange={(v) => onChange({ providerId, modelo: v, slug: selecionada?.slug ?? null })} disabled={carregandoModelos}>
              <SelectTrigger>
                {carregandoModelos
                  ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando modelos da chave...</span>
                  : <SelectValue />}
              </SelectTrigger>
              <SelectContent>
                {/* O modelo gravado nunca some da lista, mesmo que a chave não o liste. */}
                {modelo && !modelos.some((m) => m.id === modelo) && (
                  <SelectItem value={modelo}>{modelo} (atual)</SelectItem>
                )}
                {modelos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.rotulo}{m.ferramentas === false ? " — sem ferramentas" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {ias !== null && ias.length === 0 && (
        <p className="text-xs text-warning flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Nenhuma integração de IA cadastrada: o agente usa a chave do servidor, que pode não estar disponível.
          Conecte a sua em <a href="/integracoes" className="underline underline-offset-2">Integrações</a>.
        </p>
      )}
      {erroModelos && (
        <p className="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {erroModelos} Enquanto isso, o agente não responde. Troque a chave em <a href="/integracoes" className="underline underline-offset-2">Integrações</a>.
        </p>
      )}
      {!providerId && padraoDaConta?.ultimo_status === "erro" && (
        <p className="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          A integração padrão da conta está com a chave recusada: {padraoDaConta.ultimo_erro}
        </p>
      )}
    </div>
  );
}

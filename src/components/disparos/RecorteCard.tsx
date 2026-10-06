import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { api } from "@/integrations/database/client";
import { toast } from "sonner";

export interface RecorteAudiencia {
  selecionados: number;
  elegiveis: number;
  excluidos: Record<string, number>;
  rotulos: Record<string, string>;
  comPropensao: number;
  frios?: number; // Sprint 3 / H7: quantos nunca conversaram com a empresa
  // Sprint 8 (Sprint 4 / H5): resumo entre os elegíveis antes de confirmar.
  resumo?: { a_verificar: number; a_verificar_ids: string[]; sem_nome: number; aviso_sem_nome: boolean; contatados_7d: number };
}

export interface OpcoesRecorte { excluirRobos: boolean; excluirSemNome: boolean; somenteConhecidos?: boolean; permitirEstrangeiros?: boolean }

/** Recorte real da audiência antes de disparar: quem entra, quem sai e por quê (nada some em silêncio). */
export function RecorteCard({
  recorte, opcoes, onChange, carregando,
}: { recorte: RecorteAudiencia | null; opcoes: OpcoesRecorte; onChange: (o: OpcoesRecorte) => void; carregando: boolean }) {
  const [validando, setValidando] = useState(false);
  if (!recorte && !carregando) return null;
  const motivos = Object.entries(recorte?.excluidos ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const totalExcluidos = motivos.reduce((s, [, n]) => s + n, 0);
  // Sprint 3 / H7: lista com muitos contatos frios (nunca conversaram) é o perfil de disparo que
  // mais gera bloqueio/denúncia — avisa acima de 30% e oferece mandar só pra quem já conversou.
  const pctFrios = recorte && recorte.selecionados > 0 ? Math.round(((recorte.frios ?? 0) / recorte.selecionados) * 100) : 0;
  const resumo = recorte?.resumo;
  // Sprint 8 / H5: checa no WhatsApp (whatsappNumbers, em lote, pela fila de higienização) os
  // elegíveis que ainda não foram verificados; quem não tiver WhatsApp sai do recorte depois.
  const validarAgora = async () => {
    if (!resumo?.a_verificar_ids.length) return;
    setValidando(true);
    try {
      await api.post("/api/higienizacao/executar", {
        contato_ids: resumo.a_verificar_ids, validar: true, enriquecer: false, classificar: false, respostas: false, propensao: false,
      });
      toast.success("Verificação iniciada", { description: "Acompanhe em Leads → Higienizar. Depois recarregue o recorte." });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || "Não foi possível iniciar a verificação");
    } finally {
      setValidando(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">Recorte da audiência</span>
        {recorte && (
          <span className="text-sm text-muted-foreground">
            {recorte.selecionados} selecionados → <strong className="text-foreground">{recorte.elegiveis} elegíveis</strong>
            {totalExcluidos > 0 && <> · {totalExcluidos} de fora</>}
          </span>
        )}
      </div>

      {motivos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {motivos.map(([m, n]) => (
            <Badge key={m} variant="secondary" className="font-normal">
              {n} {recorte?.rotulos?.[m] ?? m}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
        <div className="flex items-center gap-2">
          <Checkbox id="rc-robos" checked={opcoes.excluirRobos} onCheckedChange={v => onChange({ ...opcoes, excluirRobos: v === true })} />
          <Label htmlFor="rc-robos" className="font-normal text-sm">Excluir empresas com atendimento automático (robô)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="rc-conhecidos" checked={!!opcoes.somenteConhecidos} onCheckedChange={v => onChange({ ...opcoes, somenteConhecidos: v === true })} />
          <Label htmlFor="rc-conhecidos" className="font-normal text-sm">Somente contatos que já conversaram (inbound)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="rc-estrangeiros" checked={!!opcoes.permitirEstrangeiros} onCheckedChange={v => onChange({ ...opcoes, permitirEstrangeiros: v === true })} />
          <Label htmlFor="rc-estrangeiros" className="font-normal text-sm">Liberar números de outros países</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="rc-nome" checked={opcoes.excluirSemNome} onCheckedChange={v => onChange({ ...opcoes, excluirSemNome: v === true })} />
          <Label htmlFor="rc-nome" className="font-normal text-sm">Excluir contatos sem nome (só o número)</Label>
        </div>
      </div>

      {resumo && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Entre os elegíveis: {resumo.sem_nome} sem nome · {resumo.contatados_7d} já receberam campanha nos últimos 7 dias
            {resumo.a_verificar > 0 && <> · {resumo.a_verificar} ainda não verificados no WhatsApp</>}
          </p>
          {resumo.a_verificar > 0 && (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={validarAgora} disabled={validando}>
              {validando ? "Iniciando…" : `Verificar ${resumo.a_verificar} número(s) no WhatsApp agora`}
            </Button>
          )}
        </div>
      )}

      {resumo?.aviso_sem_nome && (
        <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 p-2">
          Mais da metade da lista está sem nome — a mensagem não vai ter personalização (o {"{{primeiro_nome}}"} cai no
          texto padrão). Mensagem genérica em massa tem mais chance de ser denunciada.
        </p>
      )}

      {!opcoes.somenteConhecidos && pctFrios > 30 && (
        <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 p-2">
          {pctFrios}% desta lista nunca conversou com você. Disparo frio é o que mais gera bloqueio e
          denúncia — considere marcar <b>Somente contatos que já conversaram</b> ou aquecer a lista
          com Smart Links e anúncios de clique para WhatsApp.
        </p>
      )}

      {recorte && recorte.comPropensao > 0 && (
        <p className="text-xs text-muted-foreground">
          Os envios começam pelos contatos com maior chance estimada de resposta (histórico das suas campanhas).
        </p>
      )}
    </div>
  );
}

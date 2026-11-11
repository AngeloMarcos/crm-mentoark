/**
 * Campos personalizados de um contato: leitura compacta + edição de todos de uma vez.
 * Usado no painel do contato da conversa (WhatsAppInterface) e na ficha do lead (Leads).
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Pencil, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatarValor, lerValoresDoContato, salvarValoresDoContato,
  type CampoPersonalizado, type ValorCampo,
} from "@/lib/camposPersonalizados";

const NENHUM = "__nenhum__";

/** Valor guardado → texto do input (data em aaaa-mm-dd para o <input type=date>). */
function paraEdicao(c: CampoPersonalizado, v: ValorCampo | undefined): ValorCampo | "" {
  if (v === undefined || v === null) return c.tipo === "multipla" ? [] : "";
  if (c.tipo === "numero" || c.tipo === "moeda") return String(v).replace(".", ",");
  return v;
}

function Editor({ campo, valor, onChange }: { campo: CampoPersonalizado; valor: ValorCampo | ""; onChange: (v: ValorCampo | "") => void }) {
  const id = `cf-${campo.chave}`;
  switch (campo.tipo) {
    case "selecao":
      return (
        <Select value={typeof valor === "string" && valor ? valor : NENHUM} onValueChange={v => onChange(v === NENHUM ? "" : v)}>
          <SelectTrigger id={id} className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUM}>—</SelectItem>
            {campo.opcoes.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "sim_nao":
      return (
        <Select value={valor === true ? "sim" : valor === false ? "nao" : NENHUM} onValueChange={v => onChange(v === "sim" ? true : v === "nao" ? false : "")}>
          <SelectTrigger id={id} className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUM}>—</SelectItem>
            <SelectItem value="sim">Sim</SelectItem>
            <SelectItem value="nao">Não</SelectItem>
          </SelectContent>
        </Select>
      );
    case "multipla": {
      const marcadas = Array.isArray(valor) ? valor : [];
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {campo.opcoes.map(o => (
            <label key={o} className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={marcadas.includes(o)} onCheckedChange={v => onChange(v ? [...marcadas, o] : marcadas.filter(x => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "data":
      return <Input id={id} type="date" className="h-8 text-xs" value={String(valor || "")} onChange={e => onChange(e.target.value)} />;
    case "numero":
    case "moeda":
      return <Input id={id} inputMode="decimal" className="h-8 text-xs" value={String(valor ?? "")} placeholder={campo.tipo === "moeda" ? "R$" : ""} onChange={e => onChange(e.target.value)} />;
    default:
      return <Input id={id} className="h-8 text-xs" maxLength={1000} value={String(valor ?? "")} onChange={e => onChange(e.target.value)} />;
  }
}

/** `compacto`: sem campos cadastrados na conta, não mostra nada (nem o título). */
export function CamposDoContato({ contatoId, compacto = false, titulo }: { contatoId: string; compacto?: boolean; titulo?: string }) {
  const corpo = <CorpoCampos contatoId={contatoId} compacto={compacto} />;
  if (!titulo) return corpo;
  return <SecaoComTitulo titulo={titulo} contatoId={contatoId} compacto={compacto} />;
}

function SecaoComTitulo({ titulo, contatoId, compacto }: { titulo: string; contatoId: string; compacto: boolean }) {
  const [vazio, setVazio] = useState(false);
  if (vazio && compacto) return null;
  return (
    <div>
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{titulo}</p>
      <CorpoCampos contatoId={contatoId} compacto={false} onSemCampos={() => setVazio(true)} />
    </div>
  );
}

function CorpoCampos({ contatoId, compacto, onSemCampos }: { contatoId: string; compacto: boolean; onSemCampos?: () => void }) {
  const [campos, setCampos] = useState<CampoPersonalizado[] | null>(null);
  const [valores, setValores] = useState<Record<string, ValorCampo>>({});
  const [edicao, setEdicao] = useState<Record<string, ValorCampo | ""> | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setCampos(null);
    setEdicao(null);
    lerValoresDoContato(contatoId)
      .then(r => { setCampos(r.campos); setValores(r.valores || {}); if (!r.campos.length) onSemCampos?.(); })
      .catch(() => { setCampos([]); onSemCampos?.(); });
  }, [contatoId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);

  if (campos === null) return <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!campos.length) {
    return compacto ? null : (
      <p className="text-xs text-muted-foreground">
        Nenhum campo personalizado. <Link to="/contatos/campos" className="underline">Criar campos</Link>
      </p>
    );
  }

  const abrirEdicao = () => setEdicao(Object.fromEntries(campos.map(c => [c.chave, paraEdicao(c, valores[c.chave])])));

  const salvar = async () => {
    if (!edicao) return;
    setSalvando(true);
    try {
      const envio: Record<string, ValorCampo | null> = {};
      for (const c of campos) {
        const v = edicao[c.chave];
        envio[c.chave] = v === "" || (Array.isArray(v) && !v.length) ? null : v;
      }
      const r = await salvarValoresDoContato(contatoId, envio);
      setValores(r.valores || {});
      setEdicao(null);
      toast.success("Campos salvos");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (edicao) {
    return (
      <form className="space-y-2.5" onSubmit={e => { e.preventDefault(); salvar(); }}>
        {campos.map(c => (
          <div key={c.id} className="space-y-1">
            <label htmlFor={`cf-${c.chave}`} className="text-[11px] font-medium text-muted-foreground">{c.nome}</label>
            <Editor campo={c} valor={edicao[c.chave]} onChange={v => setEdicao({ ...edicao, [c.chave]: v })} />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEdicao(null)}>Cancelar</Button>
          <Button type="submit" size="sm" className="h-7 text-xs" disabled={salvando}>
            {salvando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Salvar
          </Button>
        </div>
      </form>
    );
  }

  const preenchidos = campos.filter(c => formatarValor(c, valores[c.chave]));
  return (
    <div className="space-y-1.5">
      {preenchidos.length ? (
        <dl className="space-y-1">
          {preenchidos.map(c => (
            <div key={c.id} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 text-muted-foreground">{c.nome}</dt>
              <dd className="min-w-0 break-words text-right font-medium [overflow-wrap:anywhere]">{formatarValor(c, valores[c.chave])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum campo preenchido.</p>
      )}
      <Button type="button" size="sm" variant="outline" className="h-7 w-full gap-1.5 text-xs" onClick={abrirEdicao}>
        {preenchidos.length ? <Pencil className="h-3 w-3" /> : <SlidersHorizontal className="h-3 w-3" />}
        {preenchidos.length ? "Editar campos" : "Preencher campos"}
      </Button>
    </div>
  );
}

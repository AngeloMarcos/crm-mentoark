/**
 * Cadastro de campos personalizados do contato (2026-11-11). Os valores aparecem no painel do
 * contato na conversa e na ficha do lead; a IA preenche os campos marcados "IA preenche".
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CRMLayout } from "@/components/CRMLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  TIPOS_CAMPO, criarCampo, editarCampo, excluirCampo, listarCampos, ordenarCampos, rotuloTipo, temOpcoes,
  type CampoPersonalizado, type TipoCampo,
} from "@/lib/camposPersonalizados";

interface Rascunho { id?: string; nome: string; tipo: TipoCampo; opcoes: string; descricao: string; ia_preenche: boolean }
const NOVO: Rascunho = { nome: "", tipo: "texto", opcoes: "", descricao: "", ia_preenche: false };

function DialogoCampo({ rascunho, onFechar, onSalvo }: { rascunho: Rascunho | null; onFechar: () => void; onSalvo: () => void }) {
  const [r, setR] = useState<Rascunho>(NOVO);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (rascunho) setR(rascunho); }, [rascunho]);
  const editando = !!r.id;

  const salvar = async () => {
    setSalvando(true);
    try {
      const opcoes = r.opcoes.split("\n").map(o => o.trim()).filter(Boolean);
      const dados = { nome: r.nome.trim(), descricao: r.descricao.trim() || null, ia_preenche: r.ia_preenche, ...(temOpcoes(r.tipo) ? { opcoes } : {}) };
      if (editando) await editarCampo(r.id!, dados);
      else await criarCampo({ ...dados, tipo: r.tipo });
      toast.success(editando ? "Campo salvo" : "Campo criado");
      onSalvo();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const invalido = !r.nome.trim() || (temOpcoes(r.tipo) && !r.opcoes.trim());

  return (
    <Dialog open={!!rascunho} onOpenChange={v => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar campo" : "Novo campo"}</DialogTitle>
          <DialogDescription>Informação extra guardada em cada contato.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!invalido) salvar(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="campo-nome">Nome</Label>
            <Input id="campo-nome" value={r.nome} maxLength={60} onChange={e => setR({ ...r, nome: e.target.value })} placeholder="Ex.: Orçamento mensal" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campo-tipo">Tipo</Label>
            <Select value={r.tipo} onValueChange={v => setR({ ...r, tipo: v as TipoCampo })} disabled={editando}>
              <SelectTrigger id="campo-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>{TIPOS_CAMPO.map(t => <SelectItem key={t.tipo} value={t.tipo}>{t.rotulo}</SelectItem>)}</SelectContent>
            </Select>
            {editando && <p className="text-xs text-muted-foreground">O tipo não muda depois de criado.</p>}
          </div>
          {temOpcoes(r.tipo) && (
            <div className="space-y-1.5">
              <Label htmlFor="campo-opcoes">Opções (uma por linha)</Label>
              <Textarea id="campo-opcoes" rows={4} value={r.opcoes} onChange={e => setR({ ...r, opcoes: e.target.value })} placeholder={"Casa\nApartamento\nTerreno"} />
            </div>
          )}
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="campo-ia" className="font-medium">IA preenche</Label>
              <p className="text-xs text-muted-foreground">Quando o cliente disser essa informação na conversa, a IA registra sozinha.</p>
            </div>
            <Switch id="campo-ia" checked={r.ia_preenche} onCheckedChange={v => setR({ ...r, ia_preenche: v })} />
          </div>
          {r.ia_preenche && (
            <div className="space-y-1.5">
              <Label htmlFor="campo-desc">Orientação para a IA (opcional)</Label>
              <Textarea id="campo-desc" rows={2} maxLength={300} value={r.descricao} onChange={e => setR({ ...r, descricao: e.target.value })} placeholder="Ex.: quanto o cliente pode investir por mês" />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvando || invalido}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CamposPersonalizadosPage() {
  const [campos, setCampos] = useState<CampoPersonalizado[] | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);

  const carregar = useCallback(() => {
    listarCampos().then(setCampos).catch((e: any) => { setCampos([]); toast.error(e.message); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const mover = async (i: number, delta: number) => {
    if (!campos) return;
    const nova = [...campos];
    const [item] = nova.splice(i, 1);
    nova.splice(i + delta, 0, item);
    setCampos(nova);
    try { await ordenarCampos(nova.map(c => c.id)); } catch (e: any) { toast.error(e.message); carregar(); }
  };

  const excluir = async (c: CampoPersonalizado) => {
    if (!window.confirm(`Excluir o campo "${c.nome}"? Ele some das fichas; os valores já preenchidos ficam guardados.`)) return;
    try { await excluirCampo(c.id); carregar(); } catch (e: any) { toast.error(e.message); }
  };

  const editar = (c: CampoPersonalizado) =>
    setRascunho({ id: c.id, nome: c.nome, tipo: c.tipo, opcoes: (c.opcoes || []).join("\n"), descricao: c.descricao || "", ia_preenche: c.ia_preenche });

  return (
    <CRMLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Campos personalizados</h1>
            <p className="text-sm text-muted-foreground">Informações extras de cada contato: aparecem na conversa e na ficha do lead, filtram a lista e vão pela API.</p>
          </div>
          <Button onClick={() => setRascunho({ ...NOVO })}><Plus className="mr-2 h-4 w-4" /> Novo campo</Button>
        </div>
        <Card className="p-0">
          {campos === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : campos.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nenhum campo ainda. Exemplos: Orçamento, Tipo de imóvel, Cidade de interesse, Data do evento.
            </div>
          ) : (
            <ul className="divide-y">
              {campos.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2.5">
                  <div className="flex flex-col">
                    <Button variant="ghost" size="icon" className="h-5 w-6" disabled={i === 0} aria-label={`Subir ${c.nome}`} onClick={() => mover(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-5 w-6" disabled={i === campos.length - 1} aria-label={`Descer ${c.nome}`} onClick={() => mover(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{c.nome}</span>
                      <Badge variant="outline" className="text-[10px]">{rotuloTipo(c.tipo)}</Badge>
                      {c.ia_preenche && <Badge variant="secondary" className="gap-1 text-[10px]"><Bot className="h-3 w-3" /> IA preenche</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <code>{c.chave}</code>{temOpcoes(c.tipo) && c.opcoes?.length ? ` · ${c.opcoes.join(", ")}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${c.nome}`} onClick={() => editar(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Excluir ${c.nome}`} onClick={() => excluir(c)}><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="text-xs text-muted-foreground">
          A chave (ex.: <code>orcamento</code>) é o nome do campo na API <code>/v1</code> (<code>customFields</code> e filtro <code>cf_chave</code>) e não muda se você renomear.
        </p>
      </div>
      <DialogoCampo rascunho={rascunho} onFechar={() => setRascunho(null)} onSalvo={() => { setRascunho(null); carregar(); }} />
    </CRMLayout>
  );
}

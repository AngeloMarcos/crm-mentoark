import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/integrations/database/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Nicho, Pesos, ROTULOS_PESO } from "./tipos";

const lista = (t: string) => t.split(",").map(s => s.trim()).filter(Boolean);
const texto = (l: string[]) => l.join(", ");

function Pesos_() {
  const qc = useQueryClient();
  const pesosQ = useQuery({ queryKey: ["radar-pesos"], queryFn: async () => (await api.get("/api/radar/pesos")).data as Pesos });
  const [form, setForm] = useState<Pesos>({});
  useEffect(() => { if (pesosQ.data) setForm(pesosQ.data); }, [pesosQ.data]);

  const salvar = useMutation({
    mutationFn: async (recalcular: boolean) => {
      await api.put("/api/radar/pesos", form);
      if (recalcular) return (await api.post("/api/radar/grupos/pontuar", {})).data as { recalculados: number };
      return null;
    },
    onSuccess: (r) => {
      toast.success(r ? `Pesos salvos. ${r.recalculados} grupo(s) reavaliado(s).` : "Pesos salvos");
      qc.invalidateQueries({ queryKey: ["radar-pesos"] });
      qc.invalidateQueries({ queryKey: ["radar-grupos"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar os pesos"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pesos do score</CardTitle>
        <CardDescription>O score de 0 a 100 é a soma destas regras, sem IA. Cada regra que bate aparece como selo no catálogo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pesosQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(ROTULOS_PESO).map(([chave, { rotulo, ajuda }]) => (
              <div key={chave} className="space-y-1">
                <Label htmlFor={`p-${chave}`}>{rotulo}</Label>
                <Input id={`p-${chave}`} type="number" min={0} max={10000} value={form[chave] ?? 0}
                  onChange={e => setForm(f => ({ ...f, [chave]: Math.max(0, Number(e.target.value) || 0) }))} />
                <p className="text-xs text-muted-foreground">{ajuda}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => salvar.mutate(false)} disabled={salvar.isPending}><Save className="mr-2 h-4 w-4" />Salvar pesos</Button>
          <Button onClick={() => salvar.mutate(true)} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar e recalcular scores do catálogo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NichoEditor({ n }: { n: Nicho }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    nome: n.nome, termos: texto(n.termos_busca), pos: texto(n.palavras_positivas),
    neg: texto(n.palavras_negativas), reg: texto(n.regioes), ativo: n.ativo,
  });
  const salvar = useMutation({
    mutationFn: async () => api.patch(`/api/radar/nichos/${n.id}`, {
      nome: f.nome, termos_busca: lista(f.termos), palavras_positivas: lista(f.pos),
      palavras_negativas: lista(f.neg), regioes: lista(f.reg), ativo: f.ativo,
    }),
    onSuccess: () => { toast.success("Nicho salvo — recalcule os scores para aplicar"); qc.invalidateQueries({ queryKey: ["radar-nichos"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível salvar o nicho"),
  });
  const excluir = useMutation({
    mutationFn: async () => api.delete(`/api/radar/nichos/${n.id}`),
    onSuccess: () => { toast.success("Nicho removido"); qc.invalidateQueries({ queryKey: ["radar-nichos"] }); },
  });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1"><Label>Nome</Label><Input value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
      <div className="flex items-center gap-2 pt-6"><Switch checked={f.ativo} onCheckedChange={v => setF({ ...f, ativo: v })} /><Label>Nicho ativo nas buscas</Label></div>
      <div className="space-y-1 md:col-span-2"><Label>Termos de busca (separados por vírgula)</Label>
        <Textarea rows={2} value={f.termos} onChange={e => setF({ ...f, termos: e.target.value })} /></div>
      <div className="space-y-1"><Label>Palavras positivas</Label>
        <Textarea rows={3} value={f.pos} onChange={e => setF({ ...f, pos: e.target.value })} /></div>
      <div className="space-y-1"><Label>Palavras negativas do nicho</Label>
        <Textarea rows={3} value={f.neg} onChange={e => setF({ ...f, neg: e.target.value })} /></div>
      <div className="space-y-1 md:col-span-2"><Label>Regiões</Label>
        <Textarea rows={2} value={f.reg} onChange={e => setF({ ...f, reg: e.target.value })} /></div>
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}><Save className="mr-2 h-4 w-4" />Salvar nicho</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remover o nicho “${n.nome}”? Os grupos já catalogados ficam sem nicho.`)) excluir.mutate(); }}>
          <Trash2 className="mr-2 h-4 w-4 text-red-600" />Remover
        </Button>
      </div>
    </div>
  );
}

function Nichos() {
  const qc = useQueryClient();
  const nichos = useQuery({ queryKey: ["radar-nichos"], queryFn: async () => (await api.get("/api/radar/nichos")).data as Nicho[] });
  const [novo, setNovo] = useState("");
  const criar = useMutation({
    mutationFn: async () => api.post("/api/radar/nichos", { nome: novo.trim(), termos_busca: [novo.trim()] }),
    onSuccess: () => { setNovo(""); qc.invalidateQueries({ queryKey: ["radar-nichos"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível criar o nicho"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Nichos</CardTitle>
        <CardDescription>Termos usados na busca e palavras usadas no score. Já vêm 14 nichos prontos; edite à vontade.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Novo nicho (ex.: Dentistas)" value={novo} onChange={e => setNovo(e.target.value)} maxLength={80} />
          <Button onClick={() => criar.mutate()} disabled={novo.trim().length < 2 || criar.isPending}><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
        </div>
        {nichos.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <Accordion type="single" collapsible>
            {(nichos.data ?? []).map(n => (
              <AccordionItem key={n.id} value={n.id}>
                <AccordionTrigger>{n.nome}{!n.ativo && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}</AccordionTrigger>
                <AccordionContent><NichoEditor n={n} /></AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

export function AbaConfig() {
  return <div className="space-y-6 pt-4"><Pesos_ /><Nichos /></div>;
}
